import { MessageStatus, Mode, Role } from "@codepilot/database/enums";
import { z } from "zod";
import { isSupportedChatModel, resolveModel } from "../lib/models";
import { zValidator } from "@hono/zod-validator";
// import type { streamSSE } from "hono/streaming";
import { streamText as aiStreamText } from "ai";
import type { ChatStreamEvent } from "@codepilot/shared";
import { db } from "@codepilot/database/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types";

const submitSchema = z.object({
  content: z.string(),
  mode: z.enum(Mode),
  model: z.string().refine(isSupportedChatModel, "unsupported model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    // A rejected body is a client mistake, so it stays a warning. Only the
    // field paths are logged — message content never reaches the log line.
    // The request id comes from the Sentry scope, as in `sessions.ts`.
    logger.warn("Rejected invalid chat submit body", {
      session_id: c.req.param("sessionId"),
      issue_count: result.error.issues.length,
      fields: result.error.issues.map((issue) => issue.path.join(".")),
    });

    return c.json(
      {
        error: result.error.message,
      },
      400,
    );
  }
});

function buildConversationHistory(
  messages: { role: Role; content: string; status: MessageStatus }[],
) {
  return messages.flatMap((m) => {
    if (m.role === "ERROR") return [];
    if (m.role === "USER" && m.content.length === 0) return [];
    return [
      {
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      },
    ];
  });
}

type StreamParams = {
  sessionId: string;
  model: string;
  history: {
    role: "user" | "assistant";
    content: string;
  }[];
  mode: Mode;
  abortController: AbortController;
  /** Threaded through so stream logs correlate with the request that opened them. */
  requestId: string;
  /** Which endpoint opened the stream — "submit" or "resume". */
  source: "submit" | "resume";
};

async function streamAIResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: StreamParams,
) {
  const {
    sessionId,
    model,
    history,
    mode,
    abortController,
    requestId,
    source,
  } = params;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model);
  let fullText = "";

  // Shared by every log line below so a single stream can be followed end to
  // end. Prompt and completion text are deliberately left out — only sizes.
  const logContext = {
    request_id: requestId,
    session_id: sessionId,
    source,
    model,
    mode,
  };

  logger.info("Chat stream started", {
    ...logContext,
    history_length: history.length,
  });

  try {
    const result = aiStreamText({
      model: resolvedModel.model,
      messages: history,
      abortSignal: abortController.signal,
    });

    for await (const part of result.stream) {
      if (stream.aborted) break;
      if (part.type === "text-delta") {
        fullText += part.text;
        const event: ChatStreamEvent = {
          type: "text-delta",
          text: part.text,
        };
        await stream.writeSSE({
          event: "text-delta",
          data: JSON.stringify(event),
        });
      }
    }
    if (stream.aborted || abortController.signal.aborted) {
      // A client hanging up mid-stream is routine, so this is not an error —
      // but the partial length is worth having when debugging truncation.
      logger.info("Chat stream aborted by client", {
        ...logContext,
        duration_ms: Date.now() - startTime,
        text_length: fullText.length,
      });
      return;
    }

    const elepsedMs = Date.now() - startTime;

    const assistantMessage = await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content: fullText,
        status: MessageStatus.COMPLETE,
        model,
        mode,
        duration: Math.round(elepsedMs / 1000),
      },
    });
    const doneEvent: ChatStreamEvent = {
      type: "done",
      messageId: assistantMessage.id,
      durationMs: elepsedMs,
    };
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify(doneEvent),
    });

    logger.info("Chat stream completed", {
      ...logContext,
      message_id: assistantMessage.id,
      duration_ms: elepsedMs,
      text_length: fullText.length,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info("Chat stream aborted during generation", {
        ...logContext,
        duration_ms: Date.now() - startTime,
        text_length: fullText.length,
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";

    logger.error("Chat stream failed", {
      ...logContext,
      duration_ms: Date.now() - startTime,
      text_length: fullText.length,
      error: String(err),
    });

    await db.message.create({
      data: {
        sessionId,
        role: "ERROR",
        content: message,
        status: MessageStatus.COMPLETE,
        model,
        mode,
      },
    });
    const errorEvent: ChatStreamEvent = {
      type: "error",
      message,
    };
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify(errorEvent),
    });
  }
}

const app = new Hono<AppEnv>()
  .post("/:sessionId", submitValidator, async (c) => {
    const { sessionId } = c.req.param();
    const requestId = c.get("requestId");
    const session = await db.session.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
    if (!session) {
      logger.warn("Session not found for chat submit", {
        request_id: requestId,
        operation: "session.findUnique",
        session_id: sessionId,
      });
      return c.json({ error: "Session not found" }, 404);
    }
    const { content, mode, model } = c.req.valid("json");

    logger.info("Chat message submitted", {
      request_id: requestId,
      session_id: sessionId,
      model,
      mode,
      content_length: content.length,
      message_count: session.messages.length,
    });

    await db.message.create({
      data: {
        sessionId,
        role: "USER",
        content,
        status: MessageStatus.COMPLETE,
        model,
        mode,
      },
    });

    const history = buildConversationHistory([
      ...session.messages, // todo:limit to last 10 messages
      {
        role: "USER",
        content,
        status: MessageStatus.COMPLETE,
      },
    ]);

    const abortController = new AbortController();
    const stream = streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => {
          abortController.abort();
        });
        await streamAIResponse(stream, {
          sessionId,
          model,
          history,
          mode,
          abortController,
          requestId,
          source: "submit",
        });
      },

      async (err, stream) => {
        const message = err instanceof Error ? err.message : String(err);

        // Reached only when the SSE transport itself fails — `streamAIResponse`
        // already handles and logs generation errors on its own.
        logger.error("Chat SSE transport failed", {
          request_id: requestId,
          session_id: sessionId,
          source: "submit",
          error: String(err),
        });

        const errorEvent: ChatStreamEvent = {
          type: "error",
          message,
        };
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify(errorEvent),
        });
        return stream.close();
      },
    );
    return stream;
  })
  .post("/:sessionId/resume", async (c) => {
    const sessionId = c.req.param("sessionId");
    const requestId = c.get("requestId");
    const session = await db.session.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
    if (!session) {
      logger.warn("Session not found for chat resume", {
        request_id: requestId,
        operation: "session.findUnique",
        session_id: sessionId,
      });
      return c.json({ error: "Session not found" }, 404);
    }

    // The three guards below are all client-side mistakes, so each is a warning
    // carrying the reason that made the resume impossible.
    const lastMessage = session.messages[session.messages.length - 1];
    if (!lastMessage) {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "no_messages",
      });
      return c.json({ error: "No messages found" }, 404);
    }
    if (lastMessage.role !== "USER") {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "last_message_not_user",
        last_message_role: lastMessage.role,
      });
      return c.json({ error: "Session has no user message to resume" }, 400);
    }
    if (!isSupportedChatModel(lastMessage.model)) {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "unsupported_model",
        model: lastMessage.model,
      });
      return c.json(
        {
          error:
            "Last message model is not supported, model: " + lastMessage.model,
        },
        400,
      );
    }
    const history = buildConversationHistory(session.messages);

    logger.info("Chat session resumed", {
      request_id: requestId,
      session_id: sessionId,
      model: lastMessage.model,
      mode: lastMessage.mode,
      message_count: session.messages.length,
    });

    const abortController = new AbortController();
    return streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => {
          abortController.abort();
        });
        await streamAIResponse(stream, {
          sessionId,
          model: lastMessage.model,
          history,
          mode: lastMessage.mode,
          abortController,
          requestId,
          source: "resume",
        });
      },
      async (err, stream) => {
        const message = err instanceof Error ? err.message : String(err);

        logger.error("Chat SSE transport failed", {
          request_id: requestId,
          session_id: sessionId,
          source: "resume",
          error: String(err),
        });

        const errorEvent: ChatStreamEvent = {
          type: "error",
          message,
        };
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify(errorEvent),
        });
        return stream.close();
      },
    );
  });
export default app;

import { MessageStatus, Mode, Role } from "@codepilot/database/enums";
import { z } from "zod";
import { isSupportedChatModel, resolveModel } from "../lib/models";
import { zValidator } from "@hono/zod-validator";
import { streamText as aiStreamText } from "ai";
import { db } from "@codepilot/database/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types";
import type { Prisma } from "@codepilot/database";
import {
  type ChatStreamEvent,
  type MessagePart,
  toolCallArgsSchema,
  messagePartsSchema,
} from "@codepilot/shared";

/**
 * Sessions with a resume stream in flight. Guards against two clients (or one
 * client that reconnected) generating a reply for the same dangling user
 * message twice. Entries are added before the stream opens and removed in
 * `finally` *inside* the stream callback — releasing on the way out of the
 * handler would be useless, because `streamSSE` returns its Response
 * immediately and runs the callback in the background.
 */
const activeResumeSessionIds = new Set<string>();

/**
 * How many stored messages get replayed to the model. Every turn re-sends the
 * whole history, so without a cap the prompt (and the bill) grows without
 * bound. Trimming from the end keeps the most recent context.
 */
const MAX_HISTORY_MESSAGES = 20;

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
  const usable = messages.flatMap((m) => {
    // Errors were never part of the conversation, and an empty turn of either
    // role is rejected by some providers.
    if (m.role === "ERROR") return [];
    if (m.content.length === 0) return [];
    return [
      {
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      },
    ];
  });

  return usable.slice(-MAX_HISTORY_MESSAGES);
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

function getResumableUserMessage(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    model: string;
    mode: Mode;
  }[],
) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "USER") return null;
  return lastMessage;
}

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
  const parts: MessagePart[] = [];

  // `Message.duration` is stored in **milliseconds** — the same unit the
  // `done` event carries — so the CLI can hand either straight to `prettyMs`.
  const persistInterruptedMessage = async () => {
    const fullText = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    if (fullText.length === 0 && parts.length === 0) return;

    const validatedParts: Prisma.InputJsonValue | undefined =
      parts.length > 0 ? messagePartsSchema.parse(parts) : undefined;

    await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content: fullText,
        parts: validatedParts,
        status: MessageStatus.INTERRUPTED,
        model,
        mode,
        duration: Date.now() - startTime,
      },
    });
  };

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
      providerOptions: resolvedModel.providerOptions,
    });

    for await (const part of result.stream) {
      if (stream.aborted) break;

      if (part.type === "reasoning-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "reasoning") {
          last.text += part.text;
        } else {
          parts.push({
            type: "reasoning",
            text: part.text,
          });
        }
        const event: ChatStreamEvent = {
          type: "reasoning-delta",
          text: part.text,
        };
        await stream.writeSSE({
          event: "reasoning-delta",
          data: JSON.stringify(event),
        });
      }

      if (part.type === "text-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          last.text += part.text;
        } else {
          parts.push({
            type: "text",
            text: part.text,
          });
        }

        const event: ChatStreamEvent = {
          type: "text-delta",
          text: part.text,
        };
        await stream.writeSSE({
          event: "text-delta",
          data: JSON.stringify(event),
        });
      }

      if (part.type === "tool-call") {
        const args = toolCallArgsSchema.parse(part.input);

        parts.push({
          type: "tool-call",
          id: part.toolCallId,
          name: part.toolName,
          args,
        });
        const event: ChatStreamEvent = {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args,
        };
        await stream.writeSSE({
          event: "tool-call",
          data: JSON.stringify(event),
        });
      }
      if (part.type === "tool-result") {
        const resultStr =
          typeof part.output === "string"
            ? part.output
            : JSON.stringify(part.output);

        const tcPart = parts.find(
          (p) => p.type === "tool-call" && p.id === part.toolCallId,
        );

        if (tcPart) {
          (tcPart as MessagePart & { result: string }).result = resultStr;
        }
        const event: ChatStreamEvent = {
          type: "tool-result",
          toolCallId: part.toolCallId,
          result: resultStr,
        };
        await stream.writeSSE({
          event: "tool-result",
          data: JSON.stringify(event),
        });
      }
      if (part.type === "error") {
        throw part.error;
      }
    }
    if (stream.aborted || abortController.signal.aborted) {
      // A client hanging up mid-stream is routine, so this is not an error —
      // but the partial length is worth having when debugging truncation.
      logger.info("Chat stream aborted by client", {
        ...logContext,
        duration_ms: Date.now() - startTime,
        text_length: parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("").length,
      });
      await persistInterruptedMessage();
      return;
    }

    const elapsedMs = Date.now() - startTime;
    const fullText = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    const validatedParts: Prisma.InputJsonValue | undefined =
      parts.length > 0 ? messagePartsSchema.parse(parts) : undefined;
    const assistantMessage = await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content: fullText,
        parts: validatedParts,
        status: MessageStatus.COMPLETE,
        model,
        mode,
        duration: elapsedMs,
      },
    });
    const doneEvent: ChatStreamEvent = {
      type: "done",
      messageId: assistantMessage.id,
      durationMs: elapsedMs,
    };
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify(doneEvent),
    });

    logger.info("Chat stream completed", {
      ...logContext,
      message_id: assistantMessage.id,
      duration_ms: elapsedMs,
      text_length: fullText.length,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info("Chat stream aborted during generation", {
        ...logContext,
        duration_ms: Date.now() - startTime,
        text_length: parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("").length,
      });
      await persistInterruptedMessage();
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";

    logger.error("Chat stream failed", {
      ...logContext,
      duration_ms: Date.now() - startTime,
      text_length: parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("").length,
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
      ...session.messages,
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

    // The guards below are all client-side mistakes, so each is a warning
    // carrying the reason that made the resume impossible.
    const resumableMessage = getResumableUserMessage(session.messages);
    if (!resumableMessage) {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "no_trailing_user_message",
        message_count: session.messages.length,
      });
      return c.json({ error: "Session has no user message to resume" }, 400);
    }
    if (!isSupportedChatModel(resumableMessage.model)) {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "unsupported_model",
        model: resumableMessage.model,
      });
      return c.json(
        {
          error:
            "Last message model is not supported, model: " +
            resumableMessage.model,
        },
        400,
      );
    }

    if (activeResumeSessionIds.has(sessionId)) {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "session_already_resuming",
      });
      return c.json({ error: "Session is already being resumed" }, 409);
    }
    activeResumeSessionIds.add(sessionId);
    const history = buildConversationHistory(session.messages);

    logger.info("Chat session resumed", {
      request_id: requestId,
      session_id: sessionId,
      model: resumableMessage.model,
      mode: resumableMessage.mode,
      message_count: session.messages.length,
    });

    const abortController = new AbortController();
    return streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => {
          abortController.abort();
        });
        try {
          await streamAIResponse(stream, {
            sessionId,
            model: resumableMessage.model,
            history,
            mode: resumableMessage.mode,
            abortController,
            requestId,
            source: "resume",
          });
        } finally {
          // Released here, not around `streamSSE` — that call returns its
          // Response immediately and runs this callback in the background, so
          // an outer `finally` would drop the lock before a single token
          // streamed, defeating the guard entirely.
          activeResumeSessionIds.delete(sessionId);
        }
      },
      async (err, stream) => {
        activeResumeSessionIds.delete(sessionId);
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

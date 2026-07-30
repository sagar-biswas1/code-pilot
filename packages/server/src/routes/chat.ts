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
const submitSchema = z.object({
  content: z.string(),
  mode: z.enum(Mode),
  model: z.string().refine(isSupportedChatModel, "unsupported model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
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
};

async function streamAIResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: StreamParams,
) {
  const { sessionId, model, history, mode, abortController } = params;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model);
  let fullText = "";
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
    if (stream.aborted || abortController.signal.aborted) return;

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
  } catch (err) {
    if (abortController.signal.aborted) return;
    const message = err instanceof Error ? err.message : "Unknown error";
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

const app = new Hono().post("/:sessionId", submitValidator, async (c) => {
  const { sessionId } = c.req.param();
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
    return c.json({ error: "Session not found" }, 404);
  }
  const { content, mode, model } = c.req.valid("json");
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
      });
    },

    async (err, stream) => {
      const message = err instanceof Error ? err.message : String(err);

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
});


export default app;
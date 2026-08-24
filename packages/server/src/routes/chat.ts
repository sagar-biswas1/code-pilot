/**
 * Chat streaming, one *step* per request.
 *
 * Tools run on the user's machine, not here, so a turn that uses them cannot
 * be a single server-side loop. It is a conversation between the two halves:
 *
 *   POST /chat/:sessionId        → text, then possibly tool calls, then stop
 *   (CLI runs the tools locally)
 *   POST /chat/:sessionId/tools  → results in, next step streams back out
 *   … repeated until a step ends without asking for anything …
 *
 * Every step appends to the *same* assistant row, so a turn that took four
 * round trips still reads as one reply when the session is reopened. The row's
 * status is the state machine: `PENDING_TOOLS` while it is parked waiting for
 * the CLI, `COMPLETE` when the model finally stops asking.
 */

import { MessageStatus, Mode } from "@codepilot/database/enums";
import { z } from "zod";
import { isSupportedChatModel, resolveModel } from "../lib/models";
import { zValidator } from "@hono/zod-validator";
import {
  streamText as aiStreamText,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";
import { db } from "@codepilot/database/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../lib/logger";
import { requireAuth } from "../middleware/requireAuth";
import type { AuthEnv } from "../types";
import type { Prisma } from "@codepilot/database";
import {
  messagePartsSchema,
  submitToolResultsSchema,
  toolCallArgsSchema,
  workspaceContextSchema,
  type ChatStreamEvent,
  type MessagePart,
  type StopReason,
  type ToolCallPart,
} from "@codepilot/shared";
import { createModelTools } from "../lib/modelTools";
import { buildConversationHistory, pendingToolCalls } from "../lib/history";
import { buildSystemPrompt } from "../prompts/systemPrompt";
import { calculateCreditsForUsages } from "../lib/credits";
import { ingestAiUsages } from "../lib/polar";
import { requireCreditsBalance } from "../middleware/requireCreditsBalance";

/**
 * The stream currently generating into each session.
 *
 * A turn now spans several requests, so two writers would interleave steps
 * into the same assistant row — but the two kinds of second writer want
 * opposite answers:
 *
 * - **A new submit supersedes.** The user typed again; they mean "stop that
 *   and answer this". Refusing would surface as a spurious 409 whenever a
 *   resubmit outran the old connection's teardown, which it easily can.
 * - **A resume or a tool-result does not.** Both continue work that already
 *   exists, so a duplicate is a double-generate, not an intent to replace.
 *
 * Holding the `AbortController` rather than a bare id is what makes takeover
 * possible: the superseded stream is cancelled here instead of being waited on.
 *
 * Entries are released in `finally` *inside* the stream callback: `streamSSE`
 * returns its Response immediately and runs the callback in the background, so
 * releasing around the call would drop the lock before a token streamed.
 */
const activeStreams = new Map<string, AbortController>();

/**
 * Claim the session. Returns false when one is already active and `supersede`
 * is not set — the caller turns that into a 409.
 */
function beginStream(
  sessionId: string,
  controller: AbortController,
  supersede: boolean,
): boolean {
  const existing = activeStreams.get(sessionId);
  if (existing) {
    if (!supersede) return false;
    existing.abort();
  }
  activeStreams.set(sessionId, controller);
  return true;
}

/**
 * Release the session, but only if this stream is still the one holding it —
 * a superseded stream finishing late must not evict its replacement.
 */
function endStream(sessionId: string, controller: AbortController): void {
  if (activeStreams.get(sessionId) === controller) {
    activeStreams.delete(sessionId);
  }
}

/**
 * Ceiling on tool calls in a single turn, counted from the stored parts.
 * Without it, a model that calls a tool, reads the result, and calls it again
 * can loop for as long as the user's credits last. Calls rather than round
 * trips, because a step can ask for several tools at once.
 */
const MAX_TOOL_CALLS_PER_TURN = 20;

const submitSchema = z.object({
  content: z.string().min(1),
  mode: z.enum(Mode),
  model: z.string().refine(isSupportedChatModel, "unsupported model"),
  workspace: workspaceContextSchema,
});

/**
 * A rejected body is a client mistake, so it stays a warning. Only the field
 * paths are logged — message content never reaches the log line.
 */
function logInvalidBody(
  label: string,
  sessionId: string | undefined,
  issues: readonly { readonly path: readonly PropertyKey[] }[],
): void {
  logger.warn(`Rejected invalid ${label} body`, {
    session_id: sessionId,
    issue_count: issues.length,
    fields: issues.map((issue) => issue.path.map(String).join(".")),
  });
}

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    logInvalidBody("chat submit", c.req.param("sessionId"), result.error.issues);
    return c.json({ error: "Invalid request body" }, 400);
  }
});

const toolResultsValidator = zValidator(
  "json",
  submitToolResultsSchema,
  (result, c) => {
    if (!result.success) {
      logInvalidBody("tool results", c.req.param("sessionId"), result.error.issues);
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

/**
 * Resume carries no message of its own — only the workspace the CLI is in,
 * which every step needs for prompt context.
 */
const resumeValidator = zValidator(
  "json",
  z.object({ workspace: workspaceContextSchema }),
  (result, c) => {
    if (!result.success) {
      logInvalidBody("chat resume", c.req.param("sessionId"), result.error.issues);
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

type StreamParams = {
  sessionId: string;
  userId: string;
  model: string;
  mode: Mode;
  history: ModelMessage[];
  cwd: string;
  abortController: AbortController;
  /** Threaded through so stream logs correlate with the request that opened them. */
  requestId: string;
  /** Which endpoint opened the stream. */
  source: "submit" | "resume" | "tool-results";
  /**
   * The turn being continued. When set, this step appends to that row instead
   * of creating one, which is what keeps a multi-step turn a single reply.
   */
  existingMessageId?: string;
  /** Parts already stored on that row, so new ones append rather than replace. */
  existingParts?: MessagePart[];
  /** Time already spent on earlier steps of this turn, in milliseconds. */
  elapsedBeforeMs?: number;
};

/** The last message, if the conversation is waiting on an answer. */
function getResumableUserMessage(
  messages: { role: "USER" | "ASSISTANT" | "ERROR"; model: string; mode: Mode }[],
) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "USER") return null;
  return lastMessage;
}

function countToolCalls(parts: MessagePart[]): number {
  return parts.filter((part) => part.type === "tool-call").length;
}

/**
 * Runs one step and streams it.
 *
 * Returns nothing — everything the caller needs is either on the wire or in
 * the database by the time it resolves.
 */
async function streamAIResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: StreamParams,
) {
  const {
    sessionId,
    userId,
    model,
    mode,
    history,
    cwd,
    abortController,
    requestId,
    source,
    existingMessageId,
    existingParts = [],
    elapsedBeforeMs = 0,
  } = params;

  const startTime = Date.now();
  const resolvedModel = resolveModel(model);
  /** Parts produced by *this* step. Appended to `existingParts` when stored. */
  const newParts: MessagePart[] = [];
  let completedUsages: LanguageModelUsage | null = null;

  const allParts = () => [...existingParts, ...newParts];
  const elapsed = () => elapsedBeforeMs + (Date.now() - startTime);

  const logContext = {
    request_id: requestId,
    session_id: sessionId,
    source,
    model,
    mode,
  };

  /**
   * Write the turn's row — creating it on the first step, updating it on every
   * later one. `duration` accumulates so the figure shown to the user is the
   * whole turn, not just whichever step happened to finish it.
   */
  const persistTurn = async (status: MessageStatus) => {
    const parts = allParts();
    const content = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    if (parts.length === 0) return null;

    const validatedParts = messagePartsSchema.parse(
      parts,
    ) as Prisma.InputJsonValue;

    if (existingMessageId) {
      return db.message.update({
        where: { id: existingMessageId },
        data: { content, parts: validatedParts, status, duration: elapsed() },
      });
    }

    return db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content,
        parts: validatedParts,
        status,
        model,
        mode,
        duration: elapsed(),
      },
    });
  };

  /**
   * Usage is metered per step, keyed by the step's index within the turn, so
   * a four-step turn ingests four events and a retried request that lands
   * twice dedupes on Polar's side instead of double-charging.
   */
  const ingestUsageForStep = async (messageId: string) => {
    if (!completedUsages) return;

    try {
      const billableUsages = calculateCreditsForUsages({
        provider: resolvedModel.provider,
        model: resolvedModel.modelId,
        usages: completedUsages,
      });

      await ingestAiUsages({
        customerExternalID: userId,
        eventId: `chat-step:${messageId}:${existingParts.length}`,
        credits: billableUsages.credits,
      });
    } catch (error) {
      // Metering must not cost the user the reply they already paid for, so
      // this is logged and swallowed rather than rethrown.
      logger.error("Failed to ingest usage for step", {
        ...logContext,
        message_id: messageId,
        error: String(error),
      });
    }
  };

  const finish = async (status: MessageStatus, stopReason: StopReason) => {
    const message = await persistTurn(status);
    if (!message) return null;
    await ingestUsageForStep(message.id);

    const doneEvent: ChatStreamEvent = {
      type: "done",
      messageId: message.id,
      durationMs: elapsed(),
      stopReason,
    };
    await stream.writeSSE({ event: "done", data: JSON.stringify(doneEvent) });
    return message;
  };

  logger.info("Chat step started", {
    ...logContext,
    history_length: history.length,
    step: existingMessageId ? "continuation" : "first",
  });

  try {
    const result = aiStreamText({
      model: resolvedModel.model,
      messages: history,
      abortSignal: abortController.signal,
      providerOptions: resolvedModel.providerOptions,
      onFinish: (completion) => {
        completedUsages = completion.usage;
      },
      system: buildSystemPrompt({ cwd, mode }),
      tools: createModelTools(mode),
    });

    for await (const part of result.stream) {
      if (stream.aborted) break;

      if (part.type === "reasoning-delta") {
        const last = newParts[newParts.length - 1];
        if (last && last.type === "reasoning") {
          last.text += part.text;
        } else {
          newParts.push({ type: "reasoning", text: part.text });
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
        const last = newParts[newParts.length - 1];
        if (last && last.type === "text") {
          last.text += part.text;
        } else {
          newParts.push({ type: "text", text: part.text });
        }
        const event: ChatStreamEvent = { type: "text-delta", text: part.text };
        await stream.writeSSE({
          event: "text-delta",
          data: JSON.stringify(event),
        });
      }

      if (part.type === "tool-call") {
        const args = toolCallArgsSchema.parse(part.input);
        newParts.push({
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

      if (part.type === "error") {
        throw part.error;
      }
    }

    if (stream.aborted || abortController.signal.aborted) {
      // A client hanging up mid-stream is routine, so this is not an error.
      logger.info("Chat step aborted by client", {
        ...logContext,
        duration_ms: elapsed(),
      });
      await finish(MessageStatus.INTERRUPTED, "end");
      return;
    }

    const pending = pendingToolCalls(allParts());

    // The model asked for tools but the turn has already gone around enough
    // times. Stopping here — rather than letting it continue — is what bounds
    // the cost of a loop the model cannot get itself out of.
    if (pending.length > 0 && countToolCalls(allParts()) > MAX_TOOL_CALLS_PER_TURN) {
      logger.warn("Chat turn hit the tool-step ceiling", {
        ...logContext,
        tool_calls: countToolCalls(allParts()),
      });
      await finish(MessageStatus.COMPLETE, "end");
      return;
    }

    const message = await finish(
      pending.length > 0 ? MessageStatus.PENDING_TOOLS : MessageStatus.COMPLETE,
      pending.length > 0 ? "tool-calls" : "end",
    );

    logger.info("Chat step completed", {
      ...logContext,
      message_id: message?.id,
      duration_ms: elapsed(),
      pending_tool_calls: pending.length,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      logger.info("Chat step aborted during generation", {
        ...logContext,
        duration_ms: elapsed(),
      });
      await finish(MessageStatus.INTERRUPTED, "end");
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";

    logger.error("Chat step failed", {
      ...logContext,
      duration_ms: elapsed(),
      error: String(err),
    });

    // Whatever the model produced before it failed is still worth keeping —
    // and if it contains an unanswered tool call, storing it as INTERRUPTED is
    // what lets `buildConversationHistory` answer it synthetically next turn.
    await persistTurn(MessageStatus.INTERRUPTED);

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

    const errorEvent: ChatStreamEvent = { type: "error", message };
    await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvent) });
  }
}

/** Shared SSE error handler — the transport failed, not the generation. */
function transportErrorHandler(
  requestId: string,
  sessionId: string,
  controller: AbortController,
  source: string,
) {
  return async (
    err: Error,
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  ) => {
    endStream(sessionId, controller);
    const message = err instanceof Error ? err.message : String(err);

    logger.error("Chat SSE transport failed", {
      request_id: requestId,
      session_id: sessionId,
      source,
      error: String(err),
    });

    const errorEvent: ChatStreamEvent = { type: "error", message };
    await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvent) });
    return stream.close();
  };
}

/** Loads a session the caller owns, with its messages in order. */
async function loadOwnedSession(sessionId: string, userId: string) {
  return db.session.findFirst({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

const app = new Hono<AuthEnv>()
  // Same reasoning as `sessions.ts`: the guard sits with the `AuthEnv` type
  // that only it can satisfy.
  .use(requireAuth)
  .post("/:sessionId", requireCreditsBalance, submitValidator, async (c) => {
    const { sessionId } = c.req.param();
    const requestId = c.get("requestId");
    const userId = c.get("userId");

    // Scoped by owner, so another account's session id reads as missing rather
    // than as something this user is merely not allowed to touch.
    const session = await loadOwnedSession(sessionId, userId);
    if (!session) {
      logger.warn("Session not found for chat submit", {
        request_id: requestId,
        operation: "session.findFirst",
        session_id: sessionId,
      });
      return c.json({ error: "Session not found" }, 404);
    }

    const { content, mode, model, workspace } = c.req.valid("json");

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
      { role: "USER", content, status: MessageStatus.COMPLETE },
    ]);

    const abortController = new AbortController();
    // A newer message replaces whatever was generating; see `activeStreams`.
    beginStream(sessionId, abortController, true);

    return streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => abortController.abort());
        try {
          await streamAIResponse(stream, {
            sessionId,
            userId,
            model,
            mode,
            history,
            cwd: workspace.cwd,
            abortController,
            requestId,
            source: "submit",
          });
        } finally {
          endStream(sessionId, abortController);
        }
      },
      transportErrorHandler(requestId, sessionId, abortController, "submit"),
    );
  })
  /**
   * Continue a turn whose tools the CLI has just finished running.
   *
   * The results are merged into the assistant row they belong to, and the next
   * step streams straight back on this same response — so from the CLI's point
   * of view a multi-step turn is a sequence of streams, not a poll.
   */
  .post(
    "/:sessionId/tools",
    requireCreditsBalance,
    toolResultsValidator,
    async (c) => {
      const { sessionId } = c.req.param();
      const requestId = c.get("requestId");
      const userId = c.get("userId");
      const { messageId, results, workspace } = c.req.valid("json");

      const session = await loadOwnedSession(sessionId, userId);
      if (!session) {
        logger.warn("Session not found for tool results", {
          request_id: requestId,
          session_id: sessionId,
        });
        return c.json({ error: "Session not found" }, 404);
      }

      const target = session.messages.find(
        (message) => message.id === messageId,
      );
      if (!target || target.role !== "ASSISTANT") {
        logger.warn("Tool results target no assistant message", {
          request_id: requestId,
          session_id: sessionId,
          message_id: messageId,
        });
        return c.json({ error: "Message not found" }, 404);
      }

      const parsedParts = messagePartsSchema.safeParse(target.parts);
      if (!parsedParts.success) {
        return c.json({ error: "Message has no recorded tool calls" }, 400);
      }
      const parts = parsedParts.data;

      const pending = pendingToolCalls(parts);
      if (pending.length === 0) {
        logger.warn("Tool results for a turn that is not waiting", {
          request_id: requestId,
          session_id: sessionId,
          message_id: messageId,
        });
        return c.json({ error: "This turn is not waiting for tools" }, 409);
      }

      // Every pending call must be answered, and every answer must match a
      // pending call by both id and name. A provider rejects the request
      // outright if the pairing is wrong, so it is cheaper to catch here.
      const byId = new Map(results.map((result) => [result.toolCallId, result]));
      for (const call of pending) {
        const answer = byId.get(call.id);
        if (!answer || answer.toolName !== call.name) {
          return c.json(
            { error: `Missing or mismatched result for tool call ${call.id}` },
            400,
          );
        }
      }

      const mergedParts: MessagePart[] = parts.map((part) => {
        if (part.type !== "tool-call" || part.result !== undefined) return part;
        const answer = byId.get(part.id);
        return answer
          ? ({ ...part, result: JSON.stringify(answer.result) } as ToolCallPart)
          : part;
      });

      await db.message.update({
        where: { id: messageId },
        data: { parts: mergedParts as Prisma.InputJsonValue },
      });

      // Rebuilt from the rows *including* the merge above, so the model sees
      // its own calls answered rather than a dangling `tool_use`.
      const history = buildConversationHistory(
        session.messages.map((message) =>
          message.id === messageId
            ? { ...message, parts: mergedParts }
            : message,
        ),
      );

      logger.info("Tool results received", {
        request_id: requestId,
        session_id: sessionId,
        message_id: messageId,
        result_count: results.length,
      });

      const abortController = new AbortController();
      if (!beginStream(sessionId, abortController, false)) {
        logger.warn("Rejected concurrent tool-results continuation", {
          request_id: requestId,
          session_id: sessionId,
        });
        return c.json({ error: "Session is already generating a reply" }, 409);
      }

      return streamSSE(
        c,
        async (stream) => {
          stream.onAbort(() => abortController.abort());
          try {
            await streamAIResponse(stream, {
              sessionId,
              userId,
              model: target.model,
              mode: target.mode,
              history,
              cwd: workspace.cwd,
              abortController,
              requestId,
              source: "tool-results",
              existingMessageId: messageId,
              existingParts: mergedParts,
              elapsedBeforeMs: target.duration ?? 0,
            });
          } finally {
            endStream(sessionId, abortController);
          }
        },
        transportErrorHandler(
          requestId,
          sessionId,
          abortController,
          "tool-results",
        ),
      );
    },
  )
  /**
   * Answer a conversation that ends on a user turn — a freshly created
   * session, or one that was interrupted before the assistant replied.
   */
  .post("/:sessionId/resume", requireCreditsBalance, resumeValidator, async (c) => {
    const sessionId = c.req.param("sessionId");
    const requestId = c.get("requestId");
    const userId = c.get("userId");
    const { workspace } = c.req.valid("json");

    const session = await loadOwnedSession(sessionId, userId);
    if (!session) {
      logger.warn("Session not found for chat resume", {
        request_id: requestId,
        operation: "session.findFirst",
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
    const history = buildConversationHistory(session.messages);

    logger.info("Chat session resumed", {
      request_id: requestId,
      session_id: sessionId,
      model: resumableMessage.model,
      mode: resumableMessage.mode,
      message_count: session.messages.length,
    });

    const abortController = new AbortController();
    if (!beginStream(sessionId, abortController, false)) {
      logger.warn("Cannot resume session", {
        request_id: requestId,
        session_id: sessionId,
        reason: "session_already_active",
      });
      return c.json({ error: "Session is already being resumed" }, 409);
    }

    return streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => abortController.abort());
        try {
          await streamAIResponse(stream, {
            sessionId,
            userId,
            model: resumableMessage.model,
            mode: resumableMessage.mode,
            history,
            cwd: workspace.cwd,
            abortController,
            requestId,
            source: "resume",
          });
        } finally {
          endStream(sessionId, abortController);
        }
      },
      transportErrorHandler(requestId, sessionId, abortController, "resume"),
    );
  });

export default app;

/**
 * Chat session state machine.
 *
 * Owns two stores that together make up the visible conversation:
 *
 *   `messages`  — committed turns (user, assistant, error), the source of truth
 *   `streaming` — the single in-flight assistant reply, rendered separately so
 *                 every token doesn't have to re-key the whole list
 *
 * When a turn ends, its text is committed into `messages` and `streaming`
 * returns to idle. The bubble on screen doesn't move; only who owns it does.
 *
 * **A turn is not one request.** Tools run here, on the user's machine, so a
 * reply that uses them arrives in steps: the server streams text and tool
 * calls, then stops; this runs the tools locally and posts the results back;
 * the server streams the next step onto the same assistant message. `runTurn`
 * is that loop, and `streaming` stays live across the whole of it, so the user
 * sees one continuous reply rather than a reply per round trip.
 *
 * Callbacks are declared in dependency order (leaves first) so nothing is
 * referenced above its own definition.
 */

import type { Mode } from "@codepilot/database/enums";
import {
  chatStreamEventSchema,
  type MessagePart,
  type StopReason,
  type SupportedChatModelID,
  type ToolResultPayload,
} from "@codepilot/shared";
import type { ClientResponse } from "hono/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventSourceParserStream } from "eventsource-parser/stream";
import prettyMs from "pretty-ms";

import { getErrorMessage } from "../lib/httpErrors";
import { apiClient } from "../lib/apiClient";
import { workspaceContext, WORKSPACE_ROOT } from "../lib/workspace";
import { createToolRunner } from "../tools";

/** Wire `MessagePart` tool-call plus live `status` for in-flight calls. */
export type ClientToolCallPart = Extract<MessagePart, { type: "tool-call" }> & {
  status: "calling" | "done";
};
export type ClientMessagePart =
  | Exclude<MessagePart, { type: "tool-call" }>
  | ClientToolCallPart;

export type Message =
  | {
      id: string;
      role: "user";
      content: string;
      mode: Mode;
      model: SupportedChatModelID;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      mode: Mode;
      model: SupportedChatModelID;
      parts: ClientMessagePart[];
      duration?: string;
      interrupted?: boolean;
    }
  | {
      id: string;
      role: "error";
      content: string;
    };

type StreamingState =
  | {
      status: "idle";
    }
  | {
      status: "streaming";
      parts: ClientMessagePart[];
      mode: Mode;
      model: SupportedChatModelID;
    };

type ActiveStream = {
  requestId: string;
  mode: Mode;
  model: SupportedChatModelID;
  parts: ClientMessagePart[];
  controller: AbortController;
  interruptedCaptured: boolean;
};

type SubmitParams = {
  userText: string;
  mode: Mode;
  model: SupportedChatModelID;
};

/** What one step's stream reported when it ended. */
type StepOutcome = {
  messageId: string;
  durationMs: number;
  stopReason: StopReason;
};

/**
 * Ceiling on round trips within a single turn, mirroring the server's own.
 * Both sides cap it: the server bounds what it will bill for, this bounds how
 * long the UI can sit in a loop if the server ever stops enforcing its half.
 */
const MAX_TOOL_STEPS = 20;

/** Flatten the accumulated parts into the plain text stored as `content`. */
function joinPartsText(parts: ClientMessagePart[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Copy parts by value. `handleStream` mutates the last part in place as deltas
 * arrive, so a committed message must not keep a reference to those objects.
 */
function clonePart(part: ClientMessagePart): ClientMessagePart {
  return { ...part };
}

/** Tool calls this turn has emitted but not yet answered. */
function unansweredToolCalls(parts: ClientMessagePart[]): ClientToolCallPart[] {
  return parts.filter(
    (part): part is ClientToolCallPart =>
      part.type === "tool-call" && part.result === undefined,
  );
}

export function useChat(sessionId: string, initialMessages: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [streaming, setStreaming] = useState<StreamingState>({
    status: "idle",
  });

  const activeStreamRef = useRef<ActiveStream | null>(null);

  /**
   * One runner for the whole conversation — see `tools/index.ts` for why the
   * read ledger inside it must outlive a single turn.
   */
  const toolRunner = useMemo(
    () => createToolRunner({ workspaceRoot: WORKSPACE_ROOT }),
    [],
  );

  const updateMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setMessages(updater);
    },
    [],
  );

  const appendErrorMessage = useCallback(
    (content: string) => {
      updateMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "error", content },
      ]);
    },
    [updateMessages],
  );

  /**
   * Guards every async continuation. A stream that was interrupted (or
   * superseded by a newer submit) must not write into the conversation it no
   * longer owns — its in-flight callbacks all no-op once the id stops matching.
   */
  const isActiveRequest = useCallback((requestId: string) => {
    return activeStreamRef.current?.requestId === requestId;
  }, []);

  const emitParts = useCallback(
    (requestId: string, parts: ClientMessagePart[]) => {
      if (!isActiveRequest(requestId)) return;

      const activeStream = activeStreamRef.current;
      if (!activeStream) return;

      // New array identity on every delta — `parts` is mutated in place, so
      // React would otherwise bail out of the re-render.
      const snapshot = [...parts];
      activeStream.parts = snapshot;
      setStreaming({
        status: "streaming",
        parts: snapshot,
        mode: activeStream.mode,
        model: activeStream.model,
      });
    },
    [isActiveRequest],
  );

  const clearStream = useCallback(
    (requestId: string) => {
      if (!isActiveRequest(requestId)) return;
      activeStreamRef.current = null;
      setStreaming({ status: "idle" });
    },
    [isActiveRequest],
  );

  /**
   * Consume one step's SSE stream, appending into `parts`.
   *
   * Returns how the step ended, or `null` when it produced no usable ending —
   * a transport failure, an error event, or a stream this request no longer
   * owns. The caller uses that to decide whether to run tools and continue.
   */
  const handleStream = useCallback(
    async (
      response: ClientResponse<unknown>,
      activeStream: ActiveStream,
      parts: ClientMessagePart[],
    ): Promise<StepOutcome | null> => {
      if (!isActiveRequest(activeStream.requestId)) return null;
      if (!response.ok) {
        appendErrorMessage(await getErrorMessage(response));
        return null;
      }
      if (!response.body) {
        appendErrorMessage("Stream response had no body");
        return null;
      }

      const stream = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());

      let outcome: StepOutcome | null = null;

      for await (const { data } of stream) {
        if (!isActiveRequest(activeStream.requestId)) return null;
        let event;
        try {
          event = chatStreamEventSchema.parse(JSON.parse(data));
        } catch (error) {
          appendErrorMessage(
            error instanceof Error ? error.message : "invalid stream event",
          );
          break;
        }
        switch (event.type) {
          case "reasoning-delta": {
            const last = parts[parts.length - 1];
            if (last && last.type === "reasoning") {
              last.text += event.text;
            } else {
              parts.push({ type: "reasoning", text: event.text });
            }
            emitParts(activeStream.requestId, parts);
            break;
          }
          case "tool-call": {
            parts.push({
              type: "tool-call",
              id: event.toolCallId,
              name: event.toolName,
              args: event.args,
              status: "calling",
            });
            emitParts(activeStream.requestId, parts);
            break;
          }
          case "text-delta": {
            // Extend the trailing text part, or start a new one. Once
            // tool-call/reasoning parts land, this merge rule is what keeps
            // consecutive text from fragmenting into one part per token.
            const last = parts[parts.length - 1];
            if (last && last.type === "text") {
              last.text += event.text;
            } else {
              parts.push({ type: "text", text: event.text });
            }
            emitParts(activeStream.requestId, parts);
            break;
          }
          case "done": {
            outcome = {
              messageId: event.messageId,
              durationMs: event.durationMs,
              stopReason: event.stopReason,
            };
            break;
          }
          case "error": {
            appendErrorMessage(event.message || "unknown error");
            return null;
          }
        }
      }

      return outcome;
    },
    [appendErrorMessage, emitParts, isActiveRequest],
  );

  /**
   * Run the tool calls the model just asked for, against the user's own files.
   *
   * Results are written onto the parts they answer so the transcript shows
   * them immediately, and returned so they can be posted back to the server.
   * A tool never throws here — the runner converts a failure into a result the
   * model can read and recover from.
   */
  const runPendingTools = useCallback(
    async (
      activeStream: ActiveStream,
      parts: ClientMessagePart[],
    ): Promise<ToolResultPayload[]> => {
      const pending = unansweredToolCalls(parts);

      const payloads = await Promise.all(
        pending.map(async (call) => {
          const result = await toolRunner.run(call.name, call.args, {
            mode: activeStream.mode,
            abortSignal: activeStream.controller.signal,
          });

          call.result = JSON.stringify(result);
          call.status = "done";
          emitParts(activeStream.requestId, parts);

          return {
            toolCallId: call.id,
            toolName: call.name,
            result,
          } as ToolResultPayload;
        }),
      );

      return payloads;
    },
    [emitParts, toolRunner],
  );

  /**
   * Commit whatever the model produced before the user hit Escape. The server
   * persists its own copy when it sees the connection drop; this is the local
   * half, so the UI updates without waiting for a round-trip.
   */
  const captureInterruptedMessage = useCallback(
    (activeStream: ActiveStream) => {
      if (activeStream.interruptedCaptured || !activeStream.parts.length) {
        return;
      }
      activeStream.interruptedCaptured = true;

      const committed = activeStream.parts.map(clonePart);
      updateMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: joinPartsText(committed),
          mode: activeStream.mode,
          model: activeStream.model,
          parts: committed,
          interrupted: true,
        },
      ]);
    },
    [updateMessages],
  );

  /**
   * Tear down the in-flight stream, optionally keeping its partial text.
   * `interrupt` and `abort` are the two intents built on top of it.
   */
  const stopActiveStream = useCallback(
    (capturePartial: boolean) => {
      const activeStream = activeStreamRef.current;
      if (!activeStream) return;

      if (capturePartial) {
        captureInterruptedMessage(activeStream);
      }

      // Clear the ref *before* aborting: the abort synchronously rejects the
      // in-flight fetch, and every continuation checks `isActiveRequest`.
      activeStreamRef.current = null;
      activeStream.controller.abort();
      setStreaming({ status: "idle" });
    },
    [captureInterruptedMessage],
  );

  /**
   * Drive one whole turn: stream a step, run any tools it asked for, post the
   * results, repeat until a step ends without asking for anything.
   */
  const runTurn = useCallback(
    async ({
      mode,
      model,
      openStream,
    }: {
      mode: Mode;
      model: SupportedChatModelID;
      openStream: (controller: AbortController) => Promise<ClientResponse<unknown>>;
    }) => {
      const controller = new AbortController();
      const activeStream: ActiveStream = {
        requestId: crypto.randomUUID(),
        mode,
        model,
        parts: [],
        controller,
        interruptedCaptured: false,
      };
      activeStreamRef.current = activeStream;
      setStreaming({ status: "streaming", parts: [], mode, model });

      // Shared across every step, so the committed message holds the whole
      // turn rather than only whichever step finished it.
      const parts: ClientMessagePart[] = [];

      try {
        let request = openStream;

        for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
          const response = await request(controller);
          const outcome = await handleStream(response, activeStream, parts);

          if (!outcome) return;
          if (!isActiveRequest(activeStream.requestId)) return;

          if (outcome.stopReason === "end") {
            const committed = parts.map(clonePart);
            updateMessages((prev) => [
              ...prev,
              {
                // The server's row id, so the message keeps its identity
                // across a reload and can be addressed later (retry, copy).
                id: outcome.messageId,
                role: "assistant",
                content: joinPartsText(committed),
                mode,
                model,
                parts: committed,
                duration: prettyMs(outcome.durationMs),
              },
            ]);
            return;
          }

          const results = await runPendingTools(activeStream, parts);
          if (!isActiveRequest(activeStream.requestId)) return;

          if (results.length === 0) {
            // The server said it was waiting on tools but nothing was pending.
            // Continuing would post an empty result set and be rejected, so
            // stop rather than spin.
            appendErrorMessage("Server asked for tools that were not sent");
            return;
          }

          request = (c) =>
            apiClient.chat[":sessionId"].tools.$post(
              {
                param: { sessionId },
                json: {
                  messageId: outcome.messageId,
                  results,
                  workspace: workspaceContext(),
                },
              },
              { init: { signal: c.signal } },
            );
        }

        appendErrorMessage(
          `Stopped after ${MAX_TOOL_STEPS} tool steps without a final answer.`,
        );
      } catch (error) {
        // An abort is a user action, not a failure. Logging it would pop the
        // OpenTUI console overlay (`openConsoleOnError`) on every Escape.
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        if (aborted) return;

        console.error(error);
        appendErrorMessage(
          error instanceof Error ? error.message : "unknown error",
        );
      } finally {
        clearStream(activeStream.requestId);
      }
    },
    [
      appendErrorMessage,
      clearStream,
      handleStream,
      isActiveRequest,
      runPendingTools,
      sessionId,
      updateMessages,
    ],
  );

  const resume = useCallback(
    async ({ mode, model }: Omit<SubmitParams, "userText">) => {
      await runTurn({
        mode,
        model,
        openStream: async (controller) =>
          apiClient.chat[":sessionId"].resume.$post(
            { param: { sessionId }, json: { workspace: workspaceContext() } },
            { init: { signal: controller.signal } },
          ),
      });
    },
    [runTurn, sessionId],
  );

  const submit = useCallback(
    async ({ userText, mode, model }: SubmitParams) => {
      stopActiveStream(true);

      updateMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: userText,
          mode,
          model,
        },
      ]);

      await runTurn({
        mode,
        model,
        openStream: async (controller) =>
          apiClient.chat[":sessionId"].$post(
            {
              param: { sessionId },
              json: {
                content: userText,
                mode,
                model,
                workspace: workspaceContext(),
              },
            },
            { init: { signal: controller.signal } },
          ),
      });
    },
    [stopActiveStream, updateMessages, runTurn, sessionId],
  );

  /** Escape: stop generating, but keep what was written so far. */
  const interrupt = useCallback(() => {
    stopActiveStream(true);
  }, [stopActiveStream]);

  /** Unmount / navigation: stop generating and discard the partial reply. */
  const abort = useCallback(() => {
    stopActiveStream(false);
  }, [stopActiveStream]);

  /**
   * A conversation that ends on a user turn is owed an answer — that is how a
   * freshly created session (and a reopened one that was interrupted) starts
   * streaming without the caller asking. The ref makes it strictly once per
   * mount, so a changing `resume` identity can't re-trigger it.
   */
  const hasAutoResumedRef = useRef(false);

  useEffect(() => {
    if (hasAutoResumedRef.current) return;

    const last = initialMessages[initialMessages.length - 1];
    if (!last || last.role !== "user") return;

    hasAutoResumedRef.current = true;
    void resume({ mode: last.mode, model: last.model });
  }, [initialMessages, resume]);

  return { messages, streaming, submit, abort, interrupt };
}

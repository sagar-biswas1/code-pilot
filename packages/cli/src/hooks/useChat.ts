/**
 * Chat session state machine.
 *
 * Owns two stores that together make up the visible conversation:
 *
 *   `messages`  — committed turns (user, assistant, error), the source of truth
 *   `streaming` — the single in-flight assistant reply, rendered separately so
 *                 every token doesn't have to re-key the whole list
 *
 * When a stream ends, its text is committed into `messages` and `streaming`
 * returns to idle. The bubble on screen doesn't move; only who owns it does.
 *
 * Callbacks are declared in dependency order (leaves first) so nothing is
 * referenced above its own definition.
 */

import type { Mode } from "@codepilot/database/enums";
import {
  chatStreamEventSchema,
  type SupportedChatModelID,
} from "@codepilot/shared";
import type { ClientResponse } from "hono/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EventSourceParserStream } from "eventsource-parser/stream";
import prettyMs from "pretty-ms";

import { getErrorMessage } from "../lib/httpErrors";
import { apiClient } from "../lib/apiClient";

export type ClientMessagePart = { type: "text"; text: string };

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

type RunStreamParams = {
  mode: Mode;
  model: SupportedChatModelID;
  request: (controller: AbortController) => Promise<ClientResponse<unknown>>;
};

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

export function useChat(sessionId: string, initialMessages: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [streaming, setStreaming] = useState<StreamingState>({
    status: "idle",
  });

  const activeStreamRef = useRef<ActiveStream | null>(null);

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

  const handleStream = useCallback(
    async (response: ClientResponse<unknown>, activeStream: ActiveStream) => {
      if (!isActiveRequest(activeStream.requestId)) return;
      if (!response.ok) {
        appendErrorMessage(await getErrorMessage(response));
        return;
      }
      if (!response.body) {
        appendErrorMessage("Stream response had no body");
        return;
      }

      const parts: ClientMessagePart[] = [];
      const stream = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());

      for await (const { data } of stream) {
        if (!isActiveRequest(activeStream.requestId)) return;
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
            if (!isActiveRequest(activeStream.requestId)) return;
            const committed = parts.map(clonePart);
            updateMessages((prev) => [
              ...prev,
              {
                // The server's row id, so the message keeps its identity
                // across a reload and can be addressed later (retry, copy).
                id: event.messageId,
                role: "assistant",
                content: joinPartsText(committed),
                mode: activeStream.mode,
                model: activeStream.model,
                parts: committed,
                duration: prettyMs(event.durationMs),
              },
            ]);
            break;
          }
          case "error": {
            appendErrorMessage(event.message || "unknown error");
            break;
          }
        }
      }
    },
    [updateMessages, appendErrorMessage, emitParts, isActiveRequest],
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

  const runStream = useCallback(
    async ({ mode, model, request }: RunStreamParams) => {
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

      try {
        const response = await request(controller);
        await handleStream(response, activeStream);
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
    [clearStream, handleStream, appendErrorMessage],
  );

  const resume = useCallback(
    async ({ mode, model }: Omit<SubmitParams, "userText">) => {
      await runStream({
        mode,
        model,
        request: async (controller) =>
          apiClient.chat[":sessionId"].resume.$post(
            { param: { sessionId } },
            { init: { signal: controller.signal } },
          ),
      });
    },
    [runStream, sessionId],
  );

  const submit = useCallback(
    async ({ userText, mode, model }: SubmitParams) => {
      stopActiveStream(true);

      updateMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: userText, mode, model },
      ]);

      await runStream({
        mode,
        model,
        request: async (controller) =>
          apiClient.chat[":sessionId"].$post(
            {
              param: { sessionId },
              json: { content: userText, mode, model },
            },
            { init: { signal: controller.signal } },
          ),
      });
    },
    [stopActiveStream, updateMessages, runStream, sessionId],
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

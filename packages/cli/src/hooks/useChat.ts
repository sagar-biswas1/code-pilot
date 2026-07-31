import type { Mode } from "@codepilot/database/enums";
import {
  chatStreamEventSchema,
  type SupportedChatModelID,
} from "@codepilot/shared";
import type { ClientResponse } from "hono/client";
import { useCallback, useRef, useState } from "react";
import { getErrorMessage } from "../lib/httpErrors";
import { EventSourceParserStream } from "eventsource-parser/stream";
export type ClientMessagePart = { type: "text"; text: string };
import prettyMs from "pretty-ms";
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
  duration?: string;
  controller: AbortController;
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

export function useChat(sessionId: string, initialMessage: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initialMessage);
  const [streaming, setStreaming] = useState<StreamingState>({
    status: "idle",
  });

  const activeStreamRef = useRef<ActiveStream | null>(null);
  const updateMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setMessages((prev) => {
        return updater(prev);
      });
    },
    [],
  );

  const isActiveRequest = useCallback((requestId: string) => {
    return activeStreamRef.current?.requestId === requestId;
  }, []);

  const emitParts = useCallback(
    (requestId: string, parts: ClientMessagePart[]) => {
      if (!isActiveRequest(requestId)) return;

      const snapshot = [...parts];
      const activeStream = activeStreamRef.current;
      if (!activeStream) return;
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
        const message = await getErrorMessage(response);
        updateMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "error", content: message },
        ]);

        return;
      }
      const parts: ClientMessagePart[] = [];
      const stream = response
        .body!.pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());

      for await (const { data } of stream) {
        if (!isActiveRequest(activeStream.requestId)) return;
        let event;
        try {
          event = chatStreamEventSchema.parse(JSON.parse(data));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "invalid stream event";
          updateMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "error", content: message },
          ]);
          break;
        }
        switch (event.type) {
          case "text-delta": {
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
            const fullText = parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("");
            updateMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: fullText,
                mode: activeStream.mode,
                model: activeStream.model,
                parts: [...parts],
                duration: prettyMs(event.durationMs),
              },
            ]);
            break;
          }
          case "error": {
            const message = event.message || "unknown error";
            updateMessages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: "error", content: message },
            ]);
            break;
          }
        }
      }
    },
    [updateMessages, emitParts, isActiveRequest],
  );
}

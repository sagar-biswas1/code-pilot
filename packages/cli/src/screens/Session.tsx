import { MessageStatus } from "@codepilot/database/enums";
import { type SupportedChatModelID } from "@codepilot/shared";
import { useKeyboard } from "@opentui/react";
import type { InferResponseType } from "hono/client";
import prettyMs from "pretty-ms";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { z } from "zod";

import { SessionShell } from "../components/SessionShell";
import { BotMessage, ErrorMessage, UserMessage } from "../components/messages";
import { useChat, type Message } from "../hooks/useChat";
import { apiClient } from "../lib/apiClient";
import { getErrorMessage } from "../lib/httpErrors";
import { useKeyboardLayer } from "../providers/keyboardLayer";
import { usePromptConfig } from "../providers/promptConfig";
import { useToast } from "../providers/toast";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>(
    (val) => val != null && typeof val === "object" && "id" in val,
  ),
});

/**
 * Translate stored rows into the client-side message shape.
 *
 * `duration` is persisted in milliseconds — the same unit the `done` stream
 * event carries — so both paths can hand it straight to `prettyMs`.
 */
function mapDBMessages(dbMessages: SessionData["messages"]): Message[] {
  return dbMessages.map((message) => {
    if (message.role === "ERROR") {
      return {
        id: message.id,
        role: "error",
        content: message.content,
      };
    }
    if (message.role === "USER") {
      return {
        id: message.id,
        role: "user",
        content: message.content,
        mode: message.mode,
        model: message.model as SupportedChatModelID,
      };
    }
    return {
      id: message.id,
      role: "assistant",
      content: message.content,
      mode: message.mode,
      model: message.model as SupportedChatModelID,
      parts: [{ type: "text", text: message.content }],
      duration:
        message.duration != null ? prettyMs(message.duration) : undefined,
      interrupted: message.status === MessageStatus.INTERRUPTED,
    };
  });
}

function ChatMessage({ message }: { message: Message }) {
  if (message.role === "user") {
    return <UserMessage message={message.content} />;
  }

  if (message.role === "error") {
    return <ErrorMessage message={message.content} />;
  }

  return (
    <BotMessage
      parts={message.parts}
      model={message.model}
      mode={message.mode}
      duration={message.duration}
      streaming={false}
      interrupted={message.interrupted}
    />
  );
}

function SessionChat({ session }: { session: SessionData }) {
  const { mode, model } = usePromptConfig();
  // Computed once per session — `useChat` seeds its own state from this and
  // owns the conversation from then on.
  const initialMessages = useMemo(
    () => mapDBMessages(session.messages),
    [session],
  );

  const { isTopLayer } = useKeyboardLayer();
  const { messages, streaming, submit, abort, interrupt } = useChat(
    session.id,
    initialMessages,
  );

  // Leaving the screen discards the in-flight reply; the server persists its
  // own partial copy when it sees the connection drop.
  useEffect(() => abort, [abort]);

  useKeyboard((key) => {
    if (
      key.name === "escape" &&
      isTopLayer("base") &&
      streaming.status === "streaming"
    ) {
      // Keep the focused textarea from also acting on Escape.
      key.preventDefault();
      interrupt();
    }
  });

  const handleSubmit = useCallback(
    (text: string) => {
      void submit({
        userText: text,
        mode,
        model,
      });
    },
    [submit],
  );

  const isStreaming = streaming.status === "streaming";

  return (
    <SessionShell
      interruptible={isStreaming}
      onSubmit={handleSubmit}
      inputDisabled={isStreaming}
      loading={isStreaming}
    >
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}

      {streaming.status === "streaming" && streaming.parts.length > 0 && (
        <BotMessage
          parts={streaming.parts}
          model={streaming.model}
          mode={streaming.mode}
          streaming
        />
      )}
    </SessionShell>
  );
}

export function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();

  // `NewSession` hands the freshly created session over in router state, so
  // the common path renders instantly instead of round-tripping for data it
  // was just given.
  const prefetched = useMemo(() => {
    const locationState = sessionLocationSchema.safeParse(location.state);
    return locationState.success ? locationState.data.session : null;
  }, [location.state]);

  const [session, setSession] = useState<SessionData | null>(prefetched);

  useEffect(() => {
    if (prefetched) {
      setSession(prefetched);
      return;
    }
    setSession(null);
    if (!sessionId) return;

    let ignore = false;
    const fetchSession = async () => {
      try {
        const response = await apiClient.sessions[":id"].$get({
          param: { id: sessionId },
        });
        if (ignore) return;
        if (!response.ok) {
          throw new Error(await getErrorMessage(response));
        }
        const data = await response.json();
        if (ignore) return;
        setSession(data);
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            error instanceof Error ? error.message : "Failed to load session",
        });
        navigate("/", { replace: true });
      }
    };

    void fetchSession();
    return () => {
      ignore = true;
    };
  }, [sessionId, prefetched, toast, navigate]);

  if (!session) {
    return <SessionShell onSubmit={() => {}} inputDisabled loading />;
  }
  // Keyed so switching sessions remounts the chat rather than mixing state.
  return <SessionChat session={session} key={session.id} />;
}

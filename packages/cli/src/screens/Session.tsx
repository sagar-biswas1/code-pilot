import { useLocation, useNavigate, useParams } from "react-router";
import { useTheme } from "../providers/theme";
import { useEffect, useMemo, useState } from "react";
import { spacing } from "../theme";
import { SessionShell } from "../components/SessionShell";
import type { InferResponseType } from "hono/client";
import prettyMs from "pretty-ms";
import { apiClient } from "../lib/apiClient";
import { z } from "zod";
import { BotMessage, ErrorMessage, UserMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { getErrorMessage } from "../lib/httpErrors";
import {
  DEFAULT_CHAT_MODEL_ID,
  type SupportedChatModelID,
} from "@codepilot/shared";
import { useChat, type Message } from "../hooks/useChat";

type sessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;
const sessionLocationSchema = z.object({
  session: z.custom<sessionData>(
    (val) => val != null && typeof val === "object" && "id" in val,
  ),
});

function mapDBMessages(dbMessages: sessionData["messages"]): Message[] {
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
      duration: message.duration ? prettyMs(message.duration) : undefined,
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
    />
  );
}

function SessionChat({ session }: { session: sessionData }) {
  const [initialMessages, setInitialMessages] = useState(() =>
    mapDBMessages(session.messages),
  );

  const { messages, streaming, submit, abort } = useChat(
    session.id,
    initialMessages,
  );

  useEffect(() => {
    return () => abort();
  }, []);
  return (
    <SessionShell
      onSubmit={(text) =>
        submit({
          userText: text,
          mode: "BUILD",
          model: DEFAULT_CHAT_MODEL_ID,
        })
      }
      inputDisabled={streaming.status === "streaming"}
      loading={streaming.status === "streaming"}
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
  const { colors } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const prefetched = useMemo(() => {
    const locationState = sessionLocationSchema.safeParse(location.state);
    return locationState.success ? locationState.data.session : null;
  }, [location.state]);

  const [session, setSession] = useState<sessionData | null>(prefetched);

  useEffect(() => {
    if (prefetched) return;
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
        if (ignore) return;
        setSession(await response.json());
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

    fetchSession();
    return () => {
      ignore = true;
    };
  }, [sessionId]);

  if (!session)
    return <SessionShell onSubmit={() => {}} inputDisabled loading={false} />;
  return <SessionChat session={session} key={session.id} />;
}

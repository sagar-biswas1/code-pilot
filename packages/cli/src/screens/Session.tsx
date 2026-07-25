import { useLocation, useNavigate, useParams } from "react-router";
import { useTheme } from "../providers/theme";
import { useEffect, useMemo, useState } from "react";
import { spacing } from "../theme";
import { SessionShell } from "../components/SessionShell";
import type { InferResponseType } from "hono/client";

import { apiClient } from "../lib/apiClient";
import { z } from "zod";
import { BotMessage, ErrorMessage, UserMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { getErrorMessage } from "../lib/httpErrors";

type sessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;
const sessionLocationSchema = z.object({
  session: z.custom<sessionData>(
    (val) => val != null && typeof val === "object" && "id" in val,
  ),
});

function ChatMessage({
  message,
}: {
  message: sessionData["messages"][number];
}) {
  if (message.role === "user") {
    return <UserMessage message={message.content} />;
  }

  if (message.role === "error") {
    return <ErrorMessage message={message.content} />;
  }

  return <BotMessage content={message.content} model={message.model} />;
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
  return (
    <SessionShell onSubmit={() => {}} inputDisabled={false} loading={false}>
      {session.messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
    </SessionShell>
  );
}

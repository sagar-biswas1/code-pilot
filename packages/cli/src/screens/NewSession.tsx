import { useLocation, useNavigate } from "react-router";
import { useTheme } from "../providers/theme";
import { useEffect, useMemo, useRef } from "react";
import { spacing } from "../theme";
import { ErrorMessage } from "../components/messages/ErrorMessage";
import { SessionShell } from "../components/SessionShell";
import { UserMessage } from "../components/messages";
import { z } from "zod";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/apiClient";
import { DEFAULT_CHAT_MODEL_ID } from "@codepilot/shared";
import { getErrorMessage } from "../lib/httpErrors";

const newSessionStateSchema = z.object({
  message: z.string(),
});

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const hasStartedRef = useRef(false);

  const state = useMemo(() => {
    const parsed = newSessionStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  const { colors } = useTheme();

  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  useEffect(() => {
    if (!state || hasStartedRef.current) return;
    hasStartedRef.current = true;

    let ignore = false;
    const createSession = async () => {
      try {
        const res = await apiClient.sessions.$post({
          json: {
            title: state?.message?.slice(0, 100),
            cwd: process.cwd(),
            initialMessage: {
              role: "user",
              content: state?.message,
              mode: "BUILD",
              model: DEFAULT_CHAT_MODEL_ID,
            },
          },
        });

        if (ignore) return;
        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }
        const session = await res.json();
        navigate(`/sessions/${session.id}`, {
          replace: true,
          state: {
            session,
          },
        });
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            error instanceof Error ? error.message : "Failed to create session",
        });
        navigate("/", { replace: true });
      }
    };
    createSession();

    return () => {
      ignore = true;
    };
  }, [state, toast, navigate]);

  if (!state?.message) return null;
  return (
    <SessionShell onSubmit={() => {}} inputDisabled loading>
      <text>Creating session...</text>
      <UserMessage message={state?.message} />
    </SessionShell>
  );
}

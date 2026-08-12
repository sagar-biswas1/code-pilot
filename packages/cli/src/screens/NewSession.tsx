/**
 * Transient screen between "user typed a prompt on Home" and a real session.
 *
 * It creates the session (plus its first USER message) and immediately hands
 * off to `/sessions/:id`. It never asks for a reply — the session screen sees
 * a conversation ending on a user turn and resumes it from there.
 */

import { useLocation, useNavigate } from "react-router";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";

import { SessionShell } from "../components/SessionShell";
import { UserMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/apiClient";
import { getErrorMessage } from "../lib/httpErrors";
import { Mode } from "@codepilot/database/enums";

const newSessionStateSchema = z.object({
  message: z.string().min(1),
  mode: z.enum(Mode),
  model: z.string(),
});

/** Sessions are listed by title, so keep it short but recognisable. */
const MAX_TITLE_LENGTH = 100;

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  // Set before the request goes out, and never reset: creating the same
  // session twice because an effect re-ran would leave an orphan row.
  const hasStartedRef = useRef(false);
  // Mirrors mount state so a late response can't navigate after teardown.
  const isMountedRef = useRef(true);

  const state = useMemo(() => {
    const parsed = newSessionStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reached by navigating here directly, without a prompt to send.
  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  useEffect(() => {
    if (!state || hasStartedRef.current) return;
    hasStartedRef.current = true;

    const createSession = async () => {
      try {
        const res = await apiClient.sessions.$post({
          json: {
            title: state.message.slice(0, MAX_TITLE_LENGTH),
            cwd: process.cwd(),
            initialMessage: {
              role: "USER",
              content: state.message,
              mode: state.mode,
              model: state.model,
            },
          },
        });

        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }
        const session = await res.json();
        if (!isMountedRef.current) return;

        // `replace` so Back never returns to this placeholder screen.
        navigate(`/sessions/${session.id}`, {
          replace: true,
          state: { session },
        });
      } catch (error) {
        if (!isMountedRef.current) return;
        toast.show({
          variant: "error",
          message:
            error instanceof Error ? error.message : "Failed to create session",
        });
        navigate("/", { replace: true });
      }
    };

    void createSession();
  }, [state, toast, navigate]);

  if (!state) return null;

  return (
    <SessionShell onSubmit={() => {}} inputDisabled loading>
      <UserMessage message={state.message} mode={state.mode} />
      <text>Creating session…</text>
    </SessionShell>
  );
}

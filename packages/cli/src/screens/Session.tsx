import { useNavigate, useParams } from "react-router";
import { useTheme } from "../providers/theme";
import { useEffect } from "react";
import { spacing } from "../theme";
import { SessionShell } from "../components/SessionShell";

export function Session() {
  const { sessionId } = useParams();
  const { colors } = useTheme();
  const navigate = useNavigate();
  useEffect(() => {
    if (!sessionId) {
      navigate("/", { replace: true });
    }
  }, [sessionId, navigate]);
  if (!sessionId) return null;
  return (
    <SessionShell
    onSubmit={() => {}}
    inputDisabled={false}
    loading={false}
   >
   <text>Session {sessionId}</text>
    </SessionShell>
  );
}

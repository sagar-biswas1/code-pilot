import { useLocation, useNavigate } from "react-router";
import { useTheme } from "../providers/theme";
import { useEffect } from "react";
import { spacing } from "../theme";
import { ErrorMessage } from "../components/messages/ErrorMessage";
import { SessionShell } from "../components/SessionShell";
import { BotMessage, UserMessage } from "../components/messages";

export function NewSession() {
  const navigate = useNavigate();
  const { message } = (useLocation().state as { message: string }) || {
    message: "",
  };
  const { colors } = useTheme();

  useEffect(() => {
    if (!message) {
      navigate("/", { replace: true });
    }
  }, [message, navigate]);
  if (!message) return null;
  return (
    <SessionShell onSubmit={() => {}} inputDisabled loading>
     <UserMessage message={message}/>
     <BotMessage 
     content="Hello, how can I help you today?"
     model="gpt-4o"
     />
     <ErrorMessage message="Error: Invalid request" />
    </SessionShell>
  );
}

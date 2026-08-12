import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useTheme } from "../providers/theme";
import { Header } from "../components/Header";
import { InputBar } from "../components/InputBar";
import { usePromptConfig } from "../providers/promptConfig";

export function Home() {
  const { mode, model } = usePromptConfig();
  const { colors } = useTheme();
  const navigate = useNavigate();

  // Same reason as in `Session`: without `mode`/`model` in the deps this
  // closure keeps the values it captured on mount, so toggling the mode before
  // sending the first message creates the session with the stale one.
  const handleSubmit = useCallback(
    (text: string) => {
      navigate("/sessions/new", { state: { message: text, mode, model } });
    },
    [navigate, mode, model],
  );

  return (
    <box
      flexGrow={1}
      backgroundColor={colors.background}
      width="100%"
      height="100%"
    >
      <Header />

      <box flexGrow={1} />
      <box backgroundColor={colors.surface}>
        <InputBar onSubmit={handleSubmit} />
      </box>
    </box>
  );
}

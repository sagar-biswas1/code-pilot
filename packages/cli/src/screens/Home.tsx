import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useTheme } from "../providers/theme";
import { Header } from "../components/Header";
import { InputBar } from "../components/InputBar";
import { Spinner } from "../components/Spinner";

export function Home() {
  const { colors } = useTheme();
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    (text: string) => {
      navigate("/sessions/new", { state: { message: text } });
    },
    [navigate],
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

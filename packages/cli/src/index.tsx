import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Header } from "./components/Header";
import { InputBar } from "./components/InputBar";
import { StatusBar } from "./components/StatusBar";
import { colors } from "./theme";
import { ToastProvider } from "./providers/toast";
import { KeyboardLayerProvider } from "./providers/keyboardLayer";

function App() {
  return (
    <ToastProvider>
      <KeyboardLayerProvider>
        <AppContent />
      </KeyboardLayerProvider>
    </ToastProvider>
  );
}

const AppContent = () => {
  return (
    <box flexGrow={1}>
      <Header />
      <box flexGrow={1} />
      <box backgroundColor={colors.surface}>
        <InputBar onSubmit={(value) => console.log(value)} />
      </box>
    </box>
  );
};

const renderer = await createCliRenderer({
  targetFps: 60,
  // KeyboardLayerProvider owns Ctrl+C (clear textarea first, quit on the
  // second press) so the built-in exit must stay off.
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);

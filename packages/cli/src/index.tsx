/**
 * CLI entry point.
 *
 * Boots the OpenTUI renderer and mounts the React tree. Provider order
 * matters: `ThemeProvider` sits outermost so every colored surface (toasts,
 * dialogs, app content) can read the active theme; `KeyboardLayerProvider`
 * must wrap `DialogProvider` (and anything else that pushes a keyboard layer)
 * so Escape/Ctrl+C routing works, and `ToastProvider` sits above the dialog so
 * toasts render on top.
 */

import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Header } from "./components/Header";
import { InputBar } from "./components/InputBar";
import { StatusBar } from "./components/StatusBar";
import { ThemeProvider, useTheme } from "./providers/theme";
import { ToastProvider } from "./providers/toast";
import { KeyboardLayerProvider } from "./providers/keyboardLayer";
import { DialogProvider } from "./providers/dialog";

/** Root component — wires the global providers around the app content. */
function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <KeyboardLayerProvider>
          <DialogProvider>
            <AppContent />
          </DialogProvider>
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/** Screen layout: header at the top, flexible spacer, input pinned to bottom. */
const AppContent = () => {
  const { colors } = useTheme();
  return (
    <box flexGrow={1} backgroundColor={colors.background}>
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

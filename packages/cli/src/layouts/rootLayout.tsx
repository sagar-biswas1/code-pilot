import { Outlet } from "react-router";
import { DialogProvider } from "../providers/dialog";
import { KeyboardLayerProvider } from "../providers/keyboardLayer";
import { ThemeProvider } from "../providers/theme";
import { ToastProvider } from "../providers/toast";
import { ThemedRoot } from "./themeRoot";

/**
 * Shared parent of every screen. Provider order is load-bearing:
 *
 *   ThemeProvider          outermost — every colored surface reads from it
 *     ToastProvider        renders above dialogs, so errors stay visible
 *       KeyboardLayerProvider   must wrap anything that pushes a key layer
 *         DialogProvider        pushes the "dialog" layer when opened
 */
export function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <KeyboardLayerProvider>
          <DialogProvider>
            <ThemedRoot>
              <Outlet />
            </ThemedRoot>
          </DialogProvider>
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

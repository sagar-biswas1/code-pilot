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
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/rootLayout";
import { Home } from "./screens/Home";
import { NewSession } from "./screens/NewSession";
import { Session } from "./screens/Session";

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: "sessions/new",
        element: <NewSession />,
      },
      {
        path: "sessions/:sessionId",
        element: <Session />,
      },
    ],
  },
]);

/** Root component — wires the global providers around the app content. */
function App() {
  return <RouterProvider router={router} />;
}

const renderer = await createCliRenderer({
  targetFps: 60,
  // KeyboardLayerProvider owns Ctrl+C (clear textarea first, quit on the
  // second press) so the built-in exit must stay off.
  exitOnCtrlC: false,
  // Pop the captured-log overlay automatically when something logs an error.
  openConsoleOnError: true,
});

// OpenTUI captures console.* into an in-app overlay; show it so logs are visible.
// renderer.console.show();

createRoot(renderer).render(<App />);

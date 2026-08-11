/**
 * CLI entry point.
 *
 * Boots the OpenTUI renderer and mounts the React tree. Routing uses a memory
 * router — there is no URL bar in a terminal — and every screen renders under
 * `RootLayout`, which owns the global providers (see `layouts/rootLayout.tsx`
 * for why their nesting order matters).
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
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
        path: "sessions",
        children: [
          {
            path: "new",
            element: <NewSession />,
          },
          {
            path: ":sessionId",
            element: <Session />,
          },
        ],
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

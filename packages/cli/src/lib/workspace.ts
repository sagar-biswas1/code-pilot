/**
 * The directory this CLI session is working in.
 *
 * Captured once, at import, and never re-read. `process.cwd()` can change
 * underneath a running process (anything can call `process.chdir`), and a
 * workspace root that moves mid-conversation would silently re-point every
 * tool — including the containment check that keeps them inside the project.
 * Resolving symlinks here means the value matches what `Workspace` computes,
 * so the path the model is told about is the path its tools actually use.
 *
 * This is also what makes the tool usable in any project: there is no stored
 * per-session directory and nothing to configure. Wherever the CLI is started
 * is the workspace.
 */

import { realpathSync } from "node:fs";

import type { WorkspaceContext } from "@codepilot/shared";

export const WORKSPACE_ROOT: string = (() => {
  const cwd = process.cwd();
  try {
    return realpathSync.native(cwd);
  } catch {
    // A cwd that cannot be resolved is still worth reporting — the tools will
    // fail with a clearer message than a crash at startup would give.
    return cwd;
  }
})();

/** The workspace fields sent with every chat request. */
export function workspaceContext(): WorkspaceContext {
  return { cwd: WORKSPACE_ROOT };
}

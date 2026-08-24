import { FileLedger } from "./fileLedger";
import { Workspace, type WorkspaceOptions } from "./workspace";

/**
 * State shared by every tool in one session.
 *
 * It is built once per stream rather than per tool call, because both pieces
 * are session-scoped by nature: the sandbox boundary must be identical for all
 * tools (otherwise one tool becomes the weak link), and the read ledger is only
 * meaningful if `readFile` and `editFile` are looking at the same map.
 */
export interface ToolContext {
  workspace: Workspace;
  ledger: FileLedger;
}

export interface CreateToolContextOptions extends WorkspaceOptions {
  /** Absolute path the session is rooted at — nothing outside it is reachable. */
  workspaceRoot: string;
}

export function createToolContext({
  workspaceRoot,
  ...workspaceOptions
}: CreateToolContextOptions): ToolContext {
  return {
    workspace: Workspace.create(workspaceRoot, workspaceOptions),
    ledger: new FileLedger(),
  };
}

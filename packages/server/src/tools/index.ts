import type { Mode } from "@codepilot/database/enums";
import type { ToolSet } from "ai";

import { createToolContext, type ToolContext } from "./lib/context";
import { createBashTool, type BashToolOptions } from "./bash";
import { createEditFileTool } from "./editFile";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createListDirTool } from "./listDir";
import { createReadFileTool } from "./readFile";
import { createWriteFileTool } from "./writeFile";

/**
 * The tool set handed to the model, built once per stream.
 *
 * Two things are worth spelling out:
 *
 * **Mode is enforced here, not in the prompt.** PLAN mode simply does not
 * receive the mutating tools. A prompt that says "do not edit files" is a
 * request; a tool set without `writeFile` is a guarantee, and it is the only
 * version that survives prompt injection from a file the model reads.
 *
 * **Tools are per-session, not module-level singletons.** Each carries its own
 * `Workspace` (rooted at that session's cwd) and its own read ledger, so two
 * concurrent sessions cannot see each other's files or each other's history.
 */

export interface CreateToolsOptions {
  /** Absolute path of the session's working directory. */
  workspaceRoot: string;
  /** PLAN gets read-only tools; BUILD gets the mutating ones as well. */
  mode: Mode;
  /**
   * Restrict `runCommand` to these binaries. Strongly recommended when the
   * server is not already isolated at the OS level — see the note in `bash.ts`.
   */
  allowedBinaries?: string[];
  /** Additional denied path patterns, matched on workspace-relative paths. */
  deniedPatterns?: RegExp[];
  /** Extra `runCommand` options (environment, timeouts, blocked patterns). */
  bash?: Omit<BashToolOptions, "cwd" | "allowedBinaries">;
}

/** Tools that only observe. Safe in every mode. */
function readOnlyTools(context: ToolContext) {
  return {
    readFile: createReadFileTool(context),
    listDirectory: createListDirTool(context),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
  };
}

export function createTools(options: CreateToolsOptions): ToolSet {
  const context = createToolContext({
    workspaceRoot: options.workspaceRoot,
    deniedPatterns: options.deniedPatterns,
  });

  if (options.mode === "PLAN") {
    return readOnlyTools(context);
  }

  return {
    ...readOnlyTools(context),
    writeFile: createWriteFileTool(context),
    editFile: createEditFileTool(context),
    runCommand: createBashTool({
      ...options.bash,
      cwd: context.workspace.root,
      allowedBinaries: options.allowedBinaries,
    }),
  };
}

export { createToolContext, type ToolContext } from "./lib/context";
export { Workspace, type WorkspaceOptions } from "./lib/workspace";
export { FileLedger } from "./lib/fileLedger";
export { LIMITS, DEFAULT_IGNORED_DIRECTORIES } from "./lib/limits";
export { isToolError, type ToolError, type ToolErrorCode } from "./lib/result";
export { createBashTool, type BashToolOptions } from "./bash";
export { createEditFileTool } from "./editFile";
export { createGlobTool } from "./glob";
export { createGrepTool } from "./grep";
export { createListDirTool } from "./listDir";
export { createReadFileTool } from "./readFile";
export { createWriteFileTool } from "./writeFile";

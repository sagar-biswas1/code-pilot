/**
 * Tool execution — the half that runs on the user's machine.
 *
 * The server decides *what* to call; this decides whether that call is
 * allowed and then performs it. Everything the model asks for arrives over the
 * network as untyped JSON, so the runner treats it as hostile input and checks
 * four things before any syscall happens:
 *
 * 1. **The name is one we know.** An unrecognised tool is an error, not a
 *    lookup on a bare object (which would happily resolve `constructor`).
 * 2. **The mode allows it.** PLAN mode never receives the mutating tools, but
 *    this side re-checks anyway — the server's word is not what protects the
 *    user's files, this is.
 * 3. **The arguments match the declared schema.** The model produces these,
 *    and a hallucinated field must not reach a path resolver.
 * 4. **The tool is contained.** `Workspace` keeps every path inside the
 *    directory the CLI was started in; see `lib/workspace.ts`.
 *
 * A failure at any step is *returned*, never thrown: the model has to see it
 * as a tool result so it can correct itself on the next step.
 */

import {
  TOOL_DEFINITIONS,
  isToolAllowedInMode,
  isToolName,
  type ToolMode,
  type ToolName,
} from "@codepilot/shared";

import { createToolContext } from "./lib/context";
import { toolError } from "./lib/result";
import type { ToolExecuteOptions, ToolExecutor } from "./lib/executor";
import { createReadFileExecutor } from "./executors/readFile";
import { createListDirExecutor } from "./executors/listDir";
import { createGlobExecutor } from "./executors/glob";
import { createGrepExecutor } from "./executors/grep";
import { createWriteFileExecutor } from "./executors/writeFile";
import { createEditFileExecutor } from "./executors/editFile";
import { createRunCommandExecutor } from "./executors/bash";

export interface CreateToolRunnerOptions {
  /** Absolute path the session is rooted at — normally the CLI's cwd. */
  workspaceRoot: string;
  /**
   * Restrict `runCommand` to these binaries. Off by default: the commands run
   * on the user's own machine, in their own project, so an allowlist here
   * mostly gets in the way of the builds and tests the model is asked to run.
   * It stays available for anyone embedding the runner somewhere less trusted.
   */
  allowedBinaries?: string[];
}

export interface RunToolOptions extends ToolExecuteOptions {
  /** PLAN gets read-only tools; BUILD gets the mutating ones as well. */
  mode: ToolMode;
}

export interface ToolRunner {
  /** Where the tools are rooted. Shown to the user and sent as prompt context. */
  readonly workspaceRoot: string;
  run(name: string, args: unknown, options: RunToolOptions): Promise<unknown>;
}

/**
 * Keyed by `ToolName`, so a tool added to the shared definitions without an
 * implementation here fails to compile rather than failing at runtime on
 * whichever conversation happens to call it first.
 */
type ExecutorMap = { [N in ToolName]: ToolExecutor<N> };

/**
 * One runner per conversation, not one per process and not one per turn.
 *
 * The read ledger it holds is what lets `writeFile` refuse to overwrite a file
 * the model never looked at, and "never looked at" is a fact about the whole
 * conversation — rebuilding the runner each turn would make the model re-read
 * a file it read two messages ago. A module-level singleton would go too far
 * the other way and leak one conversation's reads into the next.
 *
 * Mode is per *call* rather than per runner for the same reason: the user can
 * switch between PLAN and BUILD mid-conversation, and the ledger should
 * survive that.
 */
export function createToolRunner({
  workspaceRoot,
  allowedBinaries,
}: CreateToolRunnerOptions): ToolRunner {
  const context = createToolContext({ workspaceRoot });

  const executors: ExecutorMap = {
    readFile: createReadFileExecutor(context),
    listDirectory: createListDirExecutor(context),
    glob: createGlobExecutor(context),
    grep: createGrepExecutor(context),
    writeFile: createWriteFileExecutor(context),
    editFile: createEditFileExecutor(context),
    runCommand: createRunCommandExecutor({
      cwd: context.workspace.root,
      allowedBinaries,
    }),
  };

  return {
    workspaceRoot: context.workspace.root,

    async run(name, args, options) {
      const { mode } = options;

      if (!isToolName(name)) {
        return toolError("invalid_input", `Unknown tool: ${name}`);
      }
      if (!isToolAllowedInMode(name, mode)) {
        return toolError(
          "policy",
          `${name} is not available in ${mode} mode. Switch to BUILD mode to change files.`,
        );
      }

      const parsed = TOOL_DEFINITIONS[name].inputSchema.safeParse(args);
      if (!parsed.success) {
        return toolError(
          "invalid_input",
          `Invalid arguments for ${name}: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
            .join("; ")}`,
        );
      }

      // The executors are written to return errors rather than throw, but a
      // bug in one of them must not take down the turn — the model can recover
      // from a failed tool result, not from a dead stream.
      try {
        const executor = executors[name] as ToolExecutor<ToolName>;
        return await executor(parsed.data, options);
      } catch (error) {
        if (options.abortSignal?.aborted) {
          return toolError("aborted", `${name} was cancelled.`);
        }
        return toolError(
          "io_error",
          `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

export { createToolContext, type ToolContext } from "./lib/context";
export { Workspace, type WorkspaceOptions } from "./lib/workspace";
export { FileLedger } from "./lib/fileLedger";
export { isToolError, type ToolError, type ToolErrorCode } from "./lib/result";
export type { ToolExecuteOptions, ToolExecutor } from "./lib/executor";

import type { z } from "zod";

import type { TOOL_DEFINITIONS, ToolName } from "@codepilot/shared";

/**
 * The input a tool receives, derived from the schema the server advertised.
 *
 * Deriving it means the executor's parameter list is checked against the same
 * declaration the model was given. Renaming a field in `definitions.ts`
 * without updating the implementation is a compile error rather than a tool
 * that silently receives `undefined`.
 */
export type ToolInput<N extends ToolName> = z.infer<
  (typeof TOOL_DEFINITIONS)[N]["inputSchema"]
>;

export interface ToolExecuteOptions {
  /** Aborted when the user interrupts the turn. Long-running tools honour it. */
  abortSignal?: AbortSignal;
}

/**
 * A tool's implementation.
 *
 * The return value is deliberately `unknown`: it is JSON-encoded and handed
 * straight back to the model, and nothing in between reads into it. Tools
 * report failure by *returning* a `ToolError` rather than throwing — see
 * `lib/result.ts` for why.
 */
export type ToolExecutor<N extends ToolName> = (
  input: ToolInput<N>,
  options: ToolExecuteOptions,
) => Promise<unknown>;

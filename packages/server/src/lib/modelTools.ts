import { tool, type ToolSet } from "ai";
import {
  TOOL_DEFINITIONS,
  toolNamesForMode,
  type ToolMode,
  type ToolName,
} from "@codepilot/shared";

/**
 * The tool set advertised to the model — declarations only, no `execute`.
 *
 * That omission is the entire mechanism. When a tool has no `execute`, the AI
 * SDK emits the `tool-call` and *ends the step* instead of resolving it
 * itself, which is exactly what we want: the call travels down the SSE stream
 * to the CLI, runs against the user's real working directory, and comes back
 * on the next request. A tool with an `execute` here would silently run on the
 * server, against whatever happens to be on the VPS's disk.
 *
 * Because there is nothing to execute and no per-session state to carry, these
 * are built once at module load rather than per stream. Each entry is spelled
 * out instead of built in a loop so every `tool()` call sees one concrete
 * schema — over a union, the SDK cannot infer the input type.
 */
const MODEL_TOOLS = {
  readFile: tool({
    description: TOOL_DEFINITIONS.readFile.description,
    inputSchema: TOOL_DEFINITIONS.readFile.inputSchema,
  }),
  listDirectory: tool({
    description: TOOL_DEFINITIONS.listDirectory.description,
    inputSchema: TOOL_DEFINITIONS.listDirectory.inputSchema,
  }),
  glob: tool({
    description: TOOL_DEFINITIONS.glob.description,
    inputSchema: TOOL_DEFINITIONS.glob.inputSchema,
  }),
  grep: tool({
    description: TOOL_DEFINITIONS.grep.description,
    inputSchema: TOOL_DEFINITIONS.grep.inputSchema,
  }),
  writeFile: tool({
    description: TOOL_DEFINITIONS.writeFile.description,
    inputSchema: TOOL_DEFINITIONS.writeFile.inputSchema,
  }),
  editFile: tool({
    description: TOOL_DEFINITIONS.editFile.description,
    inputSchema: TOOL_DEFINITIONS.editFile.inputSchema,
  }),
  runCommand: tool({
    description: TOOL_DEFINITIONS.runCommand.description,
    inputSchema: TOOL_DEFINITIONS.runCommand.inputSchema,
  }),
} satisfies Record<ToolName, unknown>;

/**
 * Mode is enforced by *omission*, here and again in the CLI's runner. A prompt
 * that says "do not edit files" is a request the model can talk itself out of;
 * a tool set without `writeFile` is a guarantee, and it is the only version
 * that survives prompt injection from a file the model happens to read.
 */
export function createModelTools(mode: ToolMode): ToolSet {
  const tools: ToolSet = {};
  for (const name of toolNamesForMode(mode)) {
    tools[name] = MODEL_TOOLS[name];
  }
  return tools;
}

/**
 * The tool contract, shared by both halves of the system.
 *
 * Tools are *declared* here and *executed* in the CLI. The server never runs
 * them: it only needs each tool's name, description and input schema so the
 * model can be told what exists, and so a call coming back off the wire can be
 * validated before it is handed to the machine that will act on it.
 *
 * That split is the whole point. The workspace is the user's laptop, so a
 * server-side `readFile` would read the *server's* disk — which is either
 * empty or, on a shared VPS, someone else's. Keeping the schema here and the
 * implementation there means the two can never drift: the CLI's executor map
 * is keyed by `TOOL_NAMES`, and a missing entry is a type error.
 *
 * Nothing in this file may import Node APIs — it is loaded by the server, the
 * CLI, and (via the schemas) anything that validates a stream event.
 */

import { z } from "zod";

import { LIMITS } from "./limits";

/**
 * Mirrors Prisma's `Mode` enum by value rather than importing it: this package
 * is the dependency-free middle layer, and pulling in the database client to
 * get two string literals would invert that.
 */
export type ToolMode = "PLAN" | "BUILD";

export const readFileInputSchema = z.object({
  path: z
    .string()
    .describe(
      "File to read, relative to the workspace root (absolute paths inside the workspace are also accepted).",
    ),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based line number to start from. Use with `limit` to page through a file that was truncated.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.maxReadLines)
    .optional()
    .describe(
      `Maximum number of lines to return (default ${LIMITS.defaultReadLines}, hard cap ${LIMITS.maxReadLines}).`,
    ),
});

export const listDirectoryInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Directory to list, relative to the workspace root. Defaults to the workspace root.",
    ),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Include dotfiles and dot-directories. Defaults to false."),
  includeIgnored: z
    .boolean()
    .optional()
    .describe(
      "Include dependency and build directories (node_modules, dist, target, …). Defaults to false.",
    ),
});

export const globInputSchema = z.object({
  pattern: z
    .string()
    .describe(
      "Glob pattern, relative to `path`. Supports `*`, `**`, `?`, `[abc]` and `{a,b}` — e.g. `**/*.ts`, `src/**/{index,main}.tsx`.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Directory to search from, relative to the workspace root. Defaults to the workspace root.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.maxGlobResults)
    .optional()
    .describe(
      `Maximum paths to return (default and cap ${LIMITS.maxGlobResults}).`,
    ),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Include dotfiles and dot-directories. Defaults to false."),
  includeIgnored: z
    .boolean()
    .optional()
    .describe(
      "Search dependency and build directories (node_modules, dist, target, …). Defaults to false; enabling it is much slower.",
    ),
});

export const grepInputSchema = z.object({
  pattern: z
    .string()
    .describe(
      "JavaScript regular expression to search for. Set `literal` to true to search for the text exactly instead.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "File or directory to search, relative to the workspace root. Defaults to the workspace root.",
    ),
  glob: z
    .string()
    .optional()
    .describe(
      "Only search files whose path matches this glob, e.g. `**/*.ts`. Strongly recommended — it makes the search far faster.",
    ),
  literal: z
    .boolean()
    .optional()
    .describe(
      "Treat `pattern` as literal text rather than a regular expression.",
    ),
  caseInsensitive: z.boolean().optional().describe("Case-insensitive matching."),
  outputMode: z
    .enum(["content", "files", "count"])
    .optional()
    .describe(
      "`content` (default) returns matching lines, `files` returns only the file paths, `count` returns per-file match counts.",
    ),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe(
      "Lines of context to include before and after each match (content mode only).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.maxGrepMatches)
    .optional()
    .describe(
      `Maximum matches to return (default and cap ${LIMITS.maxGrepMatches}).`,
    ),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Search dotfiles. Defaults to false."),
  includeIgnored: z
    .boolean()
    .optional()
    .describe(
      "Search dependency and build directories. Defaults to false; enabling it is much slower.",
    ),
});

export const writeFileInputSchema = z.object({
  path: z.string().describe("File to write, relative to the workspace root."),
  content: z.string().describe("Full contents of the file."),
  createDirectories: z
    .boolean()
    .optional()
    .describe(
      "Create missing parent directories (inside the workspace). Defaults to true.",
    ),
});

export const editFileInputSchema = z.object({
  path: z.string().describe("File to edit, relative to the workspace root."),
  oldString: z
    .string()
    .min(1)
    .describe(
      "Exact text to replace, including indentation. Must appear exactly once unless `replaceAll` is true — include surrounding lines to make it unique.",
    ),
  newString: z.string().describe("Text to replace it with."),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of requiring a unique match."),
});

export const runCommandInputSchema = z.object({
  command: z.string().min(1).describe("The shell command to execute."),
  timeout: z
    .number()
    .int()
    .min(1_000)
    .max(LIMITS.bash.maxTimeoutMs)
    .optional()
    .describe(
      `Timeout in milliseconds (default ${LIMITS.bash.defaultTimeoutMs}, capped at ${LIMITS.bash.maxTimeoutMs}).`,
    ),
});

/**
 * Read-only tools, available in both modes.
 *
 * The mode split lives in this data, not in the prompt. A prompt that says
 * "do not edit files" is a request the model can talk itself out of; a tool
 * set without `writeFile` is a guarantee, and it is the only version that
 * survives prompt injection from a file the model happens to read.
 */
export const READ_ONLY_TOOL_DEFINITIONS = {
  readFile: {
    description:
      "Read a text file from the workspace. Returns the contents with 1-based line numbers. " +
      "Large files are truncated — use `offset` and `limit` to read the rest. " +
      "Binary files are rejected, and credential files (.env, keys, .git internals) are blocked by policy.",
    inputSchema: readFileInputSchema,
  },
  listDirectory: {
    description:
      "List the immediate contents of a directory (not recursive). " +
      "Dependency and build directories are hidden by default; use `glob` to search a tree.",
    inputSchema: listDirectoryInputSchema,
  },
  glob: {
    description:
      "Find files by name pattern. Returns workspace-relative paths, most recently modified first. " +
      "Dependency and build directories are skipped by default. Use `grep` to search file contents instead.",
    inputSchema: globInputSchema,
  },
  grep: {
    description:
      "Search file contents with a regular expression. Returns matching lines with their file and line number. " +
      "Pass `glob` to restrict which files are searched. Binary files, dependency directories, and build output are skipped by default.",
    inputSchema: grepInputSchema,
  },
} as const;

/** Tools that change the workspace. BUILD mode only. */
export const MUTATING_TOOL_DEFINITIONS = {
  writeFile: {
    description:
      "Create a new file or replace an existing file's entire contents. " +
      "An existing file must have been read in this session first — prefer `editFile` for targeted changes. " +
      "Writes are atomic, and symlinks, credential files, and paths outside the workspace are refused.",
    inputSchema: writeFileInputSchema,
  },
  editFile: {
    description:
      "Replace an exact string in an existing file. `oldString` must match the file byte-for-byte " +
      "(including indentation) and must be unique unless `replaceAll` is set. " +
      "Read the file first. Prefer this over `writeFile` for changes to existing files.",
    inputSchema: editFileInputSchema,
  },
  runCommand: {
    description:
      "Run a shell command in the workspace directory. Use it for builds, tests, linters, and package managers — " +
      "prefer readFile/writeFile/editFile/glob/grep for file work, since they are safer and cheaper. " +
      "Commands are non-interactive (stdin is closed), time out, and have their output truncated.",
    inputSchema: runCommandInputSchema,
  },
} as const;

export const TOOL_DEFINITIONS = {
  ...READ_ONLY_TOOL_DEFINITIONS,
  ...MUTATING_TOOL_DEFINITIONS,
} as const;

export type ToolName = keyof typeof TOOL_DEFINITIONS;

export const TOOL_NAMES = Object.keys(TOOL_DEFINITIONS) as ToolName[];

export const READ_ONLY_TOOL_NAMES = Object.keys(
  READ_ONLY_TOOL_DEFINITIONS,
) as ToolName[];

/** Names the given mode is allowed to call. */
export function toolNamesForMode(mode: ToolMode): ToolName[] {
  return mode === "PLAN" ? [...READ_ONLY_TOOL_NAMES] : [...TOOL_NAMES];
}

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_DEFINITIONS, name);
}

/**
 * Whether `mode` may call `name`.
 *
 * Checked twice on purpose — the server omits the mutating tools from what it
 * sends the model, and the CLI refuses them again before touching the disk. A
 * model cannot call what it was never offered, but the CLI is the side that
 * would actually do the damage, so it does not take the server's word for it.
 */
export function isToolAllowedInMode(name: ToolName, mode: ToolMode): boolean {
  return mode === "BUILD" || Object.hasOwn(READ_ONLY_TOOL_DEFINITIONS, name);
}

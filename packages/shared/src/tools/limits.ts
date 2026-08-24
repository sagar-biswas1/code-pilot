/**
 * Every budget the tools enforce, in one place.
 *
 * Two different things are being protected here and they pull in the same
 * direction: the *process* (a tool must not be able to exhaust memory, file
 * descriptors, or the event loop) and the *context window* (a tool result that
 * is megabytes long costs real money and pushes the conversation out of the
 * model's window). When in doubt the limits below are deliberately low —
 * a truncated result the model can page through beats an unbounded one.
 */
export const LIMITS = {
  /** Longest path string accepted from the model, before resolution. */
  maxPathLength: 4096,

  /** Bytes read into memory for a single `readFile` / `editFile` call. */
  maxFileReadBytes: 1_000_000,

  /** Bytes accepted for a single `writeFile` / `editFile` result. */
  maxFileWriteBytes: 5_000_000,

  /** Lines returned by `readFile` when the caller does not pass a limit. */
  defaultReadLines: 2_000,

  /** Hard ceiling on lines per `readFile` call, whatever the caller asks for. */
  maxReadLines: 5_000,

  /** A single line longer than this is clamped before it reaches the model. */
  maxLineChars: 2_000,

  /** Entries returned by `listDirectory` for one directory. */
  maxDirectoryEntries: 1_000,

  /** Paths returned by `glob`. */
  maxGlobResults: 200,

  /** Directory entries visited by a single traversal (glob/grep). */
  maxWalkEntries: 200_000,

  /** How deep glob/grep traversal goes before giving up on a branch. */
  maxWalkDepth: 25,

  /** Matches returned by `grep` before the result is marked truncated. */
  maxGrepMatches: 200,

  /** Files whose contents `grep` will actually open. */
  maxGrepFiles: 5_000,

  /** `grep` skips files larger than this instead of loading them. */
  maxGrepFileBytes: 2_000_000,

  /** Longest regex source accepted by `grep`. */
  maxPatternLength: 1_000,

  /** Wall-clock ceilings for the traversal-based tools. */
  globTimeoutMs: 10_000,
  grepTimeoutMs: 15_000,

  /** Files read in parallel by `grep`. Keeps the fd table bounded. */
  grepConcurrency: 8,

  /** `runCommand` budgets. */
  bash: {
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 120_000,
    /** Per-stream (stdout and stderr each) cap on captured characters. */
    maxStreamChars: 30_000,
    /** Longest command string accepted. */
    maxCommandLength: 10_000,
    /** Grace period between SIGTERM and SIGKILL when a command overruns. */
    killGraceMs: 2_000,
  },
} as const;

/**
 * Directory names skipped by `glob`, `grep`, and `listDirectory` unless the
 * caller opts in. Respecting `.gitignore` properly would be better, but it is
 * a large amount of matching machinery; this list covers the directories that
 * actually blow up a traversal (dependency trees and build output) and is
 * documented in each tool's description so the model knows to override it.
 */
export const DEFAULT_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".cache",
  "coverage",
  ".nyc_output",
  ".gradle",
  ".terraform",
]);

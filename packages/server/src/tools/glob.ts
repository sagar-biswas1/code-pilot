import { tool } from "ai";
import { z } from "zod";

import { LIMITS } from "./lib/limits";
import { compileGlob } from "./lib/glob";
import { walkFiles } from "./lib/walk";
import type { ToolContext } from "./lib/context";

const inputSchema = z.object({
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
    .describe(`Maximum paths to return (default and cap ${LIMITS.maxGlobResults}).`),
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

/**
 * `glob` — find files by name.
 *
 * The traversal, not the pattern, is what needs guarding: a monorepo with
 * every dependency installed is millions of entries, and a model exploring a
 * codebase will call this early and often. So the walk skips dependency trees
 * by default, never follows symlinks, stops at a deadline, and stops again at
 * the result cap. Every one of those stops is reported, because a silently
 * truncated file list reads exactly like "there are no other matches".
 */
export function createGlobTool({ workspace }: ToolContext) {
  return tool({
    description:
      "Find files by name pattern. Returns workspace-relative paths, most recently modified first. " +
      "Dependency and build directories are skipped by default. Use `grep` to search file contents instead.",
    inputSchema,
    execute: async (
      { pattern, path: inputPath, limit, includeHidden, includeIgnored },
      { abortSignal },
    ) => {
      const matcher = compileGlob(pattern);
      if ("success" in matcher) return matcher;

      const root = await workspace.resolveExisting(
        inputPath ?? ".",
        "directory",
      );
      if ("success" in root) return root;

      const maxResults = Math.min(limit ?? LIMITS.maxGlobResults, LIMITS.maxGlobResults);
      const matches: { path: string; mtimeMs: number; size: number }[] = [];
      let capped = false;

      const outcome = await walkFiles(
        workspace,
        {
          startAbsolute: root.absolute,
          deadline: Date.now() + LIMITS.globTimeoutMs,
          signal: abortSignal,
          includeHidden,
          useDefaultIgnores: !includeIgnored,
        },
        (file) => {
          // Matched against the path relative to the search root, which is what
          // makes `src/**/*.ts` mean the same thing whether the caller passed
          // `path: "."` or `path: "src"`.
          if (!matcher.test(file.fromStart)) return "continue";

          matches.push({
            path: file.relative,
            mtimeMs: file.mtimeMs,
            size: file.size,
          });
          if (matches.length >= maxResults) {
            capped = true;
            return "stop";
          }
          return "continue";
        },
      );

      if (outcome.stopped === "aborted") {
        return {
          success: false as const,
          code: "aborted" as const,
          error: "Search was cancelled.",
        };
      }

      // Recently-touched files are usually the ones under discussion, so they
      // go first. Sorting happens after the cap, so a truncated result is the
      // newest of what was *found*, not of what exists.
      matches.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const notes: string[] = [];
      if (capped) {
        notes.push(
          `Stopped at the ${maxResults} result limit; narrow the pattern or pass a more specific \`path\`.`,
        );
      }
      if (outcome.stopped === "timeout") {
        notes.push(
          `Search timed out after ${LIMITS.globTimeoutMs}ms; results are partial.`,
        );
      }
      if (outcome.stopped === "max_entries") {
        notes.push("Directory tree was too large to scan completely.");
      }
      if (!includeIgnored) {
        notes.push(
          "Dependency and build directories were skipped (set includeIgnored to search them).",
        );
      }

      return {
        success: true as const,
        pattern,
        searchedIn: root.relative,
        count: matches.length,
        truncated: capped || outcome.stopped !== "completed",
        paths: matches.map((match) => match.path),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  });
}

import { tool } from "ai";
import { z } from "zod";

import { LIMITS } from "./lib/limits";
import { compileGlob } from "./lib/glob";
import { readCapped } from "./lib/fileIO";
import { clampLine, escapeRegExp, isProbablyBinary, splitLines } from "./lib/text";
import { toolError, type ToolError } from "./lib/result";
import { mapWithConcurrency, walkFiles, type WalkedFile } from "./lib/walk";
import type { ToolContext } from "./lib/context";

const inputSchema = z.object({
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
    .describe("Treat `pattern` as literal text rather than a regular expression."),
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
    .describe("Lines of context to include before and after each match (content mode only)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.maxGrepMatches)
    .optional()
    .describe(`Maximum matches to return (default and cap ${LIMITS.maxGrepMatches}).`),
  includeHidden: z.boolean().optional().describe("Search dotfiles. Defaults to false."),
  includeIgnored: z
    .boolean()
    .optional()
    .describe(
      "Search dependency and build directories. Defaults to false; enabling it is much slower.",
    ),
});

/**
 * Rejects the regex shapes that cause catastrophic backtracking.
 *
 * This is the honest version of the story: JavaScript's engine has no match
 * timeout, and a single `exec` on a pathological pattern blocks the event loop
 * for the whole server — every other request included. The deadline checks
 * elsewhere in this file cannot preempt it. So the mitigation is layered:
 * refuse the classic nested-quantifier shapes up front, cap how long any
 * single line can be, and encourage `literal` mode (which escapes the input
 * entirely). A determined pattern can still be slow; it cannot easily be
 * exponential on a bounded line.
 */
function rejectCatastrophicPattern(pattern: string): ToolError | null {
  // (a+)+ / (a*)* / (a+)* — a quantified group whose body is itself quantified.
  const nestedQuantifier = /\([^()]*[*+][^()]*\)\s*[*+]/;
  // (a|a)* — alternation inside a quantified group, the other classic shape.
  const quantifiedAlternation = /\([^()]*\|[^()]*\)\s*[*+]\??[*+]/;

  if (nestedQuantifier.test(pattern) || quantifiedAlternation.test(pattern)) {
    return toolError(
      "policy",
      "Pattern contains nested quantifiers that can cause catastrophic backtracking. Rewrite it, or set `literal` to true to search for the text exactly.",
    );
  }
  return null;
}

function compileSearch(
  pattern: string,
  literal: boolean,
  caseInsensitive: boolean,
): RegExp | ToolError {
  if (pattern.length === 0) {
    return toolError("invalid_input", "Pattern must not be empty.");
  }
  if (pattern.length > LIMITS.maxPatternLength) {
    return toolError("invalid_input", "Pattern is too long.");
  }

  const source = literal ? escapeRegExp(pattern) : pattern;
  if (!literal) {
    const rejection = rejectCatastrophicPattern(pattern);
    if (rejection) return rejection;
  }

  try {
    // No `g` flag: `test` on a global regex carries `lastIndex` between calls,
    // which silently skips matches on the following lines.
    return new RegExp(source, caseInsensitive ? "i" : "");
  } catch {
    return toolError("invalid_input", `Not a valid regular expression: ${pattern}`);
  }
}

interface Match {
  path: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}

interface FileResult {
  path: string;
  matches: Match[];
  /** Total matches in the file, even when only some were returned. */
  total: number;
}

/**
 * `grep` — search file contents.
 *
 * Implemented in-process rather than by shelling out to `grep`/`rg`: the
 * external tools are faster, but invoking them means building a command line
 * out of model-supplied text, and that is a shell-injection surface this tool
 * does not need to have. The cost is paid back with hard caps on files opened,
 * bytes read, matches returned, and wall-clock time.
 */
export function createGrepTool({ workspace }: ToolContext) {
  return tool({
    description:
      "Search file contents with a regular expression. Returns matching lines with their file and line number. " +
      "Pass `glob` to restrict which files are searched. Binary files, dependency directories, and build output are skipped by default.",
    inputSchema,
    execute: async (input, { abortSignal }) => {
      const {
        pattern,
        path: inputPath,
        glob,
        literal = false,
        caseInsensitive = false,
        outputMode = "content",
        contextLines = 0,
        limit,
        includeHidden,
        includeIgnored,
      } = input;

      const regex = compileSearch(pattern, literal, caseInsensitive);
      if ("success" in regex) return regex;

      const fileFilter = glob ? compileGlob(glob) : null;
      if (fileFilter && "success" in fileFilter) return fileFilter;

      const target = await workspace.resolveExisting(inputPath ?? ".", "any");
      if ("success" in target) return target;

      const deadline = Date.now() + LIMITS.grepTimeoutMs;
      const maxMatches = Math.min(limit ?? LIMITS.maxGrepMatches, LIMITS.maxGrepMatches);

      // Candidates are collected first so the reads can be pooled; the walk
      // itself is I/O-bound on metadata, the reads on content.
      const candidates: WalkedFile[] = [];
      let walkStopped: string = "completed";
      let skippedLarge = 0;

      if (target.stats.isFile()) {
        if (fileFilter && !(fileFilter as RegExp).test(target.relative)) {
          return toolError(
            "invalid_input",
            `${target.relative} does not match the \`glob\` filter.`,
          );
        }
        candidates.push({
          absolute: target.absolute,
          relative: target.relative,
          fromStart: target.relative,
          size: target.stats.size,
          mtimeMs: target.stats.mtimeMs,
        });
      } else {
        const outcome = await walkFiles(
          workspace,
          {
            startAbsolute: target.absolute,
            deadline,
            signal: abortSignal,
            includeHidden,
            useDefaultIgnores: !includeIgnored,
          },
          (file) => {
            if (fileFilter && !(fileFilter as RegExp).test(file.fromStart)) {
              return "continue";
            }
            if (file.size > LIMITS.maxGrepFileBytes) {
              skippedLarge++;
              return "continue";
            }
            candidates.push(file);
            return candidates.length >= LIMITS.maxGrepFiles ? "stop" : "continue";
          },
        );
        walkStopped = outcome.stopped;
        if (outcome.stopped === "aborted") {
          return toolError("aborted", "Search was cancelled.");
        }
      }

      let matchesFound = 0;
      let filesSearched = 0;
      let skippedBinary = 0;
      let timedOut = walkStopped === "timeout";

      const fileResults = await mapWithConcurrency(
        candidates,
        LIMITS.grepConcurrency,
        async (file): Promise<FileResult | null> => {
          // Checked per file rather than per line: it is the only preemption
          // point available, since a regex `exec` cannot be interrupted.
          if (abortSignal?.aborted) return null;
          if (matchesFound >= maxMatches) return null;
          if (Date.now() > deadline) {
            timedOut = true;
            return null;
          }

          const read = await readCapped(
            file.absolute,
            file.relative,
            LIMITS.maxGrepFileBytes,
          );
          if ("success" in read) return null;
          if (isProbablyBinary(read.buffer)) {
            skippedBinary++;
            return null;
          }

          filesSearched++;
          const { lines } = splitLines(read.buffer.toString("utf8"));
          const matches: Match[] = [];
          let total = 0;

          for (let index = 0; index < lines.length; index++) {
            // Long lines are clamped *before* matching, not after: an
            // unbounded line is what turns a merely slow pattern into a hang.
            const line = clampLine(lines[index]!, LIMITS.maxLineChars);
            if (!regex.test(line)) continue;

            total++;
            if (matchesFound + matches.length >= maxMatches) continue;

            const match: Match = { path: file.relative, line: index + 1, text: line };
            if (contextLines > 0 && outputMode === "content") {
              const before = lines
                .slice(Math.max(0, index - contextLines), index)
                .map((entry) => clampLine(entry));
              const after = lines
                .slice(index + 1, index + 1 + contextLines)
                .map((entry) => clampLine(entry));
              if (before.length > 0) match.before = before;
              if (after.length > 0) match.after = after;
            }
            matches.push(match);
          }

          if (total === 0) return null;
          matchesFound += matches.length;
          return { path: file.relative, matches, total };
        },
      );

      const hits = fileResults.filter((result): result is FileResult => result !== null);
      hits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

      const totalMatches = hits.reduce((sum, hit) => sum + hit.total, 0);
      const truncated =
        matchesFound < totalMatches ||
        timedOut ||
        walkStopped === "max_entries" ||
        candidates.length >= LIMITS.maxGrepFiles;

      const notes: string[] = [];
      if (matchesFound < totalMatches) {
        notes.push(
          `Returned ${matchesFound} of ${totalMatches} matches; narrow the pattern or pass \`glob\`.`,
        );
      }
      if (timedOut) {
        notes.push(`Search timed out after ${LIMITS.grepTimeoutMs}ms; results are partial.`);
      }
      if (candidates.length >= LIMITS.maxGrepFiles) {
        notes.push(`Stopped after queuing ${LIMITS.maxGrepFiles} files.`);
      }
      if (skippedLarge > 0) {
        notes.push(`${skippedLarge} file(s) over ${LIMITS.maxGrepFileBytes} bytes were skipped.`);
      }
      if (skippedBinary > 0) notes.push(`${skippedBinary} binary file(s) were skipped.`);

      const common = {
        success: true as const,
        pattern,
        searchedIn: target.relative,
        filesSearched,
        filesWithMatches: hits.length,
        totalMatches,
        truncated,
        ...(notes.length > 0 ? { notes } : {}),
      };

      if (outputMode === "files") {
        return { ...common, paths: hits.map((hit) => hit.path) };
      }
      if (outputMode === "count") {
        return {
          ...common,
          counts: hits.map((hit) => ({ path: hit.path, count: hit.total })),
        };
      }
      return { ...common, matches: hits.flatMap((hit) => hit.matches) };
    },
  });
}

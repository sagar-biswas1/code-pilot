import { tool } from "ai";
import { z } from "zod";

import { LIMITS } from "./lib/limits";
import { statOrNull, writeAtomic } from "./lib/fileIO";
import { splitLines } from "./lib/text";
import { toolError } from "./lib/result";
import type { ToolContext } from "./lib/context";

const inputSchema = z.object({
  path: z
    .string()
    .describe("File to write, relative to the workspace root."),
  content: z.string().describe("Full contents of the file."),
  createDirectories: z
    .boolean()
    .optional()
    .describe(
      "Create missing parent directories (inside the workspace). Defaults to true.",
    ),
});

/**
 * `writeFile` — create a file, or replace one in full.
 *
 * The dangerous case is the second one, so it carries the most guards:
 * the file must have been read in this session (the model cannot recreate from
 * memory a file it never saw) and must not have changed since (it cannot
 * silently revert a concurrent edit). The write itself is atomic, so an
 * interrupted call leaves the original file intact rather than truncated.
 */
export function createWriteFileTool({ workspace, ledger }: ToolContext) {
  return tool({
    description:
      "Create a new file or replace an existing file's entire contents. " +
      "An existing file must have been read in this session first — prefer `editFile` for targeted changes. " +
      "Writes are atomic, and symlinks, credential files, and paths outside the workspace are refused.",
    inputSchema,
    execute: async ({ path: inputPath, content, createDirectories }) => {
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > LIMITS.maxFileWriteBytes) {
        return toolError(
          "too_large",
          `Refusing to write ${bytes} bytes; the limit is ${LIMITS.maxFileWriteBytes}.`,
        );
      }

      const resolved = await workspace.resolveForWrite(inputPath);
      if ("success" in resolved) return resolved;

      const staleCheck = ledger.checkModifiable(
        resolved.relative,
        resolved.existing,
      );
      if (staleCheck) return staleCheck;

      if (createDirectories !== false) {
        const parentError = await workspace.ensureParentDirectory(resolved);
        if (parentError) return parentError;
      }

      const writeError = await writeAtomic(
        resolved.absolute,
        resolved.relative,
        content,
        resolved.existing?.mode,
      );
      if (writeError) return writeError;

      // Re-stat after the rename so the ledger holds the *new* mtime; skipping
      // this would make the model's very next edit look stale.
      const written = await statOrNull(resolved.absolute);
      if (written) ledger.recordWrite(resolved.relative, written);

      const { lines } = splitLines(content);
      return {
        success: true as const,
        path: resolved.relative,
        created: resolved.existing === null,
        bytes,
        lines: lines.length,
      };
    },
  });
}

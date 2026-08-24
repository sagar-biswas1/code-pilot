import { tool } from "ai";
import { z } from "zod";

import { LIMITS } from "./lib/limits";
import { readCapped, statOrNull, writeAtomic } from "./lib/fileIO";
import {
  countOccurrences,
  isProbablyBinary,
  lineNumberAt,
  snippetAround,
} from "./lib/text";
import { toolError } from "./lib/result";
import type { ToolContext } from "./lib/context";

const inputSchema = z.object({
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

/**
 * `editFile` — targeted, exact-match replacement.
 *
 * The uniqueness requirement is the whole point. A model that asks to replace
 * `return null;` in a file with forty of them does not know which one it
 * means, and a "replace the first match" tool would happily corrupt the file.
 * Refusing an ambiguous edit and reporting the match count turns a silent
 * corruption into a retry with more context.
 *
 * Literal string matching (not regex) is deliberate: it removes an entire
 * class of ReDoS and over-matching failures, and it is what the model is
 * actually good at producing.
 */
export function createEditFileTool({ workspace, ledger }: ToolContext) {
  return tool({
    description:
      "Replace an exact string in an existing file. `oldString` must match the file byte-for-byte " +
      "(including indentation) and must be unique unless `replaceAll` is set. " +
      "Read the file first. Prefer this over `writeFile` for changes to existing files.",
    inputSchema,
    execute: async ({ path: inputPath, oldString, newString, replaceAll }) => {
      if (oldString === newString) {
        return toolError(
          "invalid_input",
          "`oldString` and `newString` are identical; nothing to do.",
        );
      }

      // Resolved as a write target first: this is what refuses symlinks and
      // directories before the file is ever opened.
      const target = await workspace.resolveForWrite(inputPath);
      if ("success" in target) return target;
      if (target.existing === null) {
        return toolError(
          "not_found",
          `${target.relative} does not exist. Use writeFile to create it.`,
        );
      }

      const staleCheck = ledger.checkModifiable(target.relative, target.existing);
      if (staleCheck) return staleCheck;

      const read = await readCapped(
        target.absolute,
        target.relative,
        LIMITS.maxFileReadBytes,
      );
      if ("success" in read) return read;

      if (read.truncated) {
        return toolError(
          "too_large",
          `${target.relative} is ${read.size} bytes, over the ${LIMITS.maxFileReadBytes} byte edit limit. Editing it would risk corrupting the part that was not loaded.`,
        );
      }
      if (isProbablyBinary(read.buffer)) {
        return toolError(
          "binary_file",
          `${target.relative} appears to be a binary file and cannot be edited as text.`,
        );
      }

      const original = read.buffer.toString("utf8");
      const occurrences = countOccurrences(original, oldString);

      if (occurrences === 0) {
        return toolError(
          "no_match",
          `\`oldString\` was not found in ${target.relative}. Whitespace and indentation must match exactly — re-read the file and copy the text verbatim.`,
        );
      }
      if (occurrences > 1 && !replaceAll) {
        return toolError(
          "not_unique",
          `\`oldString\` matches ${occurrences} places in ${target.relative}. Add surrounding lines to make it unique, or set replaceAll to change all ${occurrences}.`,
        );
      }

      const firstIndex = original.indexOf(oldString);
      const updated = replaceAll
        ? original.split(oldString).join(newString)
        : original.slice(0, firstIndex) +
          newString +
          original.slice(firstIndex + oldString.length);

      const bytes = Buffer.byteLength(updated, "utf8");
      if (bytes > LIMITS.maxFileWriteBytes) {
        return toolError(
          "too_large",
          `The edit would produce ${bytes} bytes, over the ${LIMITS.maxFileWriteBytes} byte limit.`,
        );
      }

      const writeError = await writeAtomic(
        target.absolute,
        target.relative,
        updated,
        target.existing.mode,
      );
      if (writeError) return writeError;

      const written = await statOrNull(target.absolute);
      if (written) ledger.recordWrite(target.relative, written);

      const changedLine = lineNumberAt(original, firstIndex);
      const preview = snippetAround(updated, changedLine);

      return {
        success: true as const,
        path: target.relative,
        replacements: replaceAll ? occurrences : 1,
        line: changedLine,
        bytes,
        preview: preview.text,
      };
    },
  });
}


import { LIMITS } from "@codepilot/shared";
import { readCapped } from "../lib/fileIO";
import {
  formatNumberedLines,
  isProbablyBinary,
  splitLines,
} from "../lib/text";
import { toolError } from "../lib/result";
import type { ToolContext } from "../lib/context";
import type { ToolExecutor } from "../lib/executor";

/**
 * `readFile` — the tool every other one depends on.
 *
 * Beyond the sandbox checks, its job is to make the *result* safe to put in a
 * prompt: bounded bytes, bounded lines, bounded line width, binary files
 * refused rather than fed to the tokenizer as garbage, and line numbers so the
 * model can cite locations later. Successful reads are recorded in the ledger,
 * which is what later lets `writeFile` and `editFile` refuse blind overwrites.
 */
export function createReadFileExecutor({ workspace, ledger }: ToolContext): ToolExecutor<"readFile"> {
  return async ({ path: inputPath, offset, limit }) => {
    const resolved = await workspace.resolveExisting(inputPath, "file");
    if ("success" in resolved) return resolved;

    const read = await readCapped(
      resolved.absolute,
      resolved.relative,
      LIMITS.maxFileReadBytes,
    );
    if ("success" in read) return read;

    if (isProbablyBinary(read.buffer)) {
      return toolError(
        "binary_file",
        `${resolved.relative} appears to be a binary file (${read.size} bytes) and cannot be read as text.`,
      );
    }

    // Only a full, untruncated read may be recorded: a partial read must not
    // let the model overwrite a file it has only seen the first megabyte of.
    if (!read.truncated) {
      ledger.record(resolved.relative, resolved.stats);
    }

    const content = read.buffer.toString("utf8");
    const { lines } = splitLines(content);

    const startLine = offset ?? 1;
    if (lines.length > 0 && startLine > lines.length) {
      return toolError(
        "invalid_input",
        `offset ${startLine} is past the end of ${resolved.relative}, which has ${lines.length} lines.`,
      );
    }

    const maxLines = Math.min(
      limit ?? LIMITS.defaultReadLines,
      LIMITS.maxReadLines,
    );
    const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
    const endLine = startLine + selected.length - 1;

    const notes: string[] = [];
    if (read.truncated) {
      notes.push(
        `File is ${read.size} bytes; only the first ${LIMITS.maxFileReadBytes} bytes were read.`,
      );
    }
    if (endLine < lines.length) {
      notes.push(
        `Showing lines ${startLine}-${endLine} of ${lines.length}. Call again with offset ${endLine + 1} to continue.`,
      );
    }

    return {
      success: true as const,
      path: resolved.relative,
      startLine,
      endLine,
      totalLines: lines.length,
      bytes: read.size,
      truncated: read.truncated || endLine < lines.length,
      content:
        selected.length === 0
          ? "(empty file)"
          : formatNumberedLines(selected, startLine),
      ...(notes.length > 0 ? { notes } : {}),
    };
  };
}

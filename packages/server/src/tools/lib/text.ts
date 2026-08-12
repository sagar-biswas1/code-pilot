import { LIMITS } from "./limits";

/**
 * Text handling shared by the file tools. The recurring theme is that model
 * context is a scarce, billable resource: nothing here returns unbounded text,
 * and every truncation is reported explicitly so the model knows it is looking
 * at a window rather than the whole thing.
 */

const NUL = 0x00;

/**
 * Binary sniffing, the same heuristic `git` and `grep` use: a NUL byte in the
 * leading chunk means the file is not text. Cheap, and wrong only for exotic
 * encodings (UTF-16 is reported as binary, which is the safe answer — decoding
 * it as UTF-8 would hand the model mojibake).
 */
export function isProbablyBinary(buffer: Buffer): boolean {
  const window = Math.min(buffer.length, 8192);
  for (let i = 0; i < window; i++) {
    if (buffer[i] === NUL) return true;
  }
  return false;
}

/** Clamps one line so a minified bundle cannot blow up a tool result. */
export function clampLine(
  line: string,
  maxChars: number = LIMITS.maxLineChars,
): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars)}… [line truncated, ${line.length} chars total]`;
}

/**
 * Splits into lines while remembering whether the file ended with a newline,
 * so a rewrite can reproduce the original byte-for-byte. `split("\n")` on a
 * trailing-newline file yields a phantom empty last element; dropping it
 * silently is what makes naive editors strip the final newline.
 */
export function splitLines(content: string): {
  lines: string[];
  trailingNewline: boolean;
} {
  if (content === "") return { lines: [], trailingNewline: false };
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  return { lines: body.split("\n"), trailingNewline };
}

/**
 * `cat -n` style numbering. Line numbers are what let the model refer to a
 * location in a later message without re-reading the file.
 */
export function formatNumberedLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map(
      (line, index) =>
        `${String(startLine + index).padStart(width, " ")}\t${clampLine(line)}`,
    )
    .join("\n");
}

/** Counts occurrences of a literal substring without building an array. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 1-based line number of a character offset. */
export function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * A few lines of context around a change, numbered — enough for the model to
 * confirm the edit landed where it intended without a second `readFile`.
 */
export function snippetAround(
  content: string,
  line: number,
  radius = 3,
): { startLine: number; text: string } {
  const { lines } = splitLines(content);
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return {
    startLine: start,
    text: formatNumberedLines(lines.slice(start - 1, end), start),
  };
}

/**
 * Escapes a literal string for inclusion in a regex. Used by `grep`'s
 * `literal` mode, where treating user text as a pattern would be both wrong
 * and a ReDoS vector.
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

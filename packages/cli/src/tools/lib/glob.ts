import { toolError, type ToolError } from "./result";
import { LIMITS } from "./limits";

/**
 * A small, deliberately boring glob compiler.
 *
 * Two reasons this is hand-written rather than delegated:
 * - The pattern comes from a language model, so it must compile to a regex
 *   with **no backtracking blowup**. Every construct below expands to a linear
 *   `[^/]*` / `.*` form; there are no nested quantifiers to exploit.
 * - Matching happens against workspace-relative POSIX paths only, which keeps
 *   the sandbox's one path namespace intact.
 *
 * Supported: `*`, `**`, `?`, `[abc]`, `[!abc]`, `{a,b}` and literal escapes.
 */

/** Characters that must not be treated as regex syntax. */
function escapeLiteral(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export function compileGlob(
  pattern: string,
  options: { caseInsensitive?: boolean } = {},
): RegExp | ToolError {
  if (!pattern || pattern.trim() === "") {
    return toolError("invalid_input", "Pattern must be a non-empty string.");
  }
  if (pattern.length > LIMITS.maxPatternLength) {
    return toolError("invalid_input", "Pattern is too long.");
  }
  if (pattern.includes("\0")) {
    return toolError("invalid_input", "Pattern contains a NUL byte.");
  }
  if (pattern.startsWith("/")) {
    return toolError(
      "invalid_input",
      "Pattern must be relative to the workspace (or to the `path` argument), not absolute.",
    );
  }
  if (pattern.split("/").includes("..")) {
    return toolError(
      "outside_workspace",
      "Pattern may not contain `..` segments.",
    );
  }

  let source = "";
  let braceDepth = 0;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;

    switch (char) {
      case "\\": {
        // Escape: the next character is always a literal.
        const next = pattern[++i];
        source += next === undefined ? "\\\\" : escapeLiteral(next);
        break;
      }
      case "*": {
        if (pattern[i + 1] === "*") {
          while (pattern[i + 1] === "*") i++;
          if (pattern[i + 1] === "/") {
            i++;
            // `**/` spans zero or more directories, so `**/*.ts` also matches
            // a file sitting at the top level.
            source += "(?:[^/]*/)*";
          } else {
            source += ".*";
          }
        } else {
          source += "[^/]*";
        }
        break;
      }
      case "?":
        source += "[^/]";
        break;
      case "[": {
        // Character class, copied through with `!` translated to `^`. A class
        // that never closes is treated as a literal bracket.
        const close = pattern.indexOf("]", i + 1);
        if (close === -1) {
          source += "\\[";
          break;
        }
        let body = pattern.slice(i + 1, close);
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        // A class must not be allowed to match a separator, or `[a-z]*`
        // patterns would silently cross directory boundaries.
        source += `(?![/])[${body.replace(/\\/g, "\\\\")}]`;
        i = close;
        break;
      }
      case "{":
        braceDepth++;
        source += "(?:";
        break;
      case "}":
        if (braceDepth > 0) {
          braceDepth--;
          source += ")";
        } else {
          source += "\\}";
        }
        break;
      case ",":
        source += braceDepth > 0 ? "|" : ",";
        break;
      default:
        source += escapeLiteral(char);
    }
  }

  if (braceDepth !== 0) {
    return toolError("invalid_input", "Unbalanced `{` in pattern.");
  }

  try {
    return new RegExp(`^${source}$`, options.caseInsensitive ? "i" : "");
  } catch {
    return toolError("invalid_input", "Pattern could not be compiled.");
  }
}

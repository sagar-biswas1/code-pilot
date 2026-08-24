/**
 * Tool results are **values, not exceptions**.
 *
 * A thrown error inside `execute` aborts the whole `streamText` run, which
 * turns a recoverable mistake ("that file does not exist") into a dead
 * conversation. Every tool here returns `{ success: false, code, error }`
 * instead, so the model sees the failure as a normal tool result and can
 * correct itself on the next step.
 */
export type ToolErrorCode =
  | "invalid_input"
  | "outside_workspace"
  | "denied_path"
  | "not_found"
  | "not_a_file"
  | "not_a_directory"
  | "is_symlink"
  | "already_exists"
  | "too_large"
  | "binary_file"
  | "no_match"
  | "not_unique"
  | "stale_read"
  | "read_required"
  | "timeout"
  | "aborted"
  | "permission_denied"
  | "io_error"
  | "policy";

export interface ToolError {
  success: false;
  code: ToolErrorCode;
  error: string;
}

export function toolError(code: ToolErrorCode, error: string): ToolError {
  return { success: false, code, error };
}

export function isToolError(value: unknown): value is ToolError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { success?: unknown }).success === false
  );
}

function errnoOf(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

/**
 * Turns a Node filesystem error into a tool error.
 *
 * The original `err.message` is deliberately dropped: it embeds the absolute
 * host path (`ENOENT: no such file or directory, open '/Users/…'`), which
 * would hand the model — and anything downstream that logs tool results — a
 * map of the host filesystem. `relativePath` is echoed back instead, because
 * that is the only namespace the model is allowed to reason about.
 */
export function fsError(error: unknown, relativePath: string): ToolError {
  switch (errnoOf(error)) {
    case "ENOENT":
      return toolError("not_found", `Path does not exist: ${relativePath}`);
    case "EACCES":
    case "EPERM":
      return toolError(
        "permission_denied",
        `Permission denied: ${relativePath}`,
      );
    case "EISDIR":
      return toolError(
        "not_a_file",
        `Path is a directory, not a file: ${relativePath}`,
      );
    case "ENOTDIR":
      return toolError(
        "not_a_directory",
        `Path is not a directory: ${relativePath}`,
      );
    case "ELOOP":
      return toolError(
        "is_symlink",
        `Too many symbolic links while resolving: ${relativePath}`,
      );
    case "EEXIST":
      return toolError("already_exists", `Path already exists: ${relativePath}`);
    case "EMFILE":
    case "ENFILE":
      return toolError(
        "io_error",
        "Too many open files on the host; try again shortly.",
      );
    case "ENOSPC":
      return toolError("io_error", "No space left on device.");
    case "EROFS":
      return toolError(
        "permission_denied",
        `Filesystem is read-only: ${relativePath}`,
      );
    case "ENAMETOOLONG":
      return toolError("invalid_input", `Path is too long: ${relativePath}`);
    default:
      return toolError("io_error", `I/O error on ${relativePath}`);
  }
}

/** True when an error is the one raised by an aborted `AbortSignal`. */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    errnoOf(error) === "ABORT_ERR"
  );
}

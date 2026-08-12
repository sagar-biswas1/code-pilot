import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { Stats } from "node:fs";

import { LIMITS } from "./limits";
import { fsError, toolError, type ToolError } from "./result";

/**
 * The sandbox boundary.
 *
 * Everything the model can name is a path, and a path is the one input that
 * turns "read a file" into "read `~/.ssh/id_ed25519`". `Workspace` is the only
 * place a model-supplied string becomes an absolute path, and it enforces
 * three separate controls:
 *
 * 1. **Lexical containment** — after `path.resolve`, the result must live
 *    under the workspace root. This kills `../../etc/passwd` and absolute
 *    paths pointing elsewhere.
 * 2. **Symlink containment** — a path that resolves *inside* the root can
 *    still point outside it through a symlink, so the real path (or, for a
 *    path being created, its nearest existing ancestor's real path) is checked
 *    too. Writes additionally refuse a symlinked final component outright
 *    rather than following it.
 * 3. **A secrets denylist** — credentials that happen to live inside the
 *    workspace are still off limits. This is the weakest of the three (a
 *    denylist never enumerates everything) but it catches the cases that
 *    actually leak: `.env`, key material, VCS internals.
 *
 * A note on TOCTOU: between a check and the syscall that follows it, an
 * attacker with write access to the workspace could swap a directory for a
 * symlink. That window is narrowed (writes use `O_NOFOLLOW`-equivalent lstat
 * checks and atomic rename) but not closed. Closing it fully requires
 * `openat`/`O_BENEATH`-style APIs the runtime does not expose — which is why
 * a real deployment should run this process in a container or under a
 * per-session unprivileged user, with the workspace as its only writable mount.
 */

/** Paths that stay off limits even when they sit inside the workspace. */
const DEFAULT_DENIED_PATTERNS: RegExp[] = [
  // VCS internals: writing here rewrites history or plants hooks that execute
  // on the user's next git command.
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.hg(\/|$)/,
  /(^|\/)\.svn(\/|$)/,

  // Environment files. `.env.example` and friends are template files and stay
  // readable — the negative lookahead is what allows them through.
  /(^|\/)\.env(\.(?!example$|sample$|template$|defaults$|dist$)[^/]*)?$/,

  // Key material and credential stores.
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.kube\/config$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)\.(npmrc|netrc|pgpass|pypirc)$/,
  /(^|\/)credentials(\.json)?$/,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /(^|\/)service-account.*\.json$/i,
];

export interface WorkspaceOptions {
  /**
   * Extra denied patterns, matched against the workspace-relative POSIX path.
   * Added to the defaults rather than replacing them.
   */
  deniedPatterns?: RegExp[];
  /** Replace the default denylist entirely. Use with care. */
  replaceDefaultDenyList?: boolean;
}

export interface ResolvedPath {
  /** Absolute path on the host. Never sent to the model. */
  absolute: string;
  /** Workspace-relative POSIX path. This is what the model sees. */
  relative: string;
}

export interface ResolvedExisting extends ResolvedPath {
  stats: Stats;
}

export interface ResolvedForWrite extends ResolvedPath {
  /** `null` when the file does not exist yet. */
  existing: Stats | null;
}

export class Workspace {
  /** Fully resolved (symlink-free) root. All containment checks use this. */
  readonly root: string;

  private readonly denied: readonly RegExp[];

  private constructor(root: string, denied: readonly RegExp[]) {
    this.root = root;
    this.denied = denied;
  }

  /**
   * Resolves and validates the root once, at construction, so no per-call path
   * check has to trust a root that might itself be a symlink into somewhere
   * unexpected. Throws — a session whose workspace does not exist is a
   * configuration failure, not something the model can recover from.
   */
  static create(root: string, options: WorkspaceOptions = {}): Workspace {
    if (!root || !path.isAbsolute(root)) {
      throw new Error(`Workspace root must be an absolute path, got: ${root}`);
    }

    const real = fsSync.realpathSync.native(root);
    if (!fsSync.statSync(real).isDirectory()) {
      throw new Error(`Workspace root is not a directory: ${root}`);
    }

    const denied = options.replaceDefaultDenyList
      ? [...(options.deniedPatterns ?? [])]
      : [...DEFAULT_DENIED_PATTERNS, ...(options.deniedPatterns ?? [])];

    return new Workspace(real, denied);
  }

  /** Workspace-relative POSIX path for an absolute path already known to be inside. */
  toRelative(absolute: string): string {
    const relative = path.relative(this.root, absolute);
    return relative === "" ? "." : relative.split(path.sep).join("/");
  }

  /** True when `absolute` is the root itself or lives beneath it. */
  contains(absolute: string): boolean {
    if (absolute === this.root) return true;
    const relative = path.relative(this.root, absolute);
    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  }

  isDenied(relativePosixPath: string): boolean {
    return this.denied.some((pattern) => pattern.test(relativePosixPath));
  }

  /**
   * Lexical resolution only — no filesystem access, so this cannot see through
   * symlinks. Every caller must follow up with `resolveExisting` or
   * `resolveForWrite`, which add the real-path check.
   */
  resolve(input: string): ResolvedPath | ToolError {
    if (typeof input !== "string" || input.trim() === "") {
      return toolError("invalid_input", "Path must be a non-empty string.");
    }
    // A NUL byte truncates the string at the syscall boundary, so
    // "safe.txt\0../../etc/passwd" would pass a string check and open
    // something else entirely.
    if (input.includes("\0")) {
      return toolError("invalid_input", "Path contains a NUL byte.");
    }
    if (input.length > LIMITS.maxPathLength) {
      return toolError("invalid_input", "Path is too long.");
    }

    const absolute = path.resolve(this.root, input);

    if (!this.contains(absolute)) {
      return toolError(
        "outside_workspace",
        `Path escapes the workspace: ${input}. Only paths inside the workspace root may be accessed.`,
      );
    }

    const relative = this.toRelative(absolute);

    if (this.isDenied(relative)) {
      return toolError(
        "denied_path",
        `Access to ${relative} is blocked by security policy (credentials, key material, or VCS internals).`,
      );
    }

    return { absolute, relative };
  }

  /**
   * Resolves a path that must already exist, following symlinks and then
   * re-checking containment on the real path.
   */
  async resolveExisting(
    input: string,
    expect: "file" | "directory" | "any" = "any",
  ): Promise<ResolvedExisting | ToolError> {
    const resolved = this.resolve(input);
    if ("success" in resolved) return resolved;

    let real: string;
    try {
      real = await fs.realpath(resolved.absolute);
    } catch (error) {
      return fsError(error, resolved.relative);
    }

    if (!this.contains(real)) {
      return toolError(
        "outside_workspace",
        `Path ${resolved.relative} resolves outside the workspace through a symbolic link.`,
      );
    }

    // The real path can differ from the requested one, so the denylist has to
    // run again — `link-to-secrets` and `.env` must both be refused.
    const realRelative = this.toRelative(real);
    if (this.isDenied(realRelative)) {
      return toolError(
        "denied_path",
        `Access to ${resolved.relative} is blocked by security policy.`,
      );
    }

    let stats: Stats;
    try {
      stats = await fs.stat(real);
    } catch (error) {
      return fsError(error, resolved.relative);
    }

    if (expect === "file" && !stats.isFile()) {
      return toolError(
        "not_a_file",
        stats.isDirectory()
          ? `Path is a directory, not a file: ${resolved.relative}`
          : `Not a regular file: ${resolved.relative}`,
      );
    }
    if (expect === "directory" && !stats.isDirectory()) {
      return toolError(
        "not_a_directory",
        `Not a directory: ${resolved.relative}`,
      );
    }

    // `absolute` is the real path from here on: later syscalls then operate on
    // the resolved target instead of racing the symlink a second time.
    return { absolute: real, relative: resolved.relative, stats };
  }

  /**
   * Resolves a path that is about to be written.
   *
   * Unlike reads, a symlinked target is refused rather than followed. A write
   * through a symlink is the classic sandbox escape (`report.md` →
   * `~/.zshrc`), and no legitimate agent edit depends on it.
   */
  async resolveForWrite(input: string): Promise<ResolvedForWrite | ToolError> {
    const resolved = this.resolve(input);
    if ("success" in resolved) return resolved;

    if (resolved.absolute === this.root) {
      return toolError(
        "not_a_file",
        "Cannot write to the workspace root itself.",
      );
    }

    let existing: Stats | null = null;
    try {
      // `lstat`, not `stat`: the point is to observe the symlink, not its target.
      const link = await fs.lstat(resolved.absolute);
      if (link.isSymbolicLink()) {
        return toolError(
          "is_symlink",
          `Refusing to write through a symbolic link: ${resolved.relative}`,
        );
      }
      if (link.isDirectory()) {
        return toolError(
          "not_a_file",
          `Path is a directory: ${resolved.relative}`,
        );
      }
      if (!link.isFile()) {
        return toolError(
          "not_a_file",
          `Refusing to write to a non-regular file: ${resolved.relative}`,
        );
      }
      existing = link;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code !== "ENOENT"
      ) {
        return fsError(error, resolved.relative);
      }
    }

    // Even when the file itself does not exist, an ancestor directory may be a
    // symlink out of the workspace, so the nearest existing one is verified.
    const ancestorCheck = await this.verifyExistingAncestor(resolved);
    if (ancestorCheck) return ancestorCheck;

    return { absolute: resolved.absolute, relative: resolved.relative, existing };
  }

  /**
   * Walks up from `target` to the first directory that exists and confirms its
   * real path is still inside the workspace. Returns a `ToolError` on failure
   * and `null` when everything checks out.
   */
  private async verifyExistingAncestor(
    target: ResolvedPath,
  ): Promise<ToolError | null> {
    let current = path.dirname(target.absolute);

    while (true) {
      try {
        const real = await fs.realpath(current);
        if (!this.contains(real)) {
          return toolError(
            "outside_workspace",
            `Path ${target.relative} resolves outside the workspace through a symbolic link.`,
          );
        }
        return null;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "ENOENT"
        ) {
          const parent = path.dirname(current);
          // The root always exists and was realpath'd at construction, so this
          // loop terminates there at the latest.
          if (parent === current || !this.contains(current)) return null;
          current = parent;
          continue;
        }
        return fsError(error, target.relative);
      }
    }
  }

  /**
   * Creates the parent directories of a path that is about to be written,
   * re-verifying containment afterwards (a concurrent process could have
   * created one of them as a symlink in the meantime).
   */
  async ensureParentDirectory(target: ResolvedPath): Promise<ToolError | null> {
    const parent = path.dirname(target.absolute);
    try {
      await fs.mkdir(parent, { recursive: true });
    } catch (error) {
      return fsError(error, path.dirname(target.relative));
    }

    try {
      if (!this.contains(await fs.realpath(parent))) {
        return toolError(
          "outside_workspace",
          `Parent directory of ${target.relative} resolves outside the workspace.`,
        );
      }
    } catch (error) {
      return fsError(error, target.relative);
    }
    return null;
  }
}

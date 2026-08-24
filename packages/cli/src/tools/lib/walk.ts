import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import { DEFAULT_IGNORED_DIRECTORIES, LIMITS } from "./limits";
import type { Workspace } from "./workspace";

/**
 * Breadth-first directory traversal shared by `glob` and `grep`.
 *
 * Design constraints, all of them security- or cost-driven:
 *
 * - **Symlinks are never followed.** Not for entries, not for directories.
 *   This closes the escape route the `Workspace` checks would otherwise have
 *   to re-litigate on every entry, and it makes symlink cycles impossible —
 *   there is no visited-inode set to get wrong.
 * - **Every loop is bounded.** Entry count, depth, and a wall-clock deadline
 *   are all enforced, and an `AbortSignal` (the client hanging up) stops the
 *   walk immediately instead of leaving it churning through a monorepo.
 * - **Failures are skipped, not fatal.** An unreadable directory somewhere in
 *   a large tree should not fail the whole search.
 */

export interface WalkedFile {
  absolute: string;
  /** Workspace-relative POSIX path. */
  relative: string;
  /** Path relative to the directory the walk started from. */
  fromStart: string;
  size: number;
  mtimeMs: number;
}

export interface WalkOptions {
  /** Where the walk begins. Must already be inside the workspace. */
  startAbsolute: string;
  /** Absolute deadline (`Date.now()` based). */
  deadline: number;
  signal?: AbortSignal;
  maxDepth?: number;
  maxEntries?: number;
  /** Include dotfiles and dot-directories. */
  includeHidden?: boolean;
  /** Skip the conventional dependency/build directories. */
  useDefaultIgnores?: boolean;
}

export type WalkStopReason = "completed" | "timeout" | "aborted" | "max_entries";

export interface WalkOutcome {
  stopped: WalkStopReason;
  entriesVisited: number;
}

/**
 * Streams matching files to `onFile`. Returning `"stop"` from the callback
 * ends the walk early — that is how the callers implement their result caps
 * without collecting the whole tree first.
 */
export async function walkFiles(
  workspace: Workspace,
  options: WalkOptions,
  onFile: (file: WalkedFile) => "continue" | "stop" | Promise<"continue" | "stop">,
): Promise<WalkOutcome> {
  const maxDepth = options.maxDepth ?? LIMITS.maxWalkDepth;
  const maxEntries = options.maxEntries ?? LIMITS.maxWalkEntries;
  const useDefaultIgnores = options.useDefaultIgnores ?? true;
  const includeHidden = options.includeHidden ?? false;

  const queue: { absolute: string; depth: number }[] = [
    { absolute: options.startAbsolute, depth: 0 },
  ];
  let entriesVisited = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (options.signal?.aborted) return { stopped: "aborted", entriesVisited };
    if (Date.now() > options.deadline) {
      return { stopped: "timeout", entriesVisited };
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.absolute, { withFileTypes: true });
    } catch {
      // Permission denied, or the directory vanished mid-walk. Skip it.
      continue;
    }

    // Stable output regardless of filesystem ordering, which makes results
    // reproducible across runs and platforms.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (++entriesVisited > maxEntries) {
        return { stopped: "max_entries", entriesVisited };
      }
      if (options.signal?.aborted) {
        return { stopped: "aborted", entriesVisited };
      }
      // Checked inside the entry loop as well: one directory with a hundred
      // thousand children would otherwise blow straight past the deadline.
      if ((entriesVisited & 0x3ff) === 0 && Date.now() > options.deadline) {
        return { stopped: "timeout", entriesVisited };
      }

      if (!includeHidden && entry.name.startsWith(".")) continue;
      // A symlink is neither followed nor reported: reporting it would invite
      // the model to read a path that resolves outside the sandbox.
      if (entry.isSymbolicLink()) continue;

      const absolute = path.join(current.absolute, entry.name);
      const relative = workspace.toRelative(absolute);
      if (workspace.isDenied(relative)) continue;

      if (entry.isDirectory()) {
        if (current.depth + 1 > maxDepth) continue;
        if (useDefaultIgnores && DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        queue.push({ absolute, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;

      let size = 0;
      let mtimeMs = 0;
      try {
        const stats = await fs.stat(absolute);
        size = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {
        continue;
      }

      const decision = await onFile({
        absolute,
        relative,
        fromStart: path
          .relative(options.startAbsolute, absolute)
          .split(path.sep)
          .join("/"),
        size,
        mtimeMs,
      });
      if (decision === "stop") return { stopped: "completed", entriesVisited };
    }
  }

  return { stopped: "completed", entriesVisited };
}

/**
 * Runs `worker` over `items` with a fixed number in flight. Used by `grep` to
 * overlap file reads without opening thousands of descriptors at once.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

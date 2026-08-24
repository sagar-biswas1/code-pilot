import type { Stats } from "node:fs";

import { toolError, type ToolError } from "./result";

/**
 * Per-session record of which files the model has actually looked at.
 *
 * This enforces two rules that separate a usable coding agent from a
 * destructive one:
 *
 * 1. **Read before overwrite.** A model that has not read a file does not know
 *    what is in it, so `writeFile` over an existing file is refused until it
 *    has. This is the single most effective guard against the failure mode
 *    where the model "recreates" a file from memory and silently deletes the
 *    parts it never saw.
 * 2. **No stale writes.** If the file changed on disk after the model read it
 *    — the user edited it, a formatter ran, a parallel tool call touched it —
 *    the write is refused so the model re-reads first. Without this, an agent
 *    quietly reverts whatever happened in between.
 *
 * `mtimeMs` + `size` is the change signal. It is not cryptographic, and two
 * writes inside the same filesystem timestamp granularity can collide; the
 * point is to catch the ordinary races, not an adversary editing the file.
 */
interface Observation {
  mtimeMs: number;
  size: number;
}

export class FileLedger {
  private readonly seen = new Map<string, Observation>();

  private static snapshot(stats: Stats): Observation {
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  }

  /** Called after every successful read of a file's full contents. */
  record(relativePath: string, stats: Stats): void {
    this.seen.set(relativePath, FileLedger.snapshot(stats));
  }

  /** Called after a successful write, so the next edit does not need a re-read. */
  recordWrite(relativePath: string, stats: Stats): void {
    this.seen.set(relativePath, FileLedger.snapshot(stats));
  }

  has(relativePath: string): boolean {
    return this.seen.has(relativePath);
  }

  /**
   * Returns a `ToolError` when a modification of `relativePath` should be
   * refused, or `null` when the write may proceed.
   *
   * `current` is `null` for a file that does not exist yet — creating a new
   * file needs no prior read.
   */
  checkModifiable(
    relativePath: string,
    current: Stats | null,
  ): ToolError | null {
    if (current === null) return null;

    const observed = this.seen.get(relativePath);
    if (!observed) {
      return toolError(
        "read_required",
        `${relativePath} already exists and has not been read in this session. Read it first so the change is based on its actual contents.`,
      );
    }

    if (
      observed.mtimeMs !== current.mtimeMs ||
      observed.size !== current.size
    ) {
      return toolError(
        "stale_read",
        `${relativePath} changed on disk after it was read. Read it again before modifying it, or the change will overwrite someone else's edit.`,
      );
    }

    return null;
  }
}

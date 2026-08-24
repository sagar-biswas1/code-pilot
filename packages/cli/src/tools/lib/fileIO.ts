import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";

import { fsError, type ToolError } from "./result";

/**
 * Bounded, crash-safe file I/O primitives.
 */

export interface CappedRead {
  buffer: Buffer;
  /** Real size on disk, which may exceed `buffer.length`. */
  size: number;
  truncated: boolean;
}

/**
 * Reads at most `maxBytes`, never allocating more than that regardless of how
 * large the file is. `fs.readFile` on a 4 GB log would take the process down;
 * this reads a fixed window instead and reports the truncation.
 */
export async function readCapped(
  absolute: string,
  relative: string,
  maxBytes: number,
): Promise<CappedRead | ToolError> {
  let handle;
  try {
    handle = await fs.open(absolute, "r");
  } catch (error) {
    return fsError(error, relative);
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      return fsError({ code: "EISDIR" }, relative);
    }

    const size = stats.size;
    const toRead = Math.min(size, maxBytes);
    const buffer = Buffer.allocUnsafe(toRead);

    let offset = 0;
    while (offset < toRead) {
      const { bytesRead } = await handle.read(buffer, offset, toRead - offset, offset);
      // A short read before the cap means the file shrank under us; stop
      // rather than spinning on a zero-byte read forever.
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    return {
      buffer: offset === toRead ? buffer : buffer.subarray(0, offset),
      size,
      truncated: size > maxBytes,
    };
  } catch (error) {
    return fsError(error, relative);
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Writes via a temp file in the same directory, then `rename`.
 *
 * Two properties come out of this, both of which matter for a tool an agent
 * drives unattended:
 * - **Atomicity** — a reader either sees the old file or the new one, never a
 *   half-written mix. A crash mid-write leaves the original intact.
 * - **No truncate-then-fail** — the plain `open(O_TRUNC)` path destroys the
 *   file's contents before the first byte is written, so any failure after
 *   that point is unrecoverable data loss.
 *
 * The temp file is created with `wx` (exclusive) and a random name, so it
 * cannot be pre-created by another process as a symlink to somewhere else.
 */
export async function writeAtomic(
  absolute: string,
  relative: string,
  content: string,
  mode?: number,
): Promise<ToolError | null> {
  const directory = path.dirname(absolute);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${randomBytes(8).toString("hex")}.tmp`,
  );

  let handle;
  try {
    // 0o600 until the rename: the file is briefly visible in a directory that
    // may be world-readable, and it holds the final contents.
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    // Without the flush, `rename` can be durable while the data is not — the
    // classic "renamed empty file" after a power loss.
    await handle.sync();
    await handle.close();
    handle = undefined;

    // Preserve the original permissions; a fresh file gets the conventional
    // 0644. `mode` comes from a `stat`, so the file-type bits are masked off —
    // passing them through to `chmod` is meaningless at best.
    await fs.chmod(temporary, (mode ?? 0o644) & 0o777);
    await fs.rename(temporary, absolute);
    return null;
  } catch (error) {
    return fsError(error, relative);
  } finally {
    if (handle) await handle.close().catch(() => {});
    // Best effort: if the rename succeeded this is already gone.
    await fs.unlink(temporary).catch(() => {});
  }
}

/** `stat` that answers `null` instead of throwing when the path is absent. */
export async function statOrNull(absolute: string): Promise<Stats | null> {
  try {
    return await fs.stat(absolute);
  } catch {
    return null;
  }
}

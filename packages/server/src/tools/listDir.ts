import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

import { DEFAULT_IGNORED_DIRECTORIES, LIMITS } from "./lib/limits";
import { fsError } from "./lib/result";
import type { ToolContext } from "./lib/context";

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Directory to list, relative to the workspace root. Defaults to the workspace root.",
    ),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Include dotfiles and dot-directories. Defaults to false."),
  includeIgnored: z
    .boolean()
    .optional()
    .describe(
      "Include dependency and build directories (node_modules, dist, target, …). Defaults to false.",
    ),
});

interface Entry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size?: number;
}

/**
 * `listDirectory` — one level, never recursive.
 *
 * Recursion belongs in `glob`, which has a pattern to prune with; an unbounded
 * recursive listing is how a tool result turns into fifty thousand lines of
 * `node_modules`. Symlinks are reported by name but never resolved, so the
 * model can see they exist without the tool leaking where they point.
 */
export function createListDirTool({ workspace }: ToolContext) {
  return tool({
    description:
      "List the immediate contents of a directory (not recursive). " +
      "Dependency and build directories are hidden by default; use `glob` to search a tree.",
    inputSchema,
    execute: async ({ path: inputPath, includeHidden, includeIgnored }) => {
      const resolved = await workspace.resolveExisting(
        inputPath ?? ".",
        "directory",
      );
      if ("success" in resolved) return resolved;

      let dirents;
      try {
        dirents = await fs.readdir(resolved.absolute, { withFileTypes: true });
      } catch (error) {
        return fsError(error, resolved.relative);
      }

      const entries: Entry[] = [];
      let hidden = 0;
      let truncated = false;

      for (const dirent of dirents) {
        if (!includeHidden && dirent.name.startsWith(".")) {
          hidden++;
          continue;
        }

        const childRelative =
          resolved.relative === "."
            ? dirent.name
            : `${resolved.relative}/${dirent.name}`;
        if (workspace.isDenied(childRelative)) {
          hidden++;
          continue;
        }
        if (
          !includeIgnored &&
          dirent.isDirectory() &&
          DEFAULT_IGNORED_DIRECTORIES.has(dirent.name)
        ) {
          hidden++;
          continue;
        }

        if (entries.length >= LIMITS.maxDirectoryEntries) {
          truncated = true;
          break;
        }

        if (dirent.isSymbolicLink()) {
          entries.push({ name: dirent.name, type: "symlink" });
          continue;
        }
        if (dirent.isDirectory()) {
          entries.push({ name: dirent.name, type: "directory" });
          continue;
        }
        if (!dirent.isFile()) {
          entries.push({ name: dirent.name, type: "other" });
          continue;
        }

        let size: number | undefined;
        try {
          size = (await fs.stat(path.join(resolved.absolute, dirent.name))).size;
        } catch {
          // Raced with a delete; the name is still worth reporting.
        }
        entries.push({ name: dirent.name, type: "file", size });
      }

      // Directories first, then alphabetical — the order people read a tree in.
      entries.sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (b.type === "directory" && a.type !== "directory") return 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });

      return {
        success: true as const,
        path: resolved.relative,
        entries,
        count: entries.length,
        truncated,
        ...(hidden > 0
          ? { hiddenCount: hidden, hiddenNote: "Hidden, ignored, or blocked entries were omitted." }
          : {}),
      };
    },
  });
}

/**
 * On-disk user configuration.
 *
 * Persists user preferences (currently just the selected theme) to a JSON file
 * so they survive restarts. The file lives under the XDG config directory:
 *
 *   $XDG_CONFIG_HOME/code-pilot/config.json   (falls back to ~/.config)
 *
 * All reads/writes are best-effort and synchronous — a CLI reads config once at
 * startup, and a corrupt or unwritable file must never crash the app, so every
 * failure degrades silently to in-memory defaults.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Shape of the persisted config file. Every field is optional. */
export type UserConfig = {
  /** Id of the last selected theme (see `THEMES`). */
  themeId?: string;
};

/** Absolute path to the config file, honoring `$XDG_CONFIG_HOME`. */
function configPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "code-pilot", "config.json");
}

/** Read the config file, returning `{}` if it's missing or unreadable. */
export function loadConfig(): UserConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Merge `patch` into the existing config and write it back. Failures (e.g. a
 * read-only home directory) are swallowed so persistence never breaks the app.
 */
export function saveConfig(patch: Partial<UserConfig>): void {
  try {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    const next = { ...loadConfig(), ...patch };
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    // Best-effort: ignore write failures.
  }
}

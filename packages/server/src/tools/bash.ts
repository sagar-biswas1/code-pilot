import { tool } from "ai";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { LIMITS } from "./lib/limits";
import { toolError } from "./lib/result";

/**
 * `runCommand` — the tool with no real sandbox.
 *
 * Read this before changing anything here: every other tool in this directory
 * enforces its boundary in-process, and can therefore be reasoned about. This
 * one hands a string to a shell. The controls below (allowlist, denied
 * patterns, minimal environment, cwd, timeouts, output caps) raise the cost of
 * misuse and stop the obvious accidents, but a shell is a general-purpose
 * program launcher and **no string-level filtering makes it safe**:
 * `$(printf '\\x72\\x6d')`, `eval`, base64 pipes, and a hundred other spellings
 * all defeat pattern matching.
 *
 * The controls that actually contain this tool are outside the process:
 * run the server in a container or VM, as an unprivileged user, with the
 * workspace as its only writable mount and no cloud credentials in the
 * environment. Treat `allowedBinaries` as the strongest in-process control
 * available, and the pattern list as accident-prevention only.
 */

export interface BashToolOptions {
  /**
   * Directory commands run in. Defaults to a fresh temp directory so a
   * misconfigured caller gets an empty sandbox rather than the process's cwd.
   * `createTools` passes the session workspace root.
   */
  cwd?: string;

  /**
   * When set, only commands whose first token matches an entry here may run.
   * This is the one control on this tool that is not trivially bypassable,
   * because it constrains what can be launched rather than how it is spelled.
   *
   * Example: ["ls", "cat", "grep", "node", "bun", "git"]
   */
  allowedBinaries?: string[];

  /** Extra reject-on-match patterns, added to the defaults. */
  blockedPatterns?: RegExp[];

  /** Extra environment variables. The base environment is minimal by design. */
  env?: NodeJS.ProcessEnv;

  /** Wall-clock ceiling, itself capped at `LIMITS.bash.maxTimeoutMs`. */
  maxTimeoutMs?: number;
}

/**
 * Accident prevention, not a security boundary — see the note above. These
 * cover the destructive commands a confused model actually emits.
 */
const DEFAULT_BLOCKED_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\s+\/(\s|$)/, // rm -rf /
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+[^|]*of=\/dev\//,
  />\s*\/dev\/(sd[a-z]|nvme\d|disk\d)/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, // fork bomb
  /\bshutdown\b|\breboot\b|\bhalt\b/,
  /\bchmod\s+(-[a-zA-Z]+\s+)*777\s+\//,
  /\bcurl\b[^|;&]*\|\s*(ba|z|k)?sh\b/, // curl … | sh
  /\bwget\b[^|;&]*\|\s*(ba|z|k)?sh\b/,
  /\bsudo\b|\bdoas\b|\bsu\s+-/,
  /\bhistory\s+-c\b/,
];

/**
 * The child gets an explicitly constructed environment, never `process.env`.
 *
 * Inheriting the parent environment hands every API key the server holds
 * (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `SENTRY_DSN`, cloud credentials) to
 * anything the model runs — and `env` is one command away from being echoed
 * straight back into the transcript.
 */
function buildSafeEnv(cwd: string, overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: "dumb", // no ANSI escapes in captured output
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    PWD: cwd,
    CI: "1", // most tools skip interactive prompts and spinners when set
    ...overrides,
  };
}

/** First token of a command, for allowlist gating only — never for execution. */
function firstToken(command: string): string {
  const match = command.trim().match(/^[^\s;&|<>()]+/);
  if (!match) return "";
  // `VAR=x cmd` — skip leading assignments so the allowlist sees the binary.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(match[0])) {
    const rest = command.trim().slice(match[0].length).trim();
    return rest === "" ? "" : firstToken(rest);
  }
  return path.basename(match[0]);
}

/** Appends up to `cap` bytes and reports whether anything was dropped. */
function appendCapped(current: string, chunk: string, cap: number) {
  if (current.length >= cap) return { text: current, dropped: true };
  const remaining = cap - current.length;
  if (chunk.length <= remaining) return { text: current + chunk, dropped: false };
  return { text: current + chunk.slice(0, remaining), dropped: true };
}

export function createBashTool(options: BashToolOptions = {}) {
  const cwd =
    options.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), "agent-sandbox-"));
  const env = buildSafeEnv(cwd, options.env);
  const blockedPatterns = [
    ...DEFAULT_BLOCKED_PATTERNS,
    ...(options.blockedPatterns ?? []),
  ];
  const hardMaxTimeout = Math.min(
    options.maxTimeoutMs ?? LIMITS.bash.maxTimeoutMs,
    LIMITS.bash.maxTimeoutMs,
  );

  return tool({
    description:
      "Run a shell command in the workspace directory. Use it for builds, tests, linters, and package managers — " +
      "prefer readFile/writeFile/editFile/glob/grep for file work, since they are safer and cheaper. " +
      "Commands are non-interactive (stdin is closed), time out, and have their output truncated.",
    inputSchema: z.object({
      command: z.string().min(1).describe("The shell command to execute."),
      timeout: z
        .number()
        .int()
        .min(1_000)
        .max(LIMITS.bash.maxTimeoutMs)
        .optional()
        .describe(
          `Timeout in milliseconds (default ${LIMITS.bash.defaultTimeoutMs}, capped at ${hardMaxTimeout}).`,
        ),
    }),
    execute: async ({ command, timeout }, { abortSignal }) => {
      if (command.includes("\0")) {
        return toolError("invalid_input", "Command contains a NUL byte.");
      }
      if (command.length > LIMITS.bash.maxCommandLength) {
        return toolError(
          "invalid_input",
          `Command is too long (limit ${LIMITS.bash.maxCommandLength} characters).`,
        );
      }

      for (const pattern of blockedPatterns) {
        if (pattern.test(command)) {
          return toolError(
            "policy",
            "Command rejected by security policy. If this was intentional, ask the user to run it themselves.",
          );
        }
      }

      if (options.allowedBinaries) {
        const binary = firstToken(command);
        if (!options.allowedBinaries.includes(binary)) {
          return toolError(
            "policy",
            `Command rejected: '${binary}' is not in the allowed binaries list (${options.allowedBinaries.join(", ")}).`,
          );
        }
      }

      const effectiveTimeout = Math.min(
        timeout ?? LIMITS.bash.defaultTimeoutMs,
        hardMaxTimeout,
      );
      const startedAt = Date.now();

      return await new Promise((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd,
          env,
          // stdin is closed: a command that waits for input would otherwise
          // hold the slot until the timeout, every time.
          stdio: ["ignore", "pipe", "pipe"],
          // Own process group, so the kill below reaches grandchildren too —
          // killing the shell alone orphans whatever it spawned.
          detached: true,
        });

        let stdout = "";
        let stderr = "";
        let stdoutDropped = false;
        let stderrDropped = false;
        let settled = false;
        let outcome: "ok" | "timeout" | "aborted" = "ok";

        const signalGroup = (signal: NodeJS.Signals) => {
          if (!child.pid) return;
          try {
            process.kill(-child.pid, signal);
          } catch {
            // Already gone, or the group could not be formed.
          }
        };

        // SIGTERM first so the command can flush and clean up; SIGKILL only if
        // it ignores that. Killing outright leaves lockfiles and temp state.
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const terminate = () => {
          signalGroup("SIGTERM");
          killTimer = setTimeout(() => signalGroup("SIGKILL"), LIMITS.bash.killGraceMs);
        };

        const timer = setTimeout(() => {
          outcome = "timeout";
          terminate();
        }, effectiveTimeout);

        const onAbort = () => {
          outcome = "aborted";
          terminate();
        };
        abortSignal?.addEventListener("abort", onAbort, { once: true });

        const cleanup = () => {
          clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          abortSignal?.removeEventListener("abort", onAbort);
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          const appended = appendCapped(
            stdout,
            chunk.toString("utf8"),
            LIMITS.bash.maxStreamChars,
          );
          stdout = appended.text;
          stdoutDropped ||= appended.dropped;
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          const appended = appendCapped(
            stderr,
            chunk.toString("utf8"),
            LIMITS.bash.maxStreamChars,
          );
          stderr = appended.text;
          stderrDropped ||= appended.dropped;
        });

        child.on("error", (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(
            toolError("io_error", `Failed to start command: ${error.message}`),
          );
        });

        child.on("close", (code, signal) => {
          if (settled) return;
          settled = true;
          cleanup();

          const durationMs = Date.now() - startedAt;

          if (outcome === "timeout") {
            resolve({
              success: false as const,
              code: "timeout" as const,
              error: `Command timed out after ${effectiveTimeout}ms and was terminated.`,
              durationMs,
              stdout,
              stderr,
            });
            return;
          }
          if (outcome === "aborted") {
            resolve({
              success: false as const,
              code: "aborted" as const,
              error: "Command was cancelled.",
              durationMs,
            });
            return;
          }

          const truncated = stdoutDropped || stderrDropped;
          const suffix = truncated
            ? `\n…[output truncated at ${LIMITS.bash.maxStreamChars} characters per stream]`
            : "";

          resolve({
            success: code === 0,
            exitCode: code ?? undefined,
            ...(signal ? { signal } : {}),
            durationMs,
            truncated,
            stdout: stdout + (stdoutDropped ? suffix : ""),
            stderr: stderr + (stderrDropped ? suffix : ""),
            ...(code === 0 && stdout === "" && stderr === ""
              ? { note: "Command succeeded with no output." }
              : {}),
            ...(code !== 0
              ? {
                  error: `Command exited with code ${code}${signal ? ` (signal ${signal})` : ""}.`,
                }
              : {}),
          });
        });
      });
    },
  });
}

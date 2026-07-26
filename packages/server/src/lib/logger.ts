import * as Sentry from "@sentry/hono/bun";

/**
 * Structured logging that goes to stdout *and* to Sentry Logs, so a log line
 * seen in the terminal can also be found next to the trace it belongs to.
 *
 * Sentry Logs require `enableLogs: true` (set in `lib/sentry.ts`); before init
 * runs, or without a DSN, the Sentry side is a no-op and only the console
 * output survives.
 */
export type LogAttributes = Record<string, unknown>;

type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const consoleMethod: Record<Level, (...args: unknown[]) => void> = {
  trace: console.debug,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  fatal: console.error,
};

function emit(level: Level, message: string, attributes?: LogAttributes) {
  const write = consoleMethod[level];
  if (attributes) {
    write(`[${level}] ${message}`, attributes);
  } else {
    write(`[${level}] ${message}`);
  }

  Sentry.logger[level](message, attributes);
}

export const logger = {
  trace: (message: string, attributes?: LogAttributes) =>
    emit("trace", message, attributes),
  debug: (message: string, attributes?: LogAttributes) =>
    emit("debug", message, attributes),
  info: (message: string, attributes?: LogAttributes) =>
    emit("info", message, attributes),
  warn: (message: string, attributes?: LogAttributes) =>
    emit("warn", message, attributes),
  error: (message: string, attributes?: LogAttributes) =>
    emit("error", message, attributes),
  fatal: (message: string, attributes?: LogAttributes) =>
    emit("fatal", message, attributes),
};

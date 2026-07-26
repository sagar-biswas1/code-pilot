import * as Sentry from "@sentry/hono/bun";
import { env } from "./env";

if (!env.sentry.dsn) {
  console.warn(
    "[sentry] SENTRY_DSN is not set — errors will only be logged to the console.",
  );
}

/**
 * Options handed to the `sentry()` Hono middleware. The middleware calls
 * `Sentry.init()` internally, so this must stay the only place Sentry is
 * configured — a second `init()` elsewhere replaces the client and drops
 * everything already buffered.
 */
export const sentryOptions = {
  dsn: env.sentry.dsn,
  environment: env.sentry.environment,
  release: env.sentry.release,
  debug: env.sentry.debug,
  tracesSampleRate: env.sentry.tracesSampleRate,
  enableLogs: true,
  dataCollection: {
    userInfo: env.sentry.sendPii,
    cookies: env.sentry.sendPii,
    // `undefined` means "collect every body type"; `[]` disables body capture.
    httpBodies: env.sentry.sendPii ? undefined : [],
  },
  // `app.onError` is the single place request errors are reported. Without this
  // the middleware would also capture `c.error` after `onError` runs, and every
  // 5xx would land in Sentry twice.
  shouldHandleError: () => false,
};

export type CaptureOptions = {
  level?: Sentry.SeverityLevel;
  /** `handled: false` is what makes Sentry mark the issue as a crash. */
  mechanism?: { handled: boolean; type: string };
  tags?: Record<string, string | number | boolean | undefined>;
  contexts?: Record<string, Record<string, unknown>>;
};

/**
 * Anything can be thrown in JS, but only an `Error` carries a stack trace that
 * Sentry can symbolicate — so normalise first.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(`Non-error thrown: ${JSON.stringify(value)}`);
  } catch {
    return new Error("Non-error thrown: <unserializable value>");
  }
}

/**
 * Report an error to Sentry with scope data attached. `withScope` is what lets
 * tags and contexts travel with a single event instead of leaking into the rest
 * of the request.
 */
export function captureException(
  value: unknown,
  options: CaptureOptions = {},
): string {
  const error = toError(value);

  return Sentry.withScope((scope) => {
    if (options.level) {
      scope.setLevel(options.level);
    }
    if (options.tags) {
      scope.setTags(options.tags);
    }
    for (const [key, context] of Object.entries(options.contexts ?? {})) {
      scope.setContext(key, context);
    }

    return Sentry.captureException(error, {
      mechanism: options.mechanism ?? { handled: true, type: "generic" },
    });
  });
}

/** Give buffered events a chance to leave the process before it dies. */
export async function flushSentry(timeout = 2000): Promise<void> {
  try {
    await Sentry.flush(timeout);
  } catch (error) {
    console.error("[sentry] failed to flush events:", error);
  }
}

export { Sentry };

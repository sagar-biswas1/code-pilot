// `sentry()` initialises the SDK, so nothing that can throw at import time may
// be imported before it. Route modules (and the database client they pull in)
// are loaded lazily further down, once Sentry can report a startup crash.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { sentry } from "@sentry/hono/bun";

import { env } from "./lib/env";
import { logger } from "./lib/logger";
import {
  Sentry,
  captureException,
  flushSentry,
  sentryOptions,
} from "./lib/sentry";
import { requestContext } from "./middleware/requestContext";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Must be registered before any route so the Hono integration can patch them.
app.use(sentry(app, sentryOptions));
app.use(requestContext);

/**
 * Anything that runs while the process boots — module evaluation, config
 * parsing, connection setup — happens before a request exists, so it never
 * reaches `app.onError`. Wrapping it keeps those crashes reportable.
 */
async function bootstrap<T>(step: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    captureException(error, {
      level: "fatal",
      mechanism: { handled: false, type: "startup" },
      tags: { startup_step: step },
    });
    logger.fatal(`Startup failed during "${step}"`, {
      step,
      error: String(error),
    });
    await flushSentry();
    process.exit(1);
  }
}

const { default: sessionsRoutes } = await bootstrap(
  "routes/sessions",
  () => import("./routes/sessions"),
);

if (!env.isProduction) {
  app.get("/debug-sentry", (c) => {
    logger.info("Sentry debug endpoint hit", {
      request_id: c.get("requestId"),
    });
    Sentry.metrics.count("debug_endpoint_hit", 1);
    throw new Error("Sentry debug error — this one is intentional.");
  });
}

app.notFound((c) => {
  // 404s are routine, so they get a breadcrumb rather than an issue of their own.
  Sentry.addBreadcrumb({
    category: "http",
    level: "info",
    message: `404 ${c.req.method} ${c.req.path}`,
  });

  return c.json(
    {
      success: false,
      message: "Not Found",
      requestId: c.get("requestId"),
    },
    404,
  );
});

app.onError((err, c) => {
  const requestId = c.get("requestId");
  const isHttpException = err instanceof HTTPException;
  const status = isHttpException ? err.status : 500;
  const isServerError = status >= 500;

  const route = routePath(c);

  const details = {
    request_id: requestId,
    method: c.req.method,
    path: c.req.path,
    route,
    url: c.req.url,
    status,
  };

  if (isServerError) {
    // `linkedErrorsIntegration` walks `error.cause`, so an HTTPException that
    // wraps the original failure still reports the real stack trace.
    captureException(err, {
      level: "error",
      mechanism: { handled: false, type: "hono.onerror" },
      tags: {
        request_id: requestId,
        http_status: status,
        route,
      },
      contexts: { request_details: details },
    });

    logger.error(`${c.req.method} ${c.req.path} failed with ${status}`, {
      ...details,
      error: err.message,
    });
  } else {
    // Expected client errors: noise as issues, useful as context on the next crash.
    Sentry.addBreadcrumb({
      category: "http",
      level: "warning",
      message: `${status} ${err.message}`,
      data: details,
    });

    logger.warn(`${c.req.method} ${c.req.path} rejected with ${status}`, {
      ...details,
      error: err.message,
    });
  }

  // A handler that built its own Response wins — it was deliberate.
  if (isHttpException && err.res) {
    return err.res;
  }

  return c.json(
    {
      success: false,
      message:
        isServerError && env.isProduction
          ? "Internal Server Error"
          : err.message || "An error occurred",
      requestId,
      ...(env.isProduction
        ? {}
        : {
            stack: err.stack,
            ...(err.cause ? { cause: String(err.cause) } : {}),
          }),
    },
    status,
  );
});

const routes = app.route("/sessions", sessionsRoutes);
export type AppType = typeof routes;

const server = Bun.serve({
  port: env.port,
  //idletime must be high, otherwise llm tool call might not be completed
  idleTimeout: 255,
  fetch: async (request, bunServer) => {
    try {
      return await app.fetch(request, bunServer);
    } catch (error) {
      // Hono's dispatcher only routes `Error` instances to `onError`; a thrown
      // string or a failure inside `onError` itself lands here instead.
      captureException(error, {
        level: "fatal",
        mechanism: { handled: false, type: "bun.fetch" },
        tags: { route: new URL(request.url).pathname },
      });
      logger.fatal("Request failed outside the Hono error handler", {
        method: request.method,
        url: request.url,
        error: String(error),
      });

      return Response.json(
        { success: false, message: "Internal Server Error" },
        { status: 500 },
      );
    }
  },
});

logger.info(`Server listening on http://localhost:${server.port}`, {
  port: server.port,
  environment: env.sentry.environment,
  sentry_enabled: Boolean(env.sentry.dsn),
});

// Uncaught exceptions and unhandled rejections are already captured by the
// Bun SDK's default integrations; this only makes sure a clean shutdown still
// delivers whatever is buffered.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (async () => {
      logger.info(`Received ${signal}, shutting down`, { signal });
      await server.stop();
      await flushSentry();
      process.exit(0);
    })();
  });
}

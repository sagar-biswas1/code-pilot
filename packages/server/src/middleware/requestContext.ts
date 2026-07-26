import { createMiddleware } from "hono/factory";
import * as Sentry from "@sentry/hono/bun";
import type { AppEnv } from "../types";

/**
 * Gives every request a stable id, echoes it back to the client, and tags the
 * Sentry scope with it — so an id from a failed response leads straight to the
 * matching issue, log line, and trace.
 */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();

  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  Sentry.setTag("request_id", requestId);

  await next();
});

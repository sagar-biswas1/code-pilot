/**
 * Bearer-token gate for every route that touches a user's data.
 *
 * The token is the one `POST /oauth/token` mints at the end of the CLI's
 * browser login: an HS256 JWT signed with `JWT_SECRET` whose `sub` is the
 * Clerk user id. Verifying it here is what turns `Session.userId` from a
 * placeholder into a real owner.
 *
 * Failures are thrown, not returned. `app.onError` in `index.ts` is what gives
 * every error body its `{ error, requestId }` shape and its Sentry breadcrumb,
 * and a response built here would skip all of that.
 */

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verify } from "hono/jwt";
import { JwtTokenExpired } from "hono/utils/jwt/types";

import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { Sentry } from "../lib/sentry";
import type { AuthEnv } from "../types";

/**
 * Pinned on purpose. Left to itself `verify` trusts the `alg` field in the
 * token's own header — the classic algorithm-confusion foothold — and HS256 is
 * the only algorithm `POST /oauth/token` ever signs with.
 */
const TOKEN_ALGORITHM = "HS256";

/** RFC 6750 says the scheme is case-insensitive and allows extra spaces. */
const BEARER_PREFIX = /^Bearer +/i;

/** One message for every "your token is no good" path: it is the same fix. */
const RELOGIN_HINT = "run /login to sign in again";

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const secret = env.jwtSecret;
  if (!secret) {
    // A 500, not a 401: the request is fine, the deployment is not. A 401 here
    // would make the CLI throw away a perfectly good token and then fail to
    // get a new one, because minting also needs this secret.
    throw new HTTPException(500, {
      message:
        "Authentication is not configured on this server (missing JWT_SECRET)",
    });
  }

  const header = c.req.header("authorization");
  const token = header && BEARER_PREFIX.test(header)
    ? header.replace(BEARER_PREFIX, "").trim()
    : "";

  if (!token) {
    throw new HTTPException(401, {
      message: `Not signed in — ${RELOGIN_HINT}`,
    });
  }

  let payload;
  try {
    payload = await verify(token, secret, TOKEN_ALGORITHM);
  } catch (error) {
    const expired = error instanceof JwtTokenExpired;

    // The token itself never reaches the log — only why it was refused. An
    // expired token is routine; a signature mismatch is worth noticing.
    logger.warn(
      expired ? "Rejected an expired token" : "Rejected an invalid token",
      {
        request_id: c.get("requestId"),
        reason: error instanceof Error ? error.name : "unknown",
      },
    );

    throw new HTTPException(401, {
      message: expired
        ? `Your session has expired — ${RELOGIN_HINT}`
        : `Invalid token — ${RELOGIN_HINT}`,
    });
  }

  // `sub` is what the whole scheme rests on, so an otherwise valid token
  // without one is refused rather than quietly given an empty owner.
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) {
    logger.warn("Rejected a token with no subject", {
      request_id: c.get("requestId"),
    });
    throw new HTTPException(401, {
      message: `Token is missing a subject — ${RELOGIN_HINT}`,
    });
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;

  c.set("userId", userId);
  if (email) c.set("userEmail", email);

  // Ties every issue raised during this request to the account that hit it.
  // The id is opaque; the address only goes out when PII is explicitly on.
  Sentry.setUser({
    id: userId,
    ...(env.sentry.sendPii && email ? { email } : {}),
  });

  await next();
});

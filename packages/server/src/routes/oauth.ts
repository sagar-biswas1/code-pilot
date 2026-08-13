/**
 * OAuth routes — the server half of the CLI's browser login.
 *
 * The CLI can't hold the OAuth client secret and Clerk won't redirect to a
 * random loopback port, so this server is the registered redirect target and
 * does the secret-bearing half of the exchange:
 *
 *   GET  /oauth/callback  Clerk lands here. The CLI's loopback port rides in
 *                         `state`, so all this does is bounce the *browser* on
 *                         to `http://127.0.0.1:<port>/callback`. Nothing here
 *                         ever connects to the loopback itself.
 *   POST /oauth/token     The CLI posts the code plus its PKCE verifier; we
 *                         complete the exchange with Clerk using the client
 *                         secret and mint the app's own token.
 *
 * See `packages/cli/src/lib/oAuth.ts` for the other half.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { sign } from "hono/jwt";

import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { Sentry } from "../lib/sentry";
import type { AppEnv } from "../types";

/** The CLI's callback server binds loopback only; so does this redirect. */
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_CALLBACK_PATH = "/callback";
/** Ephemeral/registered range only — the CLI asks the OS for port 0. */
const MIN_LOOPBACK_PORT = 1024;
const MAX_LOOPBACK_PORT = 65535;
/** How long a CLI token stays valid before the user has to log in again. */
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type OAuthConfig = {
  frontendApi: string;
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  redirectUri: string;
};

/**
 * Read the OAuth config at request time rather than at import time: a server
 * without Clerk configured should still boot and serve every other route.
 */
function requireOAuthConfig(): OAuthConfig {
  const { frontendApi, oauthClientId, oauthClientSecret } = env.clerk;
  const missing = [
    !frontendApi && "CLERK_FRONTEND_API",
    !oauthClientId && "CLERK_OAUTH_CLIENT_ID",
    !oauthClientSecret && "CLERK_OAUTH_CLIENT_SECRET",
    !env.jwtSecret && "JWT_SECRET",
  ].filter((name): name is string => typeof name === "string");

  if (missing.length > 0) {
    throw new HTTPException(500, {
      message: `Login is not configured on this server (missing ${missing.join(", ")})`,
    });
  }

  return {
    frontendApi: frontendApi!.replace(/\/$/, ""),
    clientId: oauthClientId!,
    clientSecret: oauthClientSecret!,
    jwtSecret: env.jwtSecret!,
    redirectUri: `${env.apiUrl.replace(/\/$/, "")}/oauth/callback`,
  };
}

/**
 * Pull the CLI's loopback port out of `state`.
 *
 * `state` is client-supplied and unsigned, so the port is the *only* thing
 * taken from it — the host and path below are hardcoded. That keeps this from
 * being an open redirect: the worst a forged state can do is point at another
 * port on the user's own machine, where PKCE makes the code useless.
 */
function decodeLoopbackPort(state: string | undefined): number | null {
  if (!state) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as { port?: unknown };
    const port = decoded?.port;
    return typeof port === "number" &&
      Number.isInteger(port) &&
      port >= MIN_LOOPBACK_PORT &&
      port <= MAX_LOOPBACK_PORT
      ? port
      : null;
  } catch {
    return null;
  }
}

/** The only page a user sees here is a dead end, so keep it self-explanatory. */
function terminalPage(message: string) {
  return (
    `<!doctype html><meta charset="utf-8"><title>Code Pilot</title>` +
    `<body style="font-family:system-ui;padding:3rem;text-align:center">` +
    `<p>${message}</p></body>`
  );
}

const tokenSchema = z.object({
  code: z.string().min(1),
  code_verifier: z.string().min(1),
  redirect_uri: z.string().min(1),
});

const oauthRoutes = new Hono<AppEnv>()
  .get("/callback", (c) => {
    const state = c.req.query("state");
    const port = decodeLoopbackPort(state);

    // Without a usable port there is no CLI to hand this back to, so the
    // browser is where the story has to end.
    if (port === null || !state) {
      logger.warn("OAuth callback with unusable state", {
        request_id: c.get("requestId"),
        has_state: Boolean(state),
      });
      return c.html(
        terminalPage(
          "This login link is invalid or has expired. Run <code>code-pilot login</code> again.",
        ),
        400,
      );
    }

    const target = new URL(
      `http://${LOOPBACK_HOST}:${port}${LOOPBACK_CALLBACK_PATH}`,
    );
    // `state` goes back untouched — the CLI checks its own nonce against it.
    target.searchParams.set("state", state);

    const error = c.req.query("error");
    const code = c.req.query("code");

    if (error) {
      // Forward the denial instead of erroring here: the CLI is sitting on a
      // 5-minute timeout and a real message beats waiting it out.
      target.searchParams.set("error", error);
      const description = c.req.query("error_description");
      if (description) target.searchParams.set("error_description", description);
    } else if (!code) {
      target.searchParams.set("error", "invalid_request");
      target.searchParams.set("error_description", "No authorization code");
    } else {
      target.searchParams.set("code", code);
    }

    logger.info("Bouncing OAuth callback to the CLI", {
      request_id: c.get("requestId"),
      port,
      outcome: error ?? (code ? "code" : "missing_code"),
    });

    // The *browser* follows this, and the browser is on the user's machine —
    // which is why a public server can redirect to 127.0.0.1 at all.
    return c.redirect(target.toString(), 302);
  })
  .post("/token", zValidator("json", tokenSchema), async (c) => {
    const config = requireOAuthConfig();
    const { code, code_verifier, redirect_uri } = c.req.valid("json");
    const requestId = c.get("requestId");

    // Clerk would reject a mismatch anyway, but its `invalid_grant` says
    // nothing about *which* side has the wrong API_URL.
    if (redirect_uri !== config.redirectUri) {
      throw new HTTPException(400, {
        message: `redirect_uri mismatch: the CLI used ${redirect_uri}, this server is configured as ${config.redirectUri}`,
      });
    }

    const tokenResponse = await fetch(`${config.frontendApi}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // client_secret_basic — the client secret never goes in a body or URL.
        authorization: `Basic ${Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier,
        redirect_uri,
      }),
    });

    if (!tokenResponse.ok) {
      // The provider's body can carry hints about our own credentials, so it
      // goes to the log, not to the client.
      const detail = await tokenResponse.text().catch(() => "");
      logger.warn("Clerk rejected the authorization code", {
        request_id: requestId,
        status: tokenResponse.status,
        detail: detail.slice(0, 500),
      });
      throw new HTTPException(401, {
        message: "Authorization code was rejected",
      });
    }

    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token?: unknown;
    };
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new HTTPException(502, {
        message: "Identity provider returned no access token",
      });
    }

    const userResponse = await fetch(`${config.frontendApi}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) {
      logger.warn("Clerk userinfo lookup failed", {
        request_id: requestId,
        status: userResponse.status,
      });
      throw new HTTPException(502, {
        message: "Could not read the user profile",
      });
    }

    // Clerk answers with the OIDC `sub`; `user_id` is the same value under the
    // name the rest of Clerk's API uses.
    const profile = (await userResponse.json()) as {
      sub?: unknown;
      user_id?: unknown;
      email?: unknown;
    };
    const userId =
      typeof profile.sub === "string"
        ? profile.sub
        : typeof profile.user_id === "string"
          ? profile.user_id
          : null;

    if (!userId) {
      throw new HTTPException(502, {
        message: "Identity provider returned no user id",
      });
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await sign(
      {
        sub: userId,
        ...(typeof profile.email === "string" ? { email: profile.email } : {}),
        iat: issuedAt,
        exp: issuedAt + TOKEN_TTL_SECONDS,
      },
      config.jwtSecret,
    );

    logger.info("Issued a CLI token", { request_id: requestId, user_id: userId });
    Sentry.addBreadcrumb({
      category: "auth",
      level: "info",
      message: "CLI login completed",
    });

    return c.json({ token });
  });

export default oauthRoutes;

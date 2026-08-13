/**
 * Browser-based login (OAuth 2.0 authorization code + PKCE).
 *
 * The CLI can't hold the OAuth client secret, so the API server is the
 * registered redirect target and does the secret-bearing half of the exchange.
 * A short-lived loopback server is how the browser hands control back:
 *
 *   1. CLI starts a server on 127.0.0.1 with an ephemeral port.
 *   2. CLI opens Clerk's authorize URL. `redirect_uri` is the API server, and
 *      `state` carries a nonce plus that loopback port.
 *   3. Clerk redirects the browser to `API_URL/oauth/callback`. The server
 *      reads the port back out of `state` and bounces the browser to
 *      `http://127.0.0.1:<port>/callback?code=…&state=…`.
 *   4. The loopback handler checks the state, then POSTs the code and the PKCE
 *      verifier to `API_URL/oauth/token`, which completes the exchange with
 *      Clerk and mints the app's own token.
 *   5. The token is persisted with {@link saveAuth} and the server shuts down.
 *
 * PKCE still earns its keep with a confidential client: any local process can
 * hit the loopback port, and the verifier is what binds the code to *this*
 * login attempt.
 *
 * Server side, this expects two routes that don't exist yet:
 *   GET  /oauth/callback  — decode `state`, redirect to the loopback URL
 *   POST /oauth/token     — { code, code_verifier, redirect_uri } → { token }
 */

import open from "open";

import { saveAuth } from "./auth";

/** How long the user gets to finish signing in before we give up. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
/** Loopback only — the callback must not be reachable from the network. */
const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
/** Let the browser's response flush before the socket goes away. */
const SHUTDOWN_GRACE_MS = 250;

type OAuthState = {
  nonce: string;
  port: number;
};

type AuthResult = {
  token: string;
};

function toBase64Url(input: string | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

async function createPkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );

  return toBase64Url(new Uint8Array(digest));
}

function encodeState(state: OAuthState) {
  return toBase64Url(JSON.stringify(state));
}

function decodeState(encoded: string): OAuthState | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<OAuthState>;
    return typeof decoded?.nonce === "string" &&
      typeof decoded?.port === "number"
      ? { nonce: decoded.nonce, port: decoded.port }
      : null;
  } catch (err) {
    return null;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Minimal page for the browser tab the user is left staring at. */
function browserResponse(message: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Code Pilot</title>` +
      `<body style="font-family:system-ui;padding:3rem;text-align:center">` +
      `<p>${message}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Trade the authorization code for an app token. The server holds the OAuth
 * client secret, so it — not the CLI — talks to Clerk's token endpoint.
 */
async function exchangeCodeForToken(options: {
  apiUrl: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(`${options.apiUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: options.code,
      code_verifier: options.codeVerifier,
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `token exchange failed (${response.status} ${response.statusText})`,
    );
  }

  const payload = (await response.json()) as { token?: unknown };
  if (typeof payload?.token !== "string" || payload.token === "") {
    throw new Error("token exchange returned no token");
  }
  return payload.token;
}

/**
 * Run the browser login flow end to end, persisting the token on success.
 *
 * Rejects if the user denies access, the state doesn't check out, the exchange
 * fails, or {@link LOGIN_TIMEOUT_MS} passes with no callback. The loopback
 * server is torn down on every one of those paths.
 */
export async function performLogin(): Promise<AuthResult> {
  const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
  const clientId = process.env.CLERK_OAUTH_CLIENT_ID;
  const apiUrl = process.env.API_URL;

  if (!clerkFrontendApi || !clientId || !apiUrl) {
    throw new Error(
      "Missing required environment variables: CLERK_FRONTEND_API, CLERK_OAUTH_CLIENT_ID, API_URL",
    );
  }

  const nonce = crypto.randomUUID();
  const codeVerifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = await createPkceChallenge(codeVerifier);
  const redirectUri = `${apiUrl}/oauth/callback`;

  return new Promise<AuthResult>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    /**
     * Single exit point: first outcome wins, the rest are ignored. Late or
     * duplicate callbacks are a normal thing for a URL sitting in a browser.
     */
    const settle = (outcome: AuthResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setTimeout(() => server.stop(true), SHUTDOWN_GRACE_MS);
      if (outcome instanceof Error) {
        reject(outcome);
      } else {
        resolve(outcome);
      }
    };

    const fail = (message: string, status = 400) => {
      settle(new Error(message));
      return browserResponse(message, status);
    };

    const server = Bun.serve({
      hostname: LOOPBACK_HOST,
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("Not found", { status: 404 });
        }
        if (settled) {
          return browserResponse("This login has already finished.");
        }

        const errorParam = url.searchParams.get("error");
        if (errorParam) {
          const description = url.searchParams.get("error_description");
          return fail(
            `Authentication failed: ${description ?? errorParam}`,
            400,
          );
        }

        const code = url.searchParams.get("code");
        const stateParam = url.searchParams.get("state");
        if (!code || !stateParam) {
          return fail("Authentication failed: missing code or state");
        }

        // The nonce proves this callback belongs to the login we started; the
        // port pins it to this process's server rather than another CLI's.
        const decodedState = decodeState(stateParam);
        if (
          !decodedState ||
          decodedState.nonce !== nonce ||
          decodedState.port !== loopbackPort
        ) {
          return fail("Authentication failed: invalid state");
        }

        try {
          const token = await exchangeCodeForToken({
            apiUrl,
            code,
            codeVerifier,
            redirectUri,
          });
          saveAuth({ token });
          settle({ token });
          return browserResponse(
            "Signed in. You can close this tab and return to the terminal.",
          );
        } catch (error) {
          return fail(
            `Authentication failed: ${getErrorMessage(error)}`,
            502,
          );
        }
      },
    });

    // The port only exists once the server is listening, so the state — and
    // therefore the authorize URL — can't be built any earlier than this.
    const loopbackPort = server.port;
    if (loopbackPort === undefined) {
      settle(new Error("Failed to start the local callback server"));
      return;
    }

    timeoutId = setTimeout(
      () =>
        settle(
          new Error(
            `Authentication timed out after ${LOGIN_TIMEOUT_MS / 1000}s`,
          ),
        ),
      LOGIN_TIMEOUT_MS,
    );

    const state = encodeState({ nonce, port: loopbackPort });
    const authUrl =
      `${clerkFrontendApi}/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=S256` +
      `&state=${encodeURIComponent(state)}`;

    // `open` resolves with a process handle it can't vouch for, so a truthy
    // check proves nothing — only a throw is a real signal here.
    open(authUrl).catch((error: unknown) => {
      settle(
        new Error(
          `Failed to open the browser (${getErrorMessage(error)}). ` +
            `Open this URL manually:\n${authUrl}`,
        ),
      );
    });
  });
}

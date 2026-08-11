import { hc } from "hono/client";
import type { AppType } from "@codepilot/server";

/**
 * Typed client for the server's Hono app.
 *
 * `AppType` is the *type* of the route tree exported by `@codepilot/server`,
 * so every path, param and body below is checked against the real routes — no
 * codegen, no schema file. The import is type-only: no server code is bundled
 * into the CLI.
 */
const DEFAULT_API_URL = "http://localhost:3000";

// `.trim()` because a stray space in `.env` (`API_URL= http://…`) otherwise
// becomes part of the base URL and every request 404s in a confusing way.
const baseUrl = process.env.API_URL?.trim() || DEFAULT_API_URL;

export const apiClient = hc<AppType>(baseUrl);
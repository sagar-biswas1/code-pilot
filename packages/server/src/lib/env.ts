import "dotenv/config";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

function toNumber(value: string | undefined, fallback: number) {
  // `Number("")` and `Number("  ")` are 0, not NaN — an unset-but-present var
  // like `PORT=` would otherwise silently bind the server to port 0.
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSampleRate(value: string | undefined, fallback: number) {
  const parsed = toNumber(value, fallback);
  return parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const port = toNumber(process.env.PORT, 3000);

export const env = {
  nodeEnv,
  isProduction,
  port,
  /**
   * The server's own public origin. It has to match the `redirect_uri` the CLI
   * sends and the one registered with Clerk, so it is configuration rather
   * than something derived from an inbound request (which a proxy can rewrite).
   */
  apiUrl: process.env.API_URL?.trim() || `http://localhost:${port}`,
  clerk: {
    frontendApi: process.env.CLERK_FRONTEND_API?.trim(),
    oauthClientId: process.env.CLERK_OAUTH_CLIENT_ID?.trim(),
    // Never leaves the server — it is the whole reason the CLI delegates the
    // token exchange instead of talking to Clerk directly.
    oauthClientSecret: process.env.CLERK_OAUTH_CLIENT_SECRET?.trim(),
  },
  jwtSecret: process.env.JWT_SECRET?.trim(),
  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? nodeEnv,
    release: process.env.SENTRY_RELEASE,
    debug: process.env.SENTRY_DEBUG === "true",
    // Full traces are cheap locally, but sampling matters once this runs for real.
    tracesSampleRate: toSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      isProduction ? 0.1 : 1.0,
    ),
    // Off by default: prompts and cwd paths flow through this API.
    sendPii: process.env.SENTRY_SEND_PII === "true",
  },
} as const;

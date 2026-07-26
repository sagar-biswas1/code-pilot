import "dotenv/config";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

function toNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSampleRate(value: string | undefined, fallback: number) {
  const parsed = toNumber(value, fallback);
  return parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export const env = {
  nodeEnv,
  isProduction,
  port: toNumber(process.env.PORT, 3000),
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

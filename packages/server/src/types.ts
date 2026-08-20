/**
 * Shared Hono environment. Every app and sub-app is typed with this so
 * `c.get("requestId")` is available everywhere, including inside route files.
 */
export type AppEnv = {
  Variables: {
    requestId: string;
  };
};

/**
 * Environment for routes behind {@link requireAuth}. Only the middleware can
 * make `userId` true, so a route file typed with this must mount it — that
 * coupling is the point: `c.get("userId")` typed as `string` on an unguarded
 * route would silently be `undefined` at runtime.
 */
export type AuthEnv = {
  Variables: AppEnv["Variables"] & {
    /** Clerk's `sub`. This is the value `Session.userId` is keyed on. */
    userId: string;
    /** Only present if the token carried one; for logs and Sentry, not authz. */
    userEmail?: string;
  };
};

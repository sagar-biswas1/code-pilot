/**
 * Shared Hono environment. Every app and sub-app is typed with this so
 * `c.get("requestId")` is available everywhere, including inside route files.
 */
export type AppEnv = {
  Variables: {
    requestId: string;
  };
};

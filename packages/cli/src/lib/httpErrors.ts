/**
 * Turn a failed response into the best message available for the user.
 *
 * The API answers with `{ error }` on every route, but Hono's built-in
 * handlers (and any proxy in front of the server) can produce other shapes, so
 * `message` is accepted as a fallback before giving up on the status line.
 */

type ErrorResponse = {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
};

function firstStringField(
  value: unknown,
  keys: readonly string[],
): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  for (const key of keys) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string" && field.length > 0) return field;
  }
  return undefined;
}

export async function getErrorMessage(response: ErrorResponse): Promise<string> {
  try {
    const body = await response.json();
    const message = firstStringField(body, ["error", "message"]);
    if (message) return message;
  } catch {
    // Not JSON (an HTML error page, an empty body, a truncated stream) —
    // nothing to extract, so fall through to the status line.
  }

  return (
    response.statusText || `Request failed with status ${response.status}`
  );
}

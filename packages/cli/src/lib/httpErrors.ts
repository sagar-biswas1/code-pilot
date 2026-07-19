type ErrorResponse = {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
};

export async function getErrorMessage(response: ErrorResponse) {
  try {
    const data = (await response.json()) as { error?: string };
    if (typeof data.error === "string" && data.error?.length > 0) {
      return data.error;
    }
  } catch (error) {
    return (
      response?.statusText ||
      "request failed with status " + response?.status + " and error " + error
    );
  }
  return (
    response?.statusText || "request failed with status " + response?.status
  );
}

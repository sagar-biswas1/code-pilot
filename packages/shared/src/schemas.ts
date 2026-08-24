import { z } from "zod";

export const toolCallArgsSchema = z.record(z.string(), z.json());

export const messagePartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reasoning"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool-call"),
    id: z.string(),
    args: toolCallArgsSchema,
    name: z.string(),
    /**
     * The tool's output, JSON-encoded.
     *
     * Stored as a string rather than as structured JSON because it is only
     * ever two things: a line of text in the transcript, and an opaque blob
     * handed back to the model. Neither reads into it, and keeping it a string
     * means a tool that returns something unusual can never break the shape of
     * a stored message.
     *
     * `undefined` means the call has not been answered yet — the turn is
     * parked waiting for the CLI to run it.
     */
    result: z.string().optional(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
]);

export const messagePartsSchema = z.array(messagePartSchema);

export type MessagePart = z.infer<typeof messagePartSchema>;

export type ToolCallPart = Extract<MessagePart, { type: "tool-call" }>;

/**
 * Where the model is running, from the CLI's point of view.
 *
 * Sent on every chat request rather than stored on the session, because the
 * tools execute on the user's machine and nothing stops them running the same
 * session from a different checkout tomorrow. The server treats it as prompt
 * context only — it never resolves a path against it.
 */
export const workspaceContextSchema = z.object({
  cwd: z.string().min(1),
});

export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

/**
 * Why a step stopped.
 *
 * `tool-calls` means the model asked for tools and the turn is only half
 * finished: the CLI has to run them and post the results back before the
 * assistant can say anything else. `end` means the turn is over.
 */
export const stopReasonSchema = z.enum(["end", "tool-calls"]);

export type StopReason = z.infer<typeof stopReasonSchema>;

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text-delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("reasoning-delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    args: toolCallArgsSchema,
    toolName: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    messageId: z.string(),
    /** Cumulative generation time for the whole turn, in milliseconds. */
    durationMs: z.number(),
    stopReason: stopReasonSchema,
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

/**
 * One finished tool call, on its way back to the server.
 *
 * `toolName` is echoed rather than looked up server-side: the provider needs
 * it on the `tool` message, and taking the client's word for a value the
 * server already has stored would let a mismatched pair through. The route
 * validates it against the recorded call before using it.
 */
export const toolResultPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  result: z.json(),
});

export type ToolResultPayload = z.infer<typeof toolResultPayloadSchema>;

export const submitToolResultsSchema = z.object({
  /** The assistant message whose pending tool calls these answer. */
  messageId: z.string().min(1),
  results: z.array(toolResultPayloadSchema).min(1),
  workspace: workspaceContextSchema,
});

export type SubmitToolResults = z.infer<typeof submitToolResultsSchema>;

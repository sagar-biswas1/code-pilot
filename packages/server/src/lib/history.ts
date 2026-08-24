/**
 * Rebuilding the conversation the model sees, from the rows we stored.
 *
 * This is more than a `map`, because a turn that used tools is not one message
 * — it is an assistant message carrying `tool-call` parts followed by a `tool`
 * message carrying the matching results. Providers validate that pairing
 * strictly: an assistant `tool_use` with no answering `tool_result` is a 400,
 * not a warning. Since tools now run on the user's machine and a turn can be
 * interrupted between the call and the result, unanswered calls are a normal
 * state of the database rather than a corruption — so every one of them gets a
 * synthetic result here instead of being sent as-is.
 */

import type { ModelMessage } from "ai";
import {
  messagePartsSchema,
  type MessagePart,
  type ToolCallPart,
} from "@codepilot/shared";
import type { Role, MessageStatus } from "@codepilot/database/enums";

/**
 * How many stored messages get replayed. Every turn re-sends the whole
 * history, so without a cap the prompt (and the bill) grows without bound.
 * Trimming from the end keeps the most recent context.
 *
 * The cap counts *rows*, and a row expands to at most an assistant/tool pair,
 * so trimming can never separate a tool call from its result.
 */
export const MAX_HISTORY_MESSAGES = 20;

export interface StoredMessage {
  role: Role;
  content: string;
  status: MessageStatus;
  parts?: unknown;
}

/** What the model is told about a call the user interrupted. */
const CANCELLED_RESULT = {
  success: false,
  code: "aborted",
  error: "The user interrupted this turn before the tool ran.",
} as const;

function parseParts(raw: unknown): MessagePart[] | null {
  if (raw == null) return null;
  const parsed = messagePartsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Tool output is stored as a JSON string. Handing the model the parsed value
 * lets it see structure (`success: false`, a `code`) rather than a wall of
 * escaped quotes; a value that does not parse is passed through as text so a
 * malformed result still answers its call.
 */
function toToolOutput(result: string) {
  try {
    return { type: "json" as const, value: JSON.parse(result) };
  } catch {
    return { type: "text" as const, value: result };
  }
}

function toolResultFor(part: ToolCallPart) {
  return {
    type: "tool-result" as const,
    toolCallId: part.id,
    toolName: part.name,
    output:
      part.result === undefined
        ? { type: "json" as const, value: CANCELLED_RESULT }
        : toToolOutput(part.result),
  };
}

/**
 * Expand one assistant row into the one or two model messages it represents.
 *
 * Reasoning parts are deliberately dropped. They carry provider-specific
 * signatures that are only valid inside the response that produced them, and
 * replaying them on a later request is rejected by some providers outright.
 */
function expandAssistantMessage(message: StoredMessage): ModelMessage[] {
  const parts = parseParts(message.parts);

  if (!parts || parts.length === 0) {
    if (message.content.length === 0) return [];
    return [{ role: "assistant", content: message.content }];
  }

  const content: Exclude<
    Extract<ModelMessage, { role: "assistant" }>["content"],
    string
  > = [];
  const toolCalls: ToolCallPart[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) content.push({ type: "text", text: part.text });
    } else if (part.type === "tool-call") {
      toolCalls.push(part);
      content.push({
        type: "tool-call",
        toolCallId: part.id,
        toolName: part.name,
        input: part.args,
      });
    }
  }

  if (content.length === 0) return [];

  const messages: ModelMessage[] = [{ role: "assistant", content }];

  if (toolCalls.length > 0) {
    messages.push({ role: "tool", content: toolCalls.map(toolResultFor) });
  }

  return messages;
}

export function buildConversationHistory(
  messages: StoredMessage[],
): ModelMessage[] {
  // Trim first, expand second: the cap is meant to bound how much of the
  // conversation is replayed, and expanding first would let a single
  // tool-heavy turn eat the whole budget.
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);

  return recent.flatMap((message): ModelMessage[] => {
    // Errors were never part of the conversation — they are what happened
    // instead of one.
    if (message.role === "ERROR") return [];

    if (message.role === "USER") {
      // An empty turn of either role is rejected by some providers.
      if (message.content.length === 0) return [];
      return [{ role: "user", content: message.content }];
    }

    return expandAssistantMessage(message);
  });
}

/**
 * The tool calls in an assistant row that are still waiting for an answer.
 *
 * Used by the tool-results route to check that the client is answering calls
 * that actually exist, and by the stream to decide whether a turn is finished.
 */
export function pendingToolCalls(parts: MessagePart[]): ToolCallPart[] {
  return parts.filter(
    (part): part is ToolCallPart =>
      part.type === "tool-call" && part.result === undefined,
  );
}

import { expect, test } from "bun:test";

import { buildConversationHistory, pendingToolCalls } from "./history";
import type { StoredMessage } from "./history";
import type { MessagePart } from "@codepilot/shared";

/**
 * These tests are about the *pairing*, not the mapping.
 *
 * Providers reject an assistant `tool_use` that no `tool_result` answers with a
 * 400, and tools now run on a machine that can disappear mid-turn — so an
 * unanswered call is a normal row in the database, and the thing that must
 * never happen is one reaching the provider unpaired.
 */

const user = (content: string): StoredMessage => ({
  role: "USER",
  content,
  status: "COMPLETE",
});

const assistant = (
  parts: MessagePart[],
  status: StoredMessage["status"] = "COMPLETE",
): StoredMessage => ({
  role: "ASSISTANT",
  content: parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(""),
  status,
  parts,
});

const toolCall = (id: string, result?: string): MessagePart => ({
  type: "tool-call",
  id,
  name: "readFile",
  args: { path: "a.ts" },
  ...(result === undefined ? {} : { result }),
});

test("a plain exchange maps to plain messages", () => {
  const history = buildConversationHistory([
    user("hello"),
    assistant([{ type: "text", text: "hi" }]),
  ]);

  expect(history).toEqual([
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
  ]);
});

test("a tool turn expands into an assistant message and a tool message", () => {
  const history = buildConversationHistory([
    user("read a.ts"),
    assistant([
      { type: "text", text: "Looking." },
      toolCall("c1", '{"success":true,"content":"x"}'),
    ]),
  ]);

  expect(history).toHaveLength(3);
  expect(history[1]).toEqual({
    role: "assistant",
    content: [
      { type: "text", text: "Looking." },
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "readFile",
        input: { path: "a.ts" },
      },
    ],
  });
  expect(history[2]).toEqual({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "readFile",
        output: { type: "json", value: { success: true, content: "x" } },
      },
    ],
  });
});

test("an unanswered tool call still gets a result", () => {
  // The user closed the CLI between the call and its result. Sent as-is this
  // is a 400 from the provider, so the gap is filled rather than forwarded.
  const history = buildConversationHistory([
    user("read a.ts"),
    assistant([toolCall("c1")], "PENDING_TOOLS"),
  ]);

  const toolMessage = history[2] as unknown as {
    role: string;
    content: { toolCallId: string; output: { value: { code: string } } }[];
  };
  expect(toolMessage.role).toBe("tool");
  expect(toolMessage.content[0]!.toolCallId).toBe("c1");
  expect(toolMessage.content[0]!.output.value.code).toBe("aborted");
});

test("every tool call in a turn is answered, answered or not", () => {
  const history = buildConversationHistory([
    user("read them"),
    assistant([toolCall("c1", '{"ok":true}'), toolCall("c2")], "INTERRUPTED"),
  ]);

  const assistantMessage = history[1] as unknown as { content: { type: string }[] };
  const toolMessage = history[2] as unknown as { content: { toolCallId: string }[] };

  const calls = assistantMessage.content.filter((p) => p.type === "tool-call");
  expect(calls).toHaveLength(2);
  expect(toolMessage.content.map((r) => r.toolCallId)).toEqual(["c1", "c2"]);
});

test("a result that is not JSON is passed through as text", () => {
  const history = buildConversationHistory([
    user("go"),
    assistant([toolCall("c1", "not json at all")]),
  ]);

  const toolMessage = history[2] as unknown as {
    content: { output: { type: string; value: string } }[];
  };
  expect(toolMessage.content[0]!.output).toEqual({
    type: "text",
    value: "not json at all",
  });
});

test("error rows and empty turns are dropped", () => {
  const history = buildConversationHistory([
    user("hello"),
    { role: "ERROR", content: "boom", status: "COMPLETE" },
    user(""),
    assistant([]),
  ]);

  expect(history).toEqual([{ role: "user", content: "hello" }]);
});

test("reasoning is not replayed", () => {
  // Reasoning blocks carry signatures that are only valid inside the response
  // that produced them; some providers reject a replayed one outright.
  const history = buildConversationHistory([
    user("hello"),
    assistant([
      { type: "reasoning", text: "thinking..." },
      { type: "text", text: "hi" },
    ]),
  ]);

  expect(history[1]).toEqual({
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
  });
});

test("trimming keeps a tool call and its result together", () => {
  // 30 rows, the last of which is a tool turn — the cap counts rows and each
  // row expands as a unit, so the pair can never be split across the boundary.
  const filler = Array.from({ length: 28 }, (_, i) => user(`m${i}`));
  const history = buildConversationHistory([
    ...filler,
    user("read a.ts"),
    assistant([toolCall("c1", '{"ok":true}')]),
  ]);

  const last = history[history.length - 1] as unknown as { role: string };
  const secondLast = history[history.length - 2] as unknown as { role: string };
  expect(secondLast.role).toBe("assistant");
  expect(last.role).toBe("tool");
});

test("pendingToolCalls finds only the unanswered ones", () => {
  const parts: MessagePart[] = [
    { type: "text", text: "hi" },
    toolCall("c1", '{"ok":true}'),
    toolCall("c2"),
  ];
  expect(pendingToolCalls(parts).map((p) => p.id)).toEqual(["c2"]);
});

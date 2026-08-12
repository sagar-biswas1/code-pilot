import { TextAttributes } from "@opentui/core";
import { useMemo } from "react";

import { useTheme } from "../../providers/theme";
import type {
  ClientMessagePart,
  ClientToolCallPart,
} from "../../hooks/useChat";
import type { Mode } from "@codepilot/database/enums";

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: Mode;
  duration?: string;
  streaming: boolean;
  interrupted?: boolean;
};

/** Longest single-line preview rendered for a tool's arguments / result. */
const MAX_ARGS_LENGTH = 120;
const MAX_RESULT_LENGTH = 200;

/**
 * Formats a tool identifier (e.g., "get_current_weather", "webSearch")
 * into a human-readable display title (e.g., "Get Current Weather", "Web Search").
 */
export function formatToolName(name: string): string {
  if (!name) return "";

  return (
    name
      // Insert spaces before capital letters in camelCase / PascalCase
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // Replace underscores and hyphens with spaces
      .replace(/[-_]+/g, " ")
      // Trim leading/trailing whitespace
      .trim()
      // Capitalize the first letter of every word
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

/** Collapse whitespace and clip, so a value always occupies exactly one row. */
function toSingleLine(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength)}…`
    : collapsed;
}

/** Args arrive as unknown JSON — stringify anything that isn't already text. */
function formatToolArgValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatToolArgs(tool: ClientToolCallPart): string {
  if (!tool.args) return "";
  return toSingleLine(
    Object.entries(tool.args)
      .map(([key, value]) => `${key}: ${formatToolArgValue(value)}`)
      .join(", "),
    MAX_ARGS_LENGTH,
  );
}

/**
 * A tool is finished once its result lands. The stream sets `result` on the
 * existing part rather than re-emitting it, so presence of a result — not the
 * `status` it was created with — is what decides the marker.
 */
function isToolSettled(tool: ClientToolCallPart): boolean {
  return tool.status === "done" || tool.result !== undefined;
}

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

/**
 * Merge runs of same-typed parts so text that was split across deltas renders
 * as one block and back-to-back tool calls share a single list.
 *
 * Keys are derived from the group's position, never randomly: parts are only
 * ever appended to (and the trailing one mutated) while a reply streams, so a
 * positional key is stable and keeps React from remounting the whole reply on
 * every token.
 */
function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const part of parts) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
    } else {
      groups.push({
        type: part.type,
        parts: [part],
        key: `group-${groups.length}-${part.type}`,
      });
    }
  }
  return groups;
}

/**
 * Label and accent per mode. Keyed off the enum so adding a mode to the Prisma
 * schema surfaces as a type error here instead of silently falling through to
 * a wrong default.
 */
const MODE_META: Record<
  Mode,
  { label: string; colorToken: "info" | "warning" }
> = {
  PLAN: { label: "Plan", colorToken: "info" },
  BUILD: { label: "Build", colorToken: "warning" },
};

/** The assistant's prose — the only group that gets a filled bubble. */
function TextGroup({ parts }: { parts: ClientMessagePart[] }) {
  const { colors } = useTheme();
  const text = parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  if (!text.trim()) return null;

  return (
    <box
      justifyContent="center"
      paddingX={2}
      paddingY={1}
      backgroundColor={colors.surface}
      width="100%"
    >
      <text>{text}</text>
    </box>
  );
}

/** Chain-of-thought, deliberately quiet so it reads as an aside. */
function ReasoningGroup({ parts }: { parts: ClientMessagePart[] }) {
  const { colors } = useTheme();
  const text = parts
    .map((part) => (part.type === "reasoning" ? part.text : ""))
    .join("");

  if (!text.trim()) return null;

  return (
    <box paddingX={2} width="100%">
      <text
        fg={colors.textSubtle}
        attributes={TextAttributes.DIM | TextAttributes.ITALIC}
      >
        {text}
      </text>
    </box>
  );
}

function ToolCall({ tool }: { tool: ClientToolCallPart }) {
  const { colors } = useTheme();
  const settled = isToolSettled(tool);
  const args = formatToolArgs(tool);

  return (
    <box width="100%">
      <box flexDirection="row" gap={1}>
        <text fg={settled ? colors.success : colors.warning}>
          {settled ? "⏺" : "◌"}
        </text>
        <text attributes={TextAttributes.BOLD}>{formatToolName(tool.name)}</text>
        {args ? (
          <text fg={colors.textMuted} attributes={TextAttributes.DIM}>
            {args}
          </text>
        ) : null}
      </box>
      {tool.result !== undefined ? (
        <box flexDirection="row" gap={1} paddingLeft={2}>
          <text fg={colors.textSubtle}>⎿</text>
          <text fg={colors.textSubtle} attributes={TextAttributes.DIM}>
            {toSingleLine(tool.result, MAX_RESULT_LENGTH)}
          </text>
        </box>
      ) : null}
    </box>
  );
}

function ToolCallGroup({ parts }: { parts: ClientMessagePart[] }) {
  return (
    <box paddingX={2} width="100%">
      {parts.map((part) =>
        part.type === "tool-call" ? (
          <ToolCall key={part.id} tool={part} />
        ) : null,
      )}
    </box>
  );
}

function PartGroupView({ group }: { group: PartGroup }) {
  switch (group.type) {
    case "text":
      return <TextGroup parts={group.parts} />;
    case "reasoning":
      return <ReasoningGroup parts={group.parts} />;
    case "tool-call":
      return <ToolCallGroup parts={group.parts} />;
  }
}

export function BotMessage({
  parts,
  model,
  mode,
  duration,
  streaming,
  interrupted = false,
}: Props) {
  const { colors } = useTheme();
  const meta = MODE_META[mode];
  const groups = useMemo(() => groupConsecutiveParts(parts), [parts]);

  return (
    <box width="100%" alignItems="center" justifyContent="center">
      <box paddingX={2} paddingY={1} width="100%" gap={1}>
        {groups.map((group) => (
          <PartGroupView key={group.key} group={group} />
        ))}
        {interrupted ? (
          <text fg={colors.warning} attributes={TextAttributes.DIM}>
            Interrupted
          </text>
        ) : null}
      </box>
      <box paddingX={2} paddingY={1} width="100%">
        <box flexDirection="row" alignItems="center">
          <text fg={colors[meta.colorToken]}>🤖</text>
          <box flexDirection="row" gap={1}>
            <text>{meta.label}</text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {duration && (
              <text attributes={TextAttributes.DIM}>{duration}</text>
            )}
            {streaming && <text attributes={TextAttributes.DIM}>🔄</text>}
          </box>
        </box>
      </box>
    </box>
  );
}

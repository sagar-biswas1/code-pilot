import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { ClientMessagePart } from "../../hooks/useChat";
import type { Mode } from "@codepilot/database/enums";

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: Mode;
  duration?: string;
  streaming: boolean;
  interrupted?: boolean;
};

/**
 * Label and accent per mode. Keyed off the enum so adding a mode to the Prisma
 * schema surfaces as a type error here instead of silently falling through to
 * a wrong default.
 */
const MODE_META: Record<Mode, { label: string; colorToken: "info" | "warning" }> =
  {
    PLAN: { label: "Plan", colorToken: "info" },
    BUILD: { label: "Build", colorToken: "warning" },
  };

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
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  return (
    <box width="100%" alignItems="center" justifyContent="center">
      <box paddingX={2} paddingY={1} width="100%">
        <box
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
        >
          <text>{text}</text>
        </box>
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

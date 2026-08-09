import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { ClientMessagePart } from "../../hooks/useChat";
import { Mode } from "@codepilot/database/enums";

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: Mode;
  duration?: string;
  streaming: boolean;
};

export function BotMessage({ parts, model, mode, duration, streaming }: Props) {
  const { colors } = useTheme();
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
      </box>
      <box paddingX={2} paddingY={1} width="100%">
        <box flexDirection="row" alignItems="center">
          <text
            fg={
              mode === Mode.PLAN
                ? colors.info
                : mode === Mode.BUILD
                  ? colors.warning
                  : colors.success
            }
          >
            🤖
          </text>
          <box flexDirection="row" gap={1}>
            <text>
              {mode === Mode.PLAN
                ? "Plan"
                : mode === Mode.BUILD
                  ? "Build"
                  : "Deploy"}
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            <text attributes={TextAttributes.DIM}>🔍</text>
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

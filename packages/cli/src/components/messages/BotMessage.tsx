import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";

type Props = {
  content: string;
  model: string;
};

export function BotMessage({ content, model }: Props) {
  const { colors } = useTheme();

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
          <text>{content}</text>
        </box>
      </box>
      <box paddingX={2} paddingY={1} width="100%">
        <box flexDirection="row" alignItems="center" >
          <text fg={colors.info}>🤖</text>
          <text attributes={TextAttributes.DIM}> {model}</text>
        </box>
      </box>
    </box>
  );
}

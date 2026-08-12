import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { Mode } from "@codepilot/database/enums";

type Props = {
  message: string;
  mode: Mode;
};

export function UserMessage({ message, mode }: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" alignItems="center" justifyContent="center">
      <box border={["left"]} borderColor={colors.text} width="100%">
        <box
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={
            mode === "BUILD" ? colors.surface : colors.background
          }
          width="100%"
        >
          <text>{message}</text>
        </box>
      </box>
    </box>
  );
}

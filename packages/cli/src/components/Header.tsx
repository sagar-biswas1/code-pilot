import { borders, spacing } from "../theme";
import { useTheme } from "../providers/theme";

/**
 * App banner shown at the top of the screen: the "Code Pilot" wordmark drawn
 * with ASCII fonts inside an accent-bordered box.
 */
export function Header() {
  const { colors } = useTheme();
  return (
    <box
      paddingLeft={spacing.xs}
      paddingRight={spacing.xs}
      justifyContent="center"
      alignItems="center"
    >
      <ascii-font font="tiny" text="Code" color="gray" />

      <ascii-font font="shade" text="Pilot" />
    </box>
  );
}

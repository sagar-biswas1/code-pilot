import { borders, colors, spacing } from "../theme";

export function Header() {
  return (
    <box
      paddingLeft={spacing.xs}
      paddingRight={spacing.xs}
      borderStyle={borders.default}
      borderColor={colors.borderAccent}
      justifyContent="center"
      alignItems="center"
    >
      <ascii-font font="tiny" text="Code" color="gray"/>

      <ascii-font font="shade" text="Pilot" />
    </box>
  );
}

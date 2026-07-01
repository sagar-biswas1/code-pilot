import { colors, spacing, textVariant } from "../theme";

export interface StatusBarProps {
  /** Short status label shown on the left (e.g. "Ready", "Thinking…"). */
  status?: string;
  /** Contextual text shown in the middle (e.g. active model or file). */
  message?: string;
  /** Key hints shown on the right. */
  hints?: Array<{ key: string; label: string }>;
}

const DEFAULT_HINTS: Array<{ key: string; label: string }> = [
  { key: "↵", label: "send" },
  { key: "^C", label: "quit" },
];

export function StatusBar({
  status = "Ready",
  message,
  hints = DEFAULT_HINTS,
}: StatusBarProps) {
  return (
    <box
      flexGrow={0}
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      width="100%"
      backgroundColor={colors.surfaceRaised}
      paddingLeft={spacing.xs}
      paddingRight={spacing.xs}
      paddingTop={spacing.xs}
      paddingBottom={spacing.xs}
    
    >
      {/* Left: status indicator */}
      <box flexShrink={0} flexDirection="row" alignItems="center" gap={spacing.xs}>
        <text fg={colors.success}>●</text>
        <text {...textVariant("label")}>{status}</text>
        <text fg={colors.accent} marginLeft={spacing.xs}>❯</text>
      </box>

      {/* Middle: contextual message (single line, truncates instead of wrapping) */}
      <box flexGrow={1} flexShrink={1} overflow="hidden" paddingLeft={spacing.sm} paddingRight={spacing.sm}>
        {message ? (
          <text {...textVariant("subtle")} wrapMode="none" truncate>
            {message}
          </text>
        ) : null}
      </box>

      {/* Right: key hints */}
      <box flexShrink={0} flexDirection="row" alignItems="center" gap={spacing.sm}>
        {hints.map((hint) => (
          <box key={hint.key} flexDirection="row" gap={spacing.xs}>
            <text {...textVariant("label")}>{hint.key}</text>
            <text fg="gray">&#62;</text>
            <text {...textVariant("subtle")}>{hint.label}</text>
          </box>
        ))}
      </box>
    </box>
  );
}

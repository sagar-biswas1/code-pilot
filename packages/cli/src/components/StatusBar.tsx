import { homedir } from "node:os";
import { useMemo } from "react";

import { spacing } from "../theme";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/promptConfig";
import { WORKSPACE_ROOT } from "../lib/workspace";

export interface StatusBarProps {
  /** Short status label shown on the left (e.g. "Ready", "Thinking…"). */
  status?: string;
  /** Contextual text shown in the middle (e.g. active model or file). */
  message?: string;
  /** Key hints shown on the right. */
  hints?: Array<{ key: string; label: string }>;
}

/** Key hints shown when the caller doesn't supply its own. */
const DEFAULT_HINTS: Array<{ key: string; label: string }> = [
  { key: "↵", label: "send" },
  { key: "^C", label: "quit" },
];

/**
 * `~/projects/app` rather than `/Users/someone/projects/app` — the status line
 * is one row and the home prefix is the least informative part of the path.
 */
function displayPath(absolute: string): string {
  const home = homedir();
  return absolute === home
    ? "~"
    : absolute.startsWith(`${home}/`)
      ? `~${absolute.slice(home.length)}`
      : absolute;
}

/**
 * Single-line status strip: mode on the left, the workspace and model in the
 * middle, and key hints on the right.
 */
export function StatusBar({ hints = DEFAULT_HINTS }: StatusBarProps) {
  const { colors, textVariant } = useTheme();
  const { mode, model } = usePromptConfig();
  // The working directory is part of the status now that tools run against it:
  // the same session started from the wrong directory edits the wrong project,
  // and nothing else on screen would say so.
  const message = useMemo(
    () => `${displayPath(WORKSPACE_ROOT)}  ·  ${model}`,
    [model],
  );
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
      <box
        flexShrink={0}
        flexDirection="row"
        alignItems="center"
        gap={spacing.xs}
      >
        <text fg={colors.success}>●</text>
        <text {...textVariant("label")}>{mode}</text>
        <text fg={colors.accent} marginLeft={spacing.xs}>
          ❯
        </text>
      </box>

      {/* Middle: contextual message (single line, truncates instead of wrapping) */}
      <box
        flexGrow={1}
        flexShrink={1}
        overflow="hidden"
        paddingLeft={spacing.sm}
        paddingRight={spacing.sm}
      >
        {message ? (
          <text {...textVariant("subtle")} wrapMode="none" truncate>
            {message}
          </text>
        ) : null}
      </box>

      {/* Right: key hints */}
      <box
        flexShrink={0}
        flexDirection="row"
        alignItems="center"
        gap={spacing.sm}
      >
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

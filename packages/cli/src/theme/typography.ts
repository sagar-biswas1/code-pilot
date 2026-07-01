/**
 * Typography tokens.
 *
 * Terminals have no font sizes, so "type" here is expressed through OpenTUI
 * `TextAttributes` (bold/dim/italic/underline) combined with semantic color.
 * Each variant returns the props a `<text>` needs; spread it onto the element:
 *
 *   <text {...textVariant("heading")}>Code Pilot</text>
 */

import { TextAttributes } from "@opentui/core";
import { colors } from "./colors";

export interface TextVariantStyle {
  fg: string;
  attributes?: number;
}

export const typography = {
  heading: {
    fg: colors.text,
    attributes: TextAttributes.BOLD,
  },
  title: {
    fg: colors.accent,
    attributes: TextAttributes.BOLD,
  },
  body: {
    fg: colors.text,
  },
  muted: {
    fg: colors.textMuted,
  },
  subtle: {
    fg: colors.textSubtle,
    attributes: TextAttributes.DIM,
  },
  label: {
    fg: colors.textMuted,
    attributes: TextAttributes.BOLD,
  },
  success: { fg: colors.success },
  warning: { fg: colors.warning },
  danger: { fg: colors.danger },
  info: { fg: colors.info },
} as const satisfies Record<string, TextVariantStyle>;

export type TextVariant = keyof typeof typography;

export function textVariant(variant: TextVariant): TextVariantStyle {
  return typography[variant];
}

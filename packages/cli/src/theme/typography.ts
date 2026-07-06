/**
 * Typography tokens.
 *
 * Terminals have no font sizes, so "type" here is expressed through OpenTUI
 * `TextAttributes` (bold/dim/italic/underline) combined with semantic color.
 * Each variant returns the props a `<text>` needs; spread it onto the element:
 *
 *   <text {...textVariant("heading")}>Code Pilot</text>
 *
 * Because color is theme-dependent, typography is derived from a color scheme
 * via {@link createTypography}. Components should get their `textVariant` from
 * `useTheme()` so the type recolors when the theme changes; the module-level
 * `typography`/`textVariant` exports are the default (Dark+) scheme, kept for
 * non-reactive callers.
 */

import { TextAttributes } from "@opentui/core";
import { colors as defaultColors } from "./colors";
import type { ColorScheme } from "./themes";

export interface TextVariantStyle {
  fg: string;
  attributes?: number;
}

export type Typography = Record<TextVariant, TextVariantStyle>;

/** A `(variant) => style` accessor bound to a specific typography set. */
export type TextVariantFn = (variant: TextVariant) => TextVariantStyle;

export type TextVariant =
  | "heading"
  | "title"
  | "body"
  | "muted"
  | "subtle"
  | "label"
  | "success"
  | "warning"
  | "danger"
  | "info";

/** Build the typography set for a given color scheme. */
export function createTypography(colors: ColorScheme): Typography {
  return {
    heading: { fg: colors.text, attributes: TextAttributes.BOLD },
    title: { fg: colors.accent, attributes: TextAttributes.BOLD },
    body: { fg: colors.text },
    muted: { fg: colors.textMuted },
    subtle: { fg: colors.textSubtle, attributes: TextAttributes.DIM },
    label: { fg: colors.textMuted, attributes: TextAttributes.BOLD },
    success: { fg: colors.success },
    warning: { fg: colors.warning },
    danger: { fg: colors.danger },
    info: { fg: colors.info },
  };
}

/** Build a `textVariant` accessor for a given color scheme. */
export function createTextVariant(colors: ColorScheme): TextVariantFn {
  const typography = createTypography(colors);
  return (variant) => typography[variant];
}

/** Default (Dark+) typography, for module-level / non-reactive callers. */
export const typography = createTypography(defaultColors);

/** Default (Dark+) `textVariant`, for module-level / non-reactive callers. */
export function textVariant(variant: TextVariant): TextVariantStyle {
  return typography[variant];
}

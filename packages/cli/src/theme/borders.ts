/**
 * Border tokens.
 *
 * OpenTUI supports the box-drawing styles "single" | "double" | "rounded" |
 * "heavy". These semantic aliases keep component intent readable.
 */

import type { BorderStyle } from "@opentui/core";

export const borders = {
  none: "single" as BorderStyle, // pair with `border={false}` to hide
  default: "rounded" as BorderStyle,
  strong: "heavy" as BorderStyle,
  emphasis: "double" as BorderStyle,
} satisfies Record<string, BorderStyle>;

export type BorderToken = keyof typeof borders;

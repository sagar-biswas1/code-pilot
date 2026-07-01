/**
 * Spacing scale (in terminal cells).
 *
 * Terminal cells are coarse, so the scale stays small and integer-only. Use
 * these tokens for `padding*`, `margin*`, and `gap` instead of raw numbers so
 * rhythm stays consistent across components.
 */

export const spacing = {
  none: 0,
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const;

export type SpacingToken = keyof typeof spacing;

/**
 * Composed theme object.
 *
 * Aggregates every token group into one `theme` for ergonomic access
 * (`theme.colors.accent`, `theme.spacing.md`, ...). Import individual token
 * modules directly when you only need one group.
 */

import { colors, palette } from "./colors";
import { spacing } from "./spacing";
import { borders } from "./borders";
import { typography } from "./typography";

export const theme = {
  colors,
  palette,
  spacing,
  borders,
  typography,
} as const;

export type Theme = typeof theme;

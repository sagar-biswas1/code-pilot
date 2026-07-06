/**
 * Code Pilot design system — public entry point.
 *
 * Import tokens and the composed theme from here:
 *
 *   import { theme, colors, spacing, textVariant } from "../theme";
 */

export { colors, palette } from "./colors";
export type { ColorToken, PaletteToken } from "./colors";

export { spacing } from "./spacing";
export type { SpacingToken } from "./spacing";

export { borders } from "./borders";
export type { BorderToken } from "./borders";

export {
  typography,
  textVariant,
  createTypography,
  createTextVariant,
} from "./typography";
export type {
  TextVariant,
  TextVariantStyle,
  TextVariantFn,
  Typography,
} from "./typography";

export {
  THEMES,
  DEFAULT_THEME_ID,
  getThemeById,
} from "./themes";
export type { ColorScheme, ThemeDefinition } from "./themes";

export { theme } from "./theme";
export type { Theme } from "./theme";

/**
 * Color tokens for the Code Pilot design system.
 *
 * `palette` holds the raw, context-free color ramp. Prefer the semantic
 * `colors` tokens in components so the intent (not the hex) drives the UI and
 * theming stays centralized. OpenTUI accepts hex strings anywhere a color is
 * expected (`fg`, `bg`, `backgroundColor`, `borderColor`).
 */

export const palette = {
  transparent: "transparent",

  // Neutrals (dark theme)
  black: "#0B0D12",
  gray900: "#11141B",
  gray800: "#181C25",
  gray700: "#222634",
  gray600: "#2E3444",
  gray500: "#3D4456",
  gray400: "#565E73",
  gray300: "#8A93A3",
  gray200: "#A2AAB8",
  gray100: "#C9CFDA",
  white: "#F5F7FB",

  // Brand (purple — matches the existing Header accent)
  brand500: "#7C3AED",
  brand400: "#8B5CF6",
  brand300: "#A78BFA",

  // Status
  green: "#22C55E",
  yellow: "#EAB308",
  red: "#EF4444",
  blue: "#3B82F6",
} as const;

export const colors = {
  // Surfaces
  background: palette.black,
  surface: palette.gray900,
  surfaceRaised: palette.gray800,
  overlay: palette.gray700,

  // Borders
  border: palette.gray600,
  borderStrong: palette.gray500,
  borderAccent: palette.brand500,

  // Text
  text: palette.white,
  textMuted: palette.gray200,
  textSubtle: palette.gray400,
  textInverse: palette.black,

  // Brand / accent
  accent: palette.brand500,
  accentHover: palette.brand400,
  accentSubtle: palette.brand300,

  // Status
  success: palette.green,
  warning: palette.yellow,
  danger: palette.red,
  info: palette.blue,
} as const;

export type PaletteToken = keyof typeof palette;
export type ColorToken = keyof typeof colors;

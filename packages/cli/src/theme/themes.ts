/**
 * Named color themes for the Code Pilot design system.
 *
 * Each theme supplies a full set of semantic {@link ColorScheme} tokens (the
 * same shape as the default `colors` object). Only colors vary between themes;
 * structural tokens (`spacing`, `borders`) are theme-independent and live in
 * their own modules.
 *
 * The palette is intentionally VS Code-flavored so the built-in themes feel
 * familiar (Dark+, Light+, Monokai, Dracula, Nord, ...). Add a new theme by
 * appending an entry to {@link THEMES}; the theme picker and provider pick it
 * up automatically.
 */

/** The semantic color tokens every theme must provide. */
export type ColorScheme = {
  // Surfaces
  background: string;
  surface: string;
  surfaceRaised: string;
  overlay: string;

  // Borders
  border: string;
  borderStrong: string;
  borderAccent: string;

  // Text
  text: string;
  textMuted: string;
  textSubtle: string;
  textInverse: string;

  // Brand / accent
  accent: string;
  accentHover: string;
  accentSubtle: string;

  // Status
  success: string;
  warning: string;
  danger: string;
  info: string;
};

/** A selectable theme: a stable id, a human label, and its color scheme. */
export type ThemeDefinition = {
  /** Stable identifier used for selection/persistence (e.g. "dracula"). */
  id: string;
  /** Human-readable name shown in the picker (e.g. "Dracula"). */
  label: string;
  /** Whether the scheme reads as a dark theme (used for the picker hint). */
  isDark: boolean;
  /** The semantic color tokens for this theme. */
  colors: ColorScheme;
};

const darkPlus: ColorScheme = {
  background: "#0B0D12",
  surface: "#11141B",
  surfaceRaised: "#181C25",
  overlay: "#222634",
  border: "#2E3444",
  borderStrong: "#3D4456",
  borderAccent: "#7C3AED",
  text: "#F5F7FB",
  textMuted: "#A2AAB8",
  textSubtle: "#565E73",
  textInverse: "#0B0D12",
  accent: "#7C3AED",
  accentHover: "#8B5CF6",
  accentSubtle: "#A78BFA",
  success: "#22C55E",
  warning: "#EAB308",
  danger: "#EF4444",
  info: "#3B82F6",
};

const lightPlus: ColorScheme = {
  background: "#FFFFFF",
  surface: "#F3F3F3",
  surfaceRaised: "#E8E8E8",
  overlay: "#DDDDDD",
  border: "#C8C8C8",
  borderStrong: "#A0A0A0",
  borderAccent: "#0066B8",
  text: "#1E1E1E",
  textMuted: "#3B3B3B",
  textSubtle: "#6C6C6C",
  textInverse: "#FFFFFF",
  accent: "#0066B8",
  accentHover: "#1177BB",
  accentSubtle: "#3794FF",
  success: "#107C10",
  warning: "#BF8803",
  danger: "#CD3131",
  info: "#0066B8",
};

const monokai: ColorScheme = {
  background: "#272822",
  surface: "#2D2E27",
  surfaceRaised: "#34352E",
  overlay: "#3E3D32",
  border: "#49483E",
  borderStrong: "#75715E",
  borderAccent: "#A6E22E",
  text: "#F8F8F2",
  textMuted: "#CFCFC2",
  textSubtle: "#75715E",
  textInverse: "#272822",
  accent: "#A6E22E",
  accentHover: "#B6F23E",
  accentSubtle: "#E6DB74",
  success: "#A6E22E",
  warning: "#E6DB74",
  danger: "#F92672",
  info: "#66D9EF",
};

const dracula: ColorScheme = {
  background: "#282A36",
  surface: "#2E303E",
  surfaceRaised: "#343746",
  overlay: "#44475A",
  border: "#44475A",
  borderStrong: "#6272A4",
  borderAccent: "#BD93F9",
  text: "#F8F8F2",
  textMuted: "#C7C9D9",
  textSubtle: "#6272A4",
  textInverse: "#282A36",
  accent: "#BD93F9",
  accentHover: "#CBA6FA",
  accentSubtle: "#FF79C6",
  success: "#50FA7B",
  warning: "#F1FA8C",
  danger: "#FF5555",
  info: "#8BE9FD",
};

const nord: ColorScheme = {
  background: "#2E3440",
  surface: "#333B4C",
  surfaceRaised: "#3B4252",
  overlay: "#434C5E",
  border: "#434C5E",
  borderStrong: "#4C566A",
  borderAccent: "#88C0D0",
  text: "#ECEFF4",
  textMuted: "#D8DEE9",
  textSubtle: "#7A879C",
  textInverse: "#2E3440",
  accent: "#88C0D0",
  accentHover: "#8FBCBB",
  accentSubtle: "#81A1C1",
  success: "#A3BE8C",
  warning: "#EBCB8B",
  danger: "#BF616A",
  info: "#5E81AC",
};

const oneDarkPro: ColorScheme = {
  background: "#282C34",
  surface: "#2C313A",
  surfaceRaised: "#333842",
  overlay: "#3B4048",
  border: "#3E4451",
  borderStrong: "#4B5263",
  borderAccent: "#61AFEF",
  text: "#ABB2BF",
  textMuted: "#9DA5B4",
  textSubtle: "#5C6370",
  textInverse: "#282C34",
  accent: "#61AFEF",
  accentHover: "#73BCF5",
  accentSubtle: "#C678DD",
  success: "#98C379",
  warning: "#E5C07B",
  danger: "#E06C75",
  info: "#56B6C2",
};

const githubDark: ColorScheme = {
  background: "#0D1117",
  surface: "#12181F",
  surfaceRaised: "#161B22",
  overlay: "#21262D",
  border: "#30363D",
  borderStrong: "#484F58",
  borderAccent: "#58A6FF",
  text: "#C9D1D9",
  textMuted: "#B1BAC4",
  textSubtle: "#6E7681",
  textInverse: "#0D1117",
  accent: "#58A6FF",
  accentHover: "#79C0FF",
  accentSubtle: "#A5D6FF",
  success: "#3FB950",
  warning: "#D29922",
  danger: "#F85149",
  info: "#58A6FF",
};

const solarizedDark: ColorScheme = {
  background: "#002B36",
  surface: "#04303B",
  surfaceRaised: "#073642",
  overlay: "#0A414E",
  border: "#0A414E",
  borderStrong: "#586E75",
  borderAccent: "#268BD2",
  text: "#EEE8D5",
  textMuted: "#93A1A1",
  textSubtle: "#657B83",
  textInverse: "#002B36",
  accent: "#268BD2",
  accentHover: "#2AA198",
  accentSubtle: "#6C71C4",
  success: "#859900",
  warning: "#B58900",
  danger: "#DC322F",
  info: "#268BD2",
};

const solarizedLight: ColorScheme = {
  background: "#FDF6E3",
  surface: "#F4EDD9",
  surfaceRaised: "#EEE8D5",
  overlay: "#E3DCC7",
  border: "#D9D2BD",
  borderStrong: "#93A1A1",
  borderAccent: "#268BD2",
  text: "#586E75",
  textMuted: "#657B83",
  textSubtle: "#93A1A1",
  textInverse: "#FDF6E3",
  accent: "#268BD2",
  accentHover: "#2AA198",
  accentSubtle: "#6C71C4",
  success: "#859900",
  warning: "#B58900",
  danger: "#DC322F",
  info: "#268BD2",
};

const gruvboxDark: ColorScheme = {
  background: "#1D2021",
  surface: "#282828",
  surfaceRaised: "#32302F",
  overlay: "#3C3836",
  border: "#3C3836",
  borderStrong: "#504945",
  borderAccent: "#FE8019",
  text: "#EBDBB2",
  textMuted: "#D5C4A1",
  textSubtle: "#928374",
  textInverse: "#1D2021",
  accent: "#FE8019",
  accentHover: "#FD9843",
  accentSubtle: "#FABD2F",
  success: "#B8BB26",
  warning: "#FABD2F",
  danger: "#FB4934",
  info: "#83A598",
};

const tokyoNight: ColorScheme = {
  background: "#1A1B26",
  surface: "#1E202E",
  surfaceRaised: "#24283B",
  overlay: "#2A2E42",
  border: "#2F334D",
  borderStrong: "#414868",
  borderAccent: "#7AA2F7",
  text: "#C0CAF5",
  textMuted: "#A9B1D6",
  textSubtle: "#565F89",
  textInverse: "#1A1B26",
  accent: "#7AA2F7",
  accentHover: "#8DB0F8",
  accentSubtle: "#BB9AF7",
  success: "#9ECE6A",
  warning: "#E0AF68",
  danger: "#F7768E",
  info: "#7DCFFF",
};

/** All built-in themes, in the order shown by the picker. */
export const THEMES: ThemeDefinition[] = [
  { id: "dark-plus", label: "Dark+ (default)", isDark: true, colors: darkPlus },
  { id: "light-plus", label: "Light+", isDark: false, colors: lightPlus },
  { id: "monokai", label: "Monokai", isDark: true, colors: monokai },
  { id: "dracula", label: "Dracula", isDark: true, colors: dracula },
  { id: "nord", label: "Nord", isDark: true, colors: nord },
  { id: "one-dark-pro", label: "One Dark Pro", isDark: true, colors: oneDarkPro },
  { id: "github-dark", label: "GitHub Dark", isDark: true, colors: githubDark },
  { id: "solarized-dark", label: "Solarized Dark", isDark: true, colors: solarizedDark },
  { id: "solarized-light", label: "Solarized Light", isDark: false, colors: solarizedLight },
  { id: "gruvbox-dark", label: "Gruvbox Dark", isDark: true, colors: gruvboxDark },
  { id: "tokyo-night", label: "Tokyo Night", isDark: true, colors: tokyoNight },
];

/** The theme selected on first launch. */
export const DEFAULT_THEME_ID = "dark-plus";

/** Look up a theme by id, falling back to the default. */
export function getThemeById(id: string): ThemeDefinition {
  return (
    THEMES.find((theme) => theme.id === id) ??
    THEMES.find((theme) => theme.id === DEFAULT_THEME_ID) ??
    THEMES[0]!
  );
}

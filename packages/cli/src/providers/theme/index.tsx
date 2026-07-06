/**
 * Theme provider.
 *
 * Holds the active color theme and exposes it (plus a `setTheme` setter) to the
 * whole app. Components read colors and typography from `useTheme()` instead of
 * importing the static tokens directly, so switching themes recolors the UI
 * live:
 *
 *   const { colors, textVariant, setTheme, themes, themeId } = useTheme();
 *   <text {...textVariant("title")}>Hi</text>
 *   setTheme("dracula");
 *
 * `setTheme` is used both for committing a choice and for previewing one while
 * the user browses the theme picker. Because this drives every color in the
 * app, `ThemeProvider` must sit at (or near) the top of the provider tree,
 * above anything that renders colored UI (toasts, dialogs, the app content).
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  DEFAULT_THEME_ID,
  THEMES,
  getThemeById,
  createTextVariant,
  type ColorScheme,
  type ThemeDefinition,
  type TextVariantFn,
} from "../../theme";
import { loadConfig, saveConfig } from "../../config";

export type ThemeContextValue = {
  /** Id of the active theme (e.g. "dracula"). */
  themeId: string;
  /** The active theme's semantic color tokens. */
  colors: ColorScheme;
  /** `textVariant` accessor bound to the active theme's colors. */
  textVariant: TextVariantFn;
  /** Every selectable theme, in picker order. */
  themes: ThemeDefinition[];
  /** Commit a theme by id — applies it and persists the choice to disk. */
  setTheme: (id: string) => void;
  /** Apply a theme in-memory only (for live preview); does not persist. */
  previewTheme: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialThemeId,
}: {
  children: React.ReactNode;
  /**
   * Theme to start on. When omitted, the last persisted theme is loaded from
   * disk, falling back to Dark+.
   */
  initialThemeId?: string;
}) {
  // Lazy initializer: resolve the starting theme once (prop → saved → default).
  const [themeId, setThemeId] = useState(() =>
    getThemeById(initialThemeId ?? loadConfig().themeId ?? DEFAULT_THEME_ID).id,
  );

  const previewTheme = useCallback((id: string) => {
    setThemeId(getThemeById(id).id);
  }, []);

  const setTheme = useCallback((id: string) => {
    const resolved = getThemeById(id).id;
    setThemeId(resolved);
    saveConfig({ themeId: resolved });
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const colors = getThemeById(themeId).colors;
    return {
      themeId,
      colors,
      textVariant: createTextVariant(colors),
      themes: THEMES,
      setTheme,
      previewTheme,
    };
  }, [themeId, setTheme, previewTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Access the active theme. Must be called within a `ThemeProvider`; throws
 * otherwise so misuse fails loudly during development.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

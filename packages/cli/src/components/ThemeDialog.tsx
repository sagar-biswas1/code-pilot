/**
 * Theme picker dialog body.
 *
 * Rendered inside the app dialog (opened by the `/theme` command). Presents a
 * searchable list of every built-in theme and applies the highlighted one
 * live — exactly like VS Code's theme quick-pick. Confirming (Enter/click)
 * commits the choice; dismissing the dialog (Escape/backdrop) reverts to
 * whatever theme was active when the picker opened.
 */

import { useCallback, useEffect, useRef } from "react";
import { DialogSearchList } from "./DialogSearchList";
import { useTheme } from "../providers/theme";
import { useDialog } from "../providers/dialog";
import { useToast } from "../providers/toast";
import type { ThemeDefinition } from "../theme";

export function ThemeDialog() {
  const { themeId, themes, setTheme, previewTheme } = useTheme();
  const dialog = useDialog();
  const toast = useToast();

  // The theme active when the picker opened — restored if the user cancels.
  const originalThemeId = useRef(themeId).current;
  // Set once the user confirms a choice, so the cancel-revert is skipped.
  const committedRef = useRef(false);

  // On unmount (Escape/backdrop close without a commit), revert the preview.
  // `previewTheme` (not `setTheme`) so a cancelled preview is never persisted.
  useEffect(() => {
    return () => {
      if (!committedRef.current) {
        previewTheme(originalThemeId);
      }
    };
  }, [originalThemeId, previewTheme]);

  const handleHighlight = useCallback(
    (theme: ThemeDefinition) => {
      // Live-preview the highlighted theme in-memory (not persisted until the
      // user confirms).
      previewTheme(theme.id);
    },
    [previewTheme],
  );

  const handleSelect = useCallback(
    (theme: ThemeDefinition) => {
      committedRef.current = true;
      setTheme(theme.id);
      dialog.close();
      toast.show({ variant: "success", message: `Theme: ${theme.label}` });
    },
    [setTheme, dialog, toast],
  );

  const renderItem = useCallback(
    (theme: ThemeDefinition) => {
      const marker = theme.id === themeId ? "●" : " ";
      const hint = theme.isDark ? "dark" : "light";
      return `${marker} ${theme.label}  (${hint})`;
    },
    [themeId],
  );

  return (
    <DialogSearchList
      items={themes}
      getKey={(theme) => theme.id}
      renderItem={renderItem}
      onHighlight={handleHighlight}
      onSelect={handleSelect}
      filterFn={(theme, query) =>
        theme.label.toLowerCase().includes(query.toLowerCase()) ||
        theme.id.toLowerCase().includes(query.toLowerCase())
      }
      Placeholder="Search themes…"
      emptyText="No themes found"
    />
  );
}

/**
 * Dialog (modal) provider.
 *
 * Renders a single, app-wide modal on top of everything else. Any component
 * below the provider can open a dialog imperatively:
 *
 *   const dialog = useDialog();
 *   dialog.open({ title: "Select model", children: <text>…</text> });
 *   dialog.close();
 *
 * Only one dialog is shown at a time — calling `open` again replaces the
 * current content. The dialog participates in the keyboard-layer stack so
 * Escape (and the backdrop click) reliably closes it without leaking key
 * events to the components underneath.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { DialogProps as DialogContentProps  } from "./types";
import { useKeyboardLayer } from "../keyboardLayer";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { borders, spacing } from "../../theme";
import { useTheme } from "../theme";

export type DialogContextValue = {
  /** Show a dialog (replaces any dialog already open). */
  open: (props: DialogContentProps) => void;
  /** Dismiss the current dialog, if any. */
  close: () => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

/**
 * Access the dialog controls. Must be called from within a `DialogProvider`;
 * throws otherwise so misuse fails loudly during development.
 */
export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return context;
}

/**
 * Wraps the app, provides the `useDialog` context, and mounts the single
 * `Dialog` overlay whenever content is set.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [currentDialog, setCurrentDialog] = useState<DialogContentProps | null>(null);
  const { push, pop } = useKeyboardLayer();

  const open = useCallback(
    (props: DialogContentProps) => {
      setCurrentDialog(props);
      // Become the top keyboard layer so Escape maps to `close` and lower
      // layers stop receiving key events while the dialog is open.
      push("dialog", () => {
        close();
        return true;
      });
    },
    [push, setCurrentDialog],
  );
  const close = useCallback(() => {
    setCurrentDialog(null);
    pop("dialog");
  }, [pop, setCurrentDialog]);

  return (
    <DialogContext.Provider value={{ open, close }}>
      {children}
      {currentDialog && (
        <Dialog currentDialogContent={currentDialog} close={close} />
      )}
    </DialogContext.Provider>
  );
}

type DialogContent = {
  currentDialogContent: DialogContentProps | null;
  close: () => void;
};

/**
 * The modal surface: a full-screen backdrop that centers a bordered card.
 *
 * Layout mirrors the design system — `colors.surface` card with a
 * `borders.default` frame, a header row (title + `esc ✕` close hint) and the
 * caller-supplied `children` below.
 */
function Dialog({ currentDialogContent, close }: DialogContent) {
  const { isTopLayer } = useKeyboardLayer();
  const dimensions = useTerminalDimensions();
  const { colors, textVariant } = useTheme();

  // Close on Escape, but only while this dialog owns the top keyboard layer so
  // we don't steal the key from a nested overlay.
  useKeyboard((key) => {
    if (!currentDialogContent || !isTopLayer("dialog")) return;
    if (key.name === "escape") {
      close();
      return true;
    }
    return false;
  });
  const { title, children } = currentDialogContent || {};
  return (
    // Full-screen backdrop — clicking it (outside the card) dismisses.
    <box
      position="absolute"
      top={0}
      left={0}
      width={dimensions.width}
      height={dimensions.height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      zIndex={100}
      onMouseDown={close}
    >
      <box
        width={Math.max(20, Math.min(60, dimensions.width - spacing.lg))}
        height="auto"
        flexDirection="column"
        gap={spacing.sm}
        paddingLeft={spacing.md}
        paddingRight={spacing.md}
        paddingTop={spacing.sm}
        paddingBottom={spacing.sm}
        backgroundColor={colors.surface}
        borderStyle={borders.default}
        borderColor={colors.border}
        // Swallow clicks so interacting with the card doesn't hit the backdrop.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header: title on the left, close affordance on the right. */}
        <box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={spacing.sm}
        >
          <text {...textVariant("title")}>{title}</text>
          <text {...textVariant("subtle")} onMouseDown={close}>
            esc ✕
          </text>
        </box>
        {/* Caller-supplied body. */}
        <box flexDirection="column" gap={spacing.sm}>
          {children}
        </box>
      </box>
    </box>
  );
}

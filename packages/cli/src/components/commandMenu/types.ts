import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { ToastProps } from "../../providers/toast/types";

/**
 * Capabilities handed to a command's `action`, so commands can affect the app
 * (quit, show a toast, open a dialog) without importing UI state directly.
 */
export type CommandContext = {
  /** Tear down the renderer and exit the process. */
  exit: () => void;
  /** Show a transient toast notification. */
  toast: ToastContextValue;
  /** Open a modal dialog. */
  dialog: DialogContextValue;
};

/** A single slash-command entry in the command menu. */
export type Command = {
  /** Short name matched against the user's query (e.g. "model"). */
  name: string;
  /** One-line description shown next to the name. */
  description: string;
  /** Canonical slash form (e.g. "/model"). */
  value: string;
  /** Runs when the command is selected; omit for not-yet-wired commands. */
  action?: (ctx: CommandContext) => void;
};

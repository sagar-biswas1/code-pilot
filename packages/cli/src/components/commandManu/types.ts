import type { ToastContextValue } from "../../providers/toast";
import type { ToastProps } from "../../providers/toast/types";

export type CommandContext = {
  exit: () => void;
  toast: ToastContextValue;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  action?: (ctx: CommandContext) => void;
};

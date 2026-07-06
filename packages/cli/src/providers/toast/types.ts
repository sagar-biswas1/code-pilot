/** Toast severity; drives the accent color and leading icon. */
export type ToastVariant = "success" | "error" | "warning" | "info";

/** How long a toast stays on screen when no explicit duration is given (ms). */
export const DEFAULT_TOAST_DURATION = 3000;

/** Content passed to `toast.show(...)`. */
export interface ToastProps {
  /** Severity; defaults to "info". */
  variant?: ToastVariant;
  /** The message to display. */
  message: string;
  /** Auto-dismiss delay in ms; defaults to {@link DEFAULT_TOAST_DURATION}. */
  duration?: number;
}

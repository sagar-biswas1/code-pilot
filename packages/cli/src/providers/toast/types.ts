export type ToastVariant = "success" | "error" | "warning" | "info";

export const DEFAULT_TOAST_DURATION = 3000;

export interface ToastProps {
  variant?: ToastVariant;
  message: string;
  duration?: number;
}

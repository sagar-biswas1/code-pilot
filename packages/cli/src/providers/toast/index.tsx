import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTerminalDimensions } from "@opentui/react";
import {
  DEFAULT_TOAST_DURATION,
  type ToastProps,
  type ToastVariant,
} from "./types";
import { borders, spacing, type TextVariant } from "../../theme";
import { useTheme } from "../theme";

export type ToastContextValue = {
  show: (props: ToastProps) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentToast, setCurrentToast] = useState<ToastProps | null>(null);
  const timeoutHandleRef = useRef<NodeJS.Timeout | null>(null);

  const clearCurrentTimeout = useCallback(() => {
    if (timeoutHandleRef.current) {
      clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }
  }, []);

  const show = useCallback(
    (props: ToastProps) => {
      const duration = props.duration ?? DEFAULT_TOAST_DURATION;
      clearCurrentTimeout();
      setCurrentToast({
        variant: props.variant ?? "info",
        message: props.message,
        duration,
      });
      timeoutHandleRef.current = setTimeout(() => {
        setCurrentToast(null);
        timeoutHandleRef.current = null;
      }, duration).unref();
    },
    [clearCurrentTimeout],
  );

  // Clean up any pending timer when the provider unmounts.
  useEffect(() => clearCurrentTimeout, [clearCurrentTimeout]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <Toast currentToast={currentToast} />
    </ToastContext.Provider>
  );
};

/** Maps each variant to its leading glyph and text/color token. */
const VARIANT_META: Record<
  ToastVariant,
  { colorToken: "info" | "success" | "warning" | "danger"; icon: string; textVariant: TextVariant }
> = {
  info: { colorToken: "info", icon: "ℹ", textVariant: "info" },
  success: { colorToken: "success", icon: "✔", textVariant: "success" },
  warning: { colorToken: "warning", icon: "⚠", textVariant: "warning" },
  error: { colorToken: "danger", icon: "✖", textVariant: "danger" },
};

function Toast({ currentToast }: { currentToast: ToastProps | null }) {
  const { width } = useTerminalDimensions();
  const { colors, textVariant } = useTheme();

  if (!currentToast) return null;

  const variant = currentToast.variant ?? "info";
  const meta = VARIANT_META[variant];
  const color = colors[meta.colorToken];

  return (
    <box
      position="absolute"
      top={spacing.sm}
      left={spacing.sm}
      maxWidth={Math.max(20, Math.min(48, width - spacing.lg))}
      flexDirection="row"
      alignItems="center"
      gap={spacing.sm}
      paddingLeft={spacing.sm}
      paddingRight={spacing.sm}
      paddingTop={spacing.xs}
      paddingBottom={spacing.xs}
    
      borderStyle={borders.default}
      borderColor={color}
    >
      <text fg={color}>{meta.icon}</text>
      <text {...textVariant("body")} wrapMode="word" width="100%">
        {currentToast.message}
      </text>
    </box>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

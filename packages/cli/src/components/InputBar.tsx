import { useRef } from "react";
import type {
  KeyBinding as TextareaKeyBinding,
  TextareaRenderable,
} from "@opentui/core";
import { borders, colors, spacing } from "../theme";

/**
 * Ctrl+A defaults to "line-home" (emacs style); select-all is only on super+A
 * (Cmd/Win), which terminals usually swallow. Remap Ctrl+A to select-all.
 */
const KEY_BINDINGS: TextareaKeyBinding[] = [
  { name: "a", ctrl: true, action: "select-all" },
];
import { StatusBar } from "./StatusBar";

export interface InputBarProps {
  /** Placeholder shown when the input is empty. */
  placeholder?: string;
  /** Called with the trimmed value when the user submits. */
  onSubmit?: (value: string) => void;
  /** Whether the input owns the keyboard focus. */
  focused?: boolean;
}

/**
 * Multi-line prompt input for the CLI. The textarea owns its own buffer; on
 * submit we read the text via the ref, hand it off, and clear the field.
 * Empty/whitespace-only entries are ignored.
 */
export function InputBar({
  placeholder = "❯ Ask Code Pilot anything…",
  onSubmit,
  focused = true,
}: InputBarProps) {
  const ref = useRef<TextareaRenderable>(null);

  function handleSubmit() {
    const trimmed = ref.current?.plainText.trim() ?? "";
    if (!trimmed) return;
    onSubmit?.(trimmed);
    ref.current?.clear();
  }

  return (
    <box
      flexDirection="column"
      alignItems="flex-start"
      gap={spacing.xs}
      paddingLeft={spacing.sm}
      paddingRight={spacing.sm}
      borderStyle={borders.default}
      borderColor={focused ? colors.borderAccent : colors.border}
    >
      <textarea
        ref={ref}
        flexGrow={1}
        minHeight={1}
        focused={focused}
        placeholder={placeholder}
        placeholderColor={colors.textSubtle}
        textColor={colors.text}
        keyBindings={KEY_BINDINGS}
        onSubmit={handleSubmit}
      />

      <box width="100%" marginTop={spacing.xs}>
        <StatusBar
          message="Opus 4.8.1"
          hints={[
            { key: "↵", label: "send" },
            { key: "^C", label: "quit" },
          ]}
        />
      </box>
    </box>
  );
}

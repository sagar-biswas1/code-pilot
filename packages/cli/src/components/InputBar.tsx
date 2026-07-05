import { useCallback, useEffect, useRef } from "react";
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
  {
    name: "enter",
    action: "submit",
  },
  {
    name: "return",
    shift: true,
    action: "newline",
  },
  {
    name: "enter",
    shift: true,
    action: "newline",
  },
  {
    name: "backspace",
    action: "delete-word-backward",
  },
];
import { StatusBar } from "./StatusBar";
import { CommandMenu } from "./commandManu";
import { useRenderer } from "@opentui/react";
import { useCommandMenu } from "./commandManu/useCommandMenu";
import type { Command } from "./commandManu/types";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboardLayer";

export interface InputBarProps {
  /** Placeholder shown when the input is empty. */
  placeholder?: string;
  /** Called with the trimmed value when the user submits. */
  onSubmit?: (value: string) => void;
  /** Whether the input owns the keyboard focus. */
  focused?: boolean;
  /** Whether the input is disabled. */
  disabled?: boolean;
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
  disabled = false,
}: InputBarProps) {
  const textAreaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const renderer = useRenderer();
  const {
    showCommandMenu,
    CommandQuery,
    selectedIndex,
    scrollRef,
    handleConteChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();
  const toast = useToast();
  const { isTopLayer, setResponder } = useKeyboardLayer();
  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    textArea.onSubmit = () => {
      onSubmitRef.current();
    };
  }, []);

  onSubmitRef.current = () => {
    if (disabled) return;
    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      handleCommand(command);
      return;
    }
    handleSubmit();
  };

  const handleCommand = useCallback(
    (command: Command | void) => {
      const textarea = textAreaRef.current;
      if (!textarea || !command) return;
      textarea.setText("");

      if (command.action) {
        command.action({
          exit: () => {
            renderer.destroy();
            process.exit(0);
          },
          toast: toast,
        });
      }
    },
    [onSubmit],
  );

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const textarea = textAreaRef.current;
    if (!textarea) return;
    const text = textarea.plainText.trim();
    if (!text) return;
    onSubmit?.(text);
    textarea.setText("");
  }, [onSubmit, disabled]);

  const handleTextAreaContentChange = useCallback(() => {
    const textarea = textAreaRef.current;
    if (!textarea) return;

    handleConteChange(textarea.plainText);
  }, [handleConteChange]);

  const handleCommandExecute = useCallback((index: number) => {
    const command = resolveCommand(index);
    handleCommand(command);
  }, []);

  useEffect(() => {
    setResponder("base", () => {
      if (disabled) return false;
      const textarea = textAreaRef.current;

      if (textarea && textarea.plainText.length > 0) {
        textarea.setText("");
        return true;
      }
      return false;
    });

    return () => setResponder("base", null);
  }, [isTopLayer, setResponder]);
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
      {showCommandMenu && (
        <box position="absolute" top="-100%" width="100%" zIndex={1000}>
          <CommandMenu
            query={CommandQuery}
            selectedIndex={selectedIndex}
            scrollRef={scrollRef}
            onSelect={setSelectedIndex}
            onExecute={handleCommandExecute}
          />
        </box>
      )}
      <textarea
        ref={textAreaRef}
        flexGrow={1}
        minHeight={1}
        focused={focused && (isTopLayer("base") || isTopLayer("command"))}
        placeholder={placeholder}
        placeholderColor={colors.textSubtle}
        textColor={colors.text}
        keyBindings={KEY_BINDINGS}
        onContentChange={handleTextAreaContentChange}
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

/**
 * InputBar — the prompt input at the bottom of the screen.
 *
 * Wraps an OpenTUI textarea with custom key bindings, an inline slash-command
 * menu (via {@link useCommandMenu}), and a status bar. Submitting either runs
 * the selected command or forwards the text to `onSubmit`.
 */

import { useCallback, useEffect, useRef } from "react";
import type {
  KeyBinding as TextareaKeyBinding,
  TextareaRenderable,
} from "@opentui/core";
import { borders, spacing } from "../theme";

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
];
import { StatusBar } from "./StatusBar";
import { CommandMenu } from "./commandMenu";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCommandMenu } from "./commandMenu/useCommandMenu";
import type { Command } from "./commandMenu/types";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboardLayer";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { DEFAULT_CHAT_MODEL_ID } from "@codepilot/shared";
import { useNavigate } from "react-router";
import { usePromptConfig } from "../providers/promptConfig";

export interface InputBarProps {
  /** Placeholder shown when the input is empty. */
  placeholder?: string;
  /** Called with the trimmed value when the user submits. */
  onSubmit?: (value: string) => void;
  /** Whether the input owns the keyboard focus. */
  focused?: boolean;
  /** Whether the input is disabled. */
  disabled?: boolean;
  /** Model id shown in the status bar. */
  model?: string;
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
  model = DEFAULT_CHAT_MODEL_ID,
}: InputBarProps) {
  const { mode, toggleMode, setMode, setModel } = usePromptConfig();
  const textAreaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const renderer = useRenderer();
  const {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const { colors } = useTheme();
  const { isTopLayer, setResponder } = useKeyboardLayer();
  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    textArea.onSubmit = () => {
      onSubmitRef.current();
    };
  }, []);

  // On Enter: run the highlighted command if the menu is open, else submit.
  onSubmitRef.current = () => {
    if (disabled) return;
    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      handleCommand(command);
      return;
    }
    handleSubmit();
  };

  /** Clear the input and invoke a command's action with the app context. */
  const handleCommand = useCallback(
    (command: Command | undefined) => {
      const textarea = textAreaRef.current;
      if (!textarea || !command) return;
      // Clearing the buffer directly doesn't fire `onContentChange`, so the
      // menu's own view of the text has to be reset alongside it.
      textarea.setText("");
      handleContentChange("");

      command.action?.({
        exit: () => {
          renderer.destroy();
          process.exit(0);
        },
        navigate: (path) => navigate(path),
        toast,
        dialog,
        mode,
        setMode,
        setModel,
      });
    },
    [
      handleContentChange,
      renderer,
      navigate,
      toast,
      dialog,
      mode,
      setMode,
      setModel,
    ],
  );

  useKeyboard((key) => {
    if (disabled) return;
    if (!isTopLayer("base")) return;
    if (key.name === "tab") {
      key.preventDefault();
      toggleMode();
    }
  });

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

    handleContentChange(textarea.plainText);
  }, [handleContentChange]);

  // Empty deps here captured the *first* render's `resolveCommand`, which
  // closes over the unfiltered command list — so clicking a row after typing
  // a query ran whichever command sat at that index before filtering.
  const handleCommandExecute = useCallback(
    (index: number) => {
      handleCommand(resolveCommand(index));
    },
    [resolveCommand, handleCommand],
  );

  // Register the base-layer Ctrl+C responder: first press clears a non-empty
  // input (handled here); an empty input falls through so the app can quit.
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
            query={commandQuery}
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
          hints={[
            { key: "↵", label: "send" },
            { key: "^C", label: "quit" },
          ]}
        />
      </box>
    </box>
  );
}

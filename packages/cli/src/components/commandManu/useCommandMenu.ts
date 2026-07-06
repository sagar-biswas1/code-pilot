import type { ScrollBoxRenderable } from "@opentui/core";
import type { Command } from "./types";
import { useMemo, useRef, useState } from "react";
import { getFilteredCommands } from "./filterCommands";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../../providers/keyboardLayer";

/** State and handlers the InputBar needs to drive the command menu. */
type UseCommandMenuReturn = {
  /** Whether the menu is currently visible. */
  showCommandMenu: boolean;
  /** Current filter query (the text after the leading "/"). */
  CommandQuery: string;
  /** Index of the highlighted command. */
  selectedIndex: number;
  /** Ref to the menu's scroll container, used to keep the selection in view. */
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  /** Feed the textarea's content in; opens/closes the menu and filters it. */
  handleConteChange: (text: string) => void;
  /** Look up the command at an index and close the menu if one exists. */
  resolveCommand: (index: number) => Command | void;
  /** Move the highlight to a specific index. */
  setSelectedIndex: (index: number) => void;
};

/**
 * Owns the slash-command menu logic: it opens while the input starts with "/"
 * and has no space, filters as you type, and handles up/down/escape navigation
 * while it owns the top keyboard layer. Scrolling keeps the selected row
 * within the visible viewport.
 */
export function useCommandMenu(): UseCommandMenuReturn {
  const [textValue, setTextValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const commandQuery =
    showCommandMenu && textValue.startsWith("/") ? textValue.slice(1) : "";
  const { isTopLayer, push, pop } = useKeyboardLayer();

  const filteredCommands = useMemo(() => {
    return getFilteredCommands(commandQuery);
  }, [commandQuery]);

  // Hide the menu and relinquish the keyboard layer.
  const close = () => {
    setShowCommandMenu(false);
    pop("command");
  };

  const handleConteChange = (text: string) => {
    setTextValue(text);
    setSelectedIndex(0);
    const scrollBox = scrollRef.current;
    if (scrollBox) {
      scrollBox.scrollTo(0);
    }
    const prefix = text.startsWith("/") ? text.slice(1) : null;
    if (prefix !== null && !prefix.includes(" ")) {
      setShowCommandMenu(true);
      push("command", () => {
        close();
        return true;
      });
    } else {
      close();
    }
  };

  const resolveCommand = (index: number): Command | undefined => {
    const command = filteredCommands[index];
    if (command) {
      setShowCommandMenu(false);
      pop("command");
    }
    return command;
  };

  useKeyboard((key) => {
    if (!showCommandMenu || !isTopLayer("command")) return;
    if (key.name === "up") {
      setSelectedIndex((prev) => {
        const newIndex = Math.max(0, prev - 1);
        const scrollBox = scrollRef.current;
        if (scrollBox && newIndex < scrollBox.scrollTop) {
          scrollBox.scrollTo(newIndex);
        }
        return newIndex;
      });
    } else if (key.name === "down") {
      setSelectedIndex((prev) => {
        if (filteredCommands.length === 0) return 0;
        const newIndex = Math.min(filteredCommands.length - 1, prev + 1);
        const scrollBox = scrollRef.current;
        if (scrollBox) {
          const viewPortHeight = scrollBox.viewport.height;
          const visibleEnd = scrollBox.scrollTop + viewPortHeight - 1;
          if (newIndex > visibleEnd) {
            scrollBox.scrollTo(newIndex - viewPortHeight + 1);
          }
        }
        return newIndex;
      });
    } else if (key.name === "escape") {
      close();
    }
  });
  return {
    showCommandMenu,
    CommandQuery: commandQuery,
    selectedIndex,
    scrollRef,
    handleConteChange,
    resolveCommand,
    setSelectedIndex,
  };
}

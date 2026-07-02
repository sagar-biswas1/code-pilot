import type { ScrollBoxRenderable } from "@opentui/core";
import type { Command } from "./types";
import { useMemo, useRef, useState } from "react";
import { getFilteredCommands } from "./filterCommands";
import { useKeyboard } from "@opentui/react";

type UseCommandMenuReturn = {
  showCommandMenu: boolean;
  CommandQuery: string;
  selectedIndex: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  handleConteChange: (text: string) => void;
  resolveCommand: (index: number) => Command | void;
  setSelectedIndex: (index: number) => void;
};

export function useCommandMenu(): UseCommandMenuReturn {
  const [textValue, setTextValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const commandQuery =
    showCommandMenu && textValue.startsWith("/") ? textValue.slice(1) : "";

  const filteredCommands = useMemo(() => {
    return getFilteredCommands(commandQuery);
  }, [commandQuery]);

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
    } else {
      setShowCommandMenu(false);
    }
  };

  const resolveCommand = (index: number): Command | undefined => {
    const command = filteredCommands[index];
    if (command) {
      setShowCommandMenu(false);
    }
    return command;
  };

  useKeyboard((key) => {
    if (!showCommandMenu) return;
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
      setShowCommandMenu(false);
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

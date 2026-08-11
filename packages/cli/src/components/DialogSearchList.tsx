/**
 * Searchable, keyboard-driven list for use inside a dialog.
 *
 * Owns a text input and a scrolling list of `items`, and reports the
 * highlighted item (`onHighlight`, used for live preview) separately from the
 * chosen one (`onSelect`). Only acts on keys while the dialog owns the top
 * keyboard layer.
 */

import {
  TextAttributes,
  type InputRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboardLayer } from "../providers/keyboardLayer";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../providers/theme";

const MAX_VISIBLE_ITEMS = 6;

type DialogSearchListProps<T> = {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  onHighlight: (item: T) => void;
  filterFn: (item: T, query: string) => boolean;
  getKey: (item: T) => string;
  placeholder?: string;
  emptyText?: string;
};

export function DialogSearchList<T>({
  items,
  renderItem,
  onSelect,
  onHighlight,
  filterFn,
  getKey,
  placeholder = "Search",
  emptyText = "No results found",
}: DialogSearchListProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const filtered = useMemo(
    () =>
      searchValue.length > 0
        ? items.filter((item) => filterFn(item, searchValue))
        : items,
    [items, searchValue, filterFn],
  );

  // Typing shrinks the list, which can strand the highlight past the end —
  // Enter would then resolve to `undefined` and silently do nothing.
  useEffect(() => {
    setSelectedIndex((prev) =>
      prev > filtered.length - 1 ? Math.max(0, filtered.length - 1) : prev,
    );
  }, [filtered]);

  const handleContentChange = useCallback(() => {
    setSearchValue(inputRef.current?.value ?? "");
    setSelectedIndex(0);
    scrollRef.current?.scrollTo(0);
  }, []);

  /** Move the highlight, keep it in view, and report the new item. */
  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      setSelectedIndex((prev) => {
        if (filtered.length === 0) return 0;

        const newIndex = Math.min(
          filtered.length - 1,
          Math.max(0, prev + delta),
        );
        const scrollBox = scrollRef.current;
        if (scrollBox) {
          const viewportHeight = scrollBox.viewport.height;
          if (newIndex < scrollBox.scrollTop) {
            scrollBox.scrollTo(newIndex);
          } else if (newIndex > scrollBox.scrollTop + viewportHeight - 1) {
            scrollBox.scrollTo(newIndex - viewportHeight + 1);
          }
        }

        const item = filtered[newIndex];
        if (item) onHighlight(item);
        return newIndex;
      });
    },
    [filtered, onHighlight],
  );

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "return" || key.name === "enter") {
      const item = filtered[selectedIndex];
      if (!item) return;
      // Without this the focused <input> also handles the key.
      key.preventDefault();
      onSelect(item);
    } else if (key.name === "up") {
      key.preventDefault();
      moveSelection(-1);
    } else if (key.name === "down") {
      key.preventDefault();
      moveSelection(1);
    }
  });

  const visibleHeight = Math.min(MAX_VISIBLE_ITEMS, filtered.length);

  return (
    <box flexDirection="column" gap={1}>
      <input
        ref={inputRef}
        focused
        onChange={handleContentChange}
        placeholder={placeholder}
      />

      {filtered.length === 0 ? (
        <text attributes={TextAttributes.DIM}>{emptyText}</text>
      ) : (
        <scrollbox ref={scrollRef} height={visibleHeight}>
          {filtered.map((item, index) => {
            const isSelected = selectedIndex === index;
            return (
              <box
                key={getKey(item)}
                flexDirection="row"
                height={1}
                overflow="hidden"
                backgroundColor={isSelected ? colors.info : undefined}
                onMouseMove={() => {
                  setSelectedIndex(index);
                  onHighlight(item);
                }}
                onMouseDown={() => onSelect(item)}
              >
                <text
                  attributes={
                    isSelected ? TextAttributes.BOLD : TextAttributes.NONE
                  }
                >
                  {renderItem(item)}
                </text>
              </box>
            );
          })}
        </scrollbox>
      )}
    </box>
  );
}

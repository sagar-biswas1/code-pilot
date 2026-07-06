import { TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { useCallback, useRef, useState } from "react";
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
  Placeholder?: string;
  emptyText?: string;
};

export function DialogSearchList<T>({
  items,
  renderItem,
  onSelect,
  onHighlight,
  filterFn,
  getKey,
  Placeholder = "Search",
  emptyText = "No results found",
}: DialogSearchListProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const handleContentChange = useCallback(() => {
    const text = inputRef.current?.value || "";
    setSearchValue(text);
    setSelectedIndex(0);
    const scrollBox = scrollRef.current;
    if (scrollBox) {
      scrollBox.scrollTo(0);
    }
  }, []);

  const filtered =
    searchValue.length > 0
      ? items.filter((item) => filterFn(item, searchValue))
      : items;

  const visibleHeight = Math.min(MAX_VISIBLE_ITEMS, filtered.length);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;
    if (key.name === "return" || key.name === "enter") {
      const item = filtered[selectedIndex];
      if (item) {
        onSelect(item);
      }
    } else if (key.name === "up") {
      setSelectedIndex((prev) => {
        const newIndex = Math.max(0, prev - 1);
        const scrollBox = scrollRef.current;
        if (scrollBox && newIndex < scrollBox.scrollTop) {
          scrollBox.scrollTo(newIndex);
        }
        const item = filtered[newIndex];
        if (item && onHighlight) {
          onHighlight(item);
        }
        return newIndex;
      });
    } else if (key.name === "down") {
      setSelectedIndex((prev) => {
        const newIndex = Math.min(filtered.length - 1, prev + 1);
        const scrollBox = scrollRef.current;
        if (scrollBox) {
          const viewportHeight = scrollBox.viewport.height;
          const visibleEnd = scrollBox.scrollTop + viewportHeight - 1;

          if (newIndex > visibleEnd) {
            scrollBox.scrollTo(newIndex - viewportHeight + 1);
          }
        }
        const item = filtered[newIndex];
        if (item && onHighlight) {
          onHighlight(item);
        }
        return newIndex;
      });
    }
  });

  return <box flexDirection="column" gap={1}>
<input
  ref={inputRef}
  focused
  onChange={handleContentChange}
  placeholder={Placeholder}
/>

{
    filtered.length === 0 ? <text attributes={TextAttributes.DIM}>{emptyText}</text>:<scrollbox
    ref={scrollRef}
    height={visibleHeight}
  >
    {filtered.map((item, index) => {
        const isSelected = selectedIndex === index;
        return <box key={getKey(item)}
        flexDirection="row"
        height={1}
        overflow="hidden"
        backgroundColor={isSelected ? colors.info : undefined}
        onMouseMove ={()=>{
            setSelectedIndex(index);
            if(onHighlight) {
                onHighlight(item);
            }
        }}
        >
            <text attributes={isSelected ? TextAttributes.BOLD : TextAttributes.NONE}>{renderItem(item)}</text>
        </box>
    })}
  </scrollbox>
}
  </box>;
}

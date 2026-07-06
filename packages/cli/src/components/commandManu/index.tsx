import { type ScrollBoxRenderable } from "@opentui/core";
import { palette, spacing } from "../../theme";
import { useTheme } from "../../providers/theme";
import { COMMANDS } from "./Commands";
import { getFilteredCommands } from "./filterCommands";

/** Most rows shown at once before the list scrolls. */
const MAX_VISIBLE_ITEMS = 5;

// Column widths are derived once from the full command list so every row aligns
// and the menu width stays stable as the user filters.
const NAME_COL_WIDTH =
  Math.max(...COMMANDS.map((command) => command.name.length)) + spacing.sm;

const DESCRIPTION_COL_WIDTH = Math.max(
  ...COMMANDS.map((command) => command.description.length)
);

const MENU_WIDTH = NAME_COL_WIDTH + DESCRIPTION_COL_WIDTH + spacing.sm * 2;

type CommandMenuProps = {
  /** Filter query (text after the leading "/"). */
  query: string;
  /** Index of the highlighted row. */
  selectedIndex: number;
  /** Scroll container ref, owned by `useCommandMenu`. */
  scrollRef: React.RefObject<ScrollBoxRenderable | null> | null;
  /** Called when a row is highlighted. */
  onSelect: (index: number) => void;
  /** Called when a row is activated. */
  onExecute: (index: number) => void;
};

/**
 * Renders the filtered slash-command list as an aligned name/description grid,
 * highlighting the selected row. Shows a "No commands found" placeholder when
 * the query matches nothing.
 */
export function CommandMenu({
  query,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: CommandMenuProps) {
  const { colors, textVariant } = useTheme();
  const filteredCommands = getFilteredCommands(query);
  const visibleHeight = Math.min(filteredCommands.length, MAX_VISIBLE_ITEMS);

  if (filteredCommands.length === 0)
    return (
      <box
        paddingX={spacing.sm}
        backgroundColor={colors.surfaceRaised}
        width={MENU_WIDTH}
      >
        <text {...textVariant("subtle")}>No commands found</text>
      </box>
    );

  return (
    <scrollbox
      ref={scrollRef ?? undefined}
      width={MENU_WIDTH}
      height={visibleHeight}
      backgroundColor={colors.surfaceRaised}
    >
      {filteredCommands.map((command, index) => {
        const isSelected = index === selectedIndex;

        return (
          <box
            key={command.value}
            flexDirection="row"
            paddingX={spacing.sm}
            height={1}
            backgroundColor={isSelected ? colors.accent : palette.transparent}
          >
            <box width={NAME_COL_WIDTH} flexShrink={0}>
              <text
                selectable={false}
                {...(isSelected
                  ? { ...textVariant("label"), fg: colors.textInverse }
                  : textVariant("label"))}
              >
                {command.name}
              </text>
            </box>
            <box flexGrow={1} flexShrink={0}>
              <text
                selectable={false}
                {...(isSelected
                  ? { ...textVariant("muted"), fg: colors.textInverse }
                  : textVariant("subtle"))}
              >
                {command.description}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}

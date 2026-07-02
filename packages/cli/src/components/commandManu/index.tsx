import { type ScrollBoxRenderable } from "@opentui/core";
import { colors, palette, spacing, textVariant } from "../../theme";
import { COMMANDS } from "./Commands";
import { getFilteredCommands } from "./filterCommands";

const MAX_VISIBLE_ITEMS = 5;

const NAME_COL_WIDTH =
  Math.max(...COMMANDS.map((command) => command.name.length)) + spacing.sm;

const DESCRIPTION_COL_WIDTH = Math.max(
  ...COMMANDS.map((command) => command.description.length)
);

const MENU_WIDTH = NAME_COL_WIDTH + DESCRIPTION_COL_WIDTH + spacing.sm * 2;

type CommandMenuProps = {
  query: string;
  selectedIndex: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null> | null;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
};

export function CommandMenu({
  query,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: CommandMenuProps) {
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

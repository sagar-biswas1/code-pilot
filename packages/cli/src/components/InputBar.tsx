/**
 * InputBar — the prompt input at the bottom of the screen.
 *
 * Wraps an OpenTUI textarea with custom key bindings, an inline slash-command
 * menu (via {@link useCommandMenu}), and a status bar. Submitting either runs
 * the selected command or forwards the text to `onSubmit`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  KeyBinding as TextareaKeyBinding,
  ScrollBoxRenderable,
  TextareaRenderable,
} from "@opentui/core";
import { borders, palette, spacing } from "../theme";
import { isAbsolute, join, relative } from "node:path";
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
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";

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

const MAX_VISIBLE_MENTIONS = 9;
const CURRENT_DIRECTORY = process.cwd();
const MAX_FALLBACK_MENTION_CANDIDATES = 32;
/**
 * Directory budget for the fallback walk. A query that matches nothing would
 * otherwise read the entire tree on a keystroke; stopping early costs a few
 * deep matches in a huge repo and keeps typing responsive.
 */
const MAX_FALLBACK_MENTION_DIRECTORIES = 512;
const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;
/**
 * Never offered as a candidate, however the query is spelled. Their contents
 * are still reachable by typing the path out — this only keeps them from
 * crowding out real answers, which `@` on a fresh repo used to do by leading
 * with `node_modules/`.
 */
const NEVER_OFFERED_ENTRIES = new Set(["node_modules", ".git"]);
/** Not descended into by the tree search. Still listable if asked for by name. */
const RECURSIVE_MENTION_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "public",
  "static",
  "templates",
]);

type MentionMatch = {
  start: number;
  end: number;
  query: string;
};

type MentionCandidate = {
  path: string;
  kind: "file" | "directory";
};

function isWithinCurrentDirectory(targetPath: string) {
  const relativePath = relative(CURRENT_DIRECTORY, targetPath);
  return !relativePath.startsWith("..") && !relativePath.includes("..");
}

function isMentionQueryCharacter(character: string) {
  return MENTION_QUERY_CHARACTER.test(character);
}

function findActiveMention(
  text: string,
  cursorOffset: number,
): MentionMatch | null {
  const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));
  let start = safeOffset;
  while (start > 0 && !/\s/.test(text.charAt(start - 1))) {
    start--;
  }
  let end = safeOffset;
  while (end < text.length && isMentionQueryCharacter(text.charAt(end))) {
    end++;
  }
  const token = text.slice(start, end);
  const relativeCursor = safeOffset - start;
  const mentionStart = token.lastIndexOf("@");

  if (mentionStart === -1) return null;
  const previousChar = token[mentionStart - 1];
  if (previousChar && isMentionQueryCharacter(previousChar)) return null;

  let mentionEnd = mentionStart + 1;
  while (
    mentionEnd < token.length &&
    isMentionQueryCharacter(token[mentionEnd]!)
  ) {
    mentionEnd++;
  }
  if (relativeCursor < mentionStart || relativeCursor > mentionEnd) return null;

  return {
    start: start + mentionStart,
    end: start + mentionEnd,
    query: token.slice(mentionStart + 1, mentionEnd),
  };
}

/** Directories first, then alphabetical — the order the menu renders in. */
function compareEntries(a: Dirent, b: Dirent) {
  if (a.isDirectory() !== b.isDirectory()) {
    return a.isDirectory() ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function toCandidate(
  name: string,
  isDirectory: boolean,
  parentPath: string,
): MentionCandidate {
  const path = parentPath ? `${parentPath}/${name}` : name;
  return isDirectory
    ? { path: `${path}/`, kind: "directory" }
    : { path, kind: "file" };
}

/**
 * Resolve the directory half of a query to a real location on disk.
 *
 * Walked one segment at a time so the *canonical* spelling comes back rather
 * than what was typed. macOS resolves `packages/CLI` case-insensitively, and
 * echoing the query back would insert a mention that reads fine here and then
 * fails on a case-sensitive filesystem. Segments like `..` simply never match
 * a directory entry, so an escape attempt ends here as `null`.
 */
async function resolveMentionDirectory(directoryPart: string): Promise<{
  absolutePath: string;
  canonicalPath: string;
} | null> {
  let absolutePath = CURRENT_DIRECTORY;
  let canonicalPath = "";

  for (const segment of directoryPart.split("/")) {
    if (segment === "" || segment === ".") continue;

    let entries: Dirent[];
    try {
      entries = await readdir(absolutePath, { withFileTypes: true });
    } catch {
      return null;
    }

    // Exact spelling wins; a case-insensitive match is the fallback so typing
    // `@packages/CLI/` still gets somewhere — just under its real name.
    const match =
      entries.find((entry) => entry.name === segment) ??
      entries.find(
        (entry) => entry.name.toLowerCase() === segment.toLowerCase(),
      );
    if (!match?.isDirectory()) return null;

    absolutePath = join(absolutePath, match.name);
    canonicalPath = canonicalPath
      ? `${canonicalPath}/${match.name}`
      : match.name;
  }

  return isWithinCurrentDirectory(absolutePath)
    ? { absolutePath, canonicalPath }
    : null;
}

/**
 * Breadth-first search of the tree, for a query the direct listing could not
 * answer. Shallow matches surface first, which are usually the relevant ones.
 *
 * A query containing `/` is matched against each candidate's whole relative
 * path — `@src/theme` should find `packages/cli/src/theme/`, and matching only
 * the entry name is exactly why it used to come back empty.
 */
async function searchMentionTree(
  query: string,
  showHiddenEntries: boolean,
): Promise<MentionCandidate[]> {
  const needle = query.toLowerCase();
  const matchFullPath = needle.includes("/");
  const matches: MentionCandidate[] = [];
  const queue: Array<{ absolutePath: string; relativePath: string }> = [
    { absolutePath: CURRENT_DIRECTORY, relativePath: "" },
  ];

  let directoriesRead = 0;
  while (
    queue.length > 0 &&
    matches.length < MAX_FALLBACK_MENTION_CANDIDATES &&
    directoriesRead < MAX_FALLBACK_MENTION_DIRECTORIES
  ) {
    const current = queue.shift()!;
    directoriesRead++;

    let entries: Dirent[];
    try {
      entries = await readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, races) — skip it, keep walking.
      continue;
    }

    for (const entry of entries.sort(compareEntries)) {
      if (!showHiddenEntries && entry.name.startsWith(".")) continue;
      if (NEVER_OFFERED_ENTRIES.has(entry.name)) continue;

      // `isDirectory()` is false for symlinks, so the walk can't cycle.
      const isDirectory = entry.isDirectory();
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name;

      // Substring rather than prefix: the point of the search is to find
      // something the user only half-remembers the name of.
      const haystack = (
        matchFullPath ? relativePath : entry.name
      ).toLowerCase();
      if (haystack.includes(needle)) {
        matches.push(toCandidate(entry.name, isDirectory, current.relativePath));
        if (matches.length >= MAX_FALLBACK_MENTION_CANDIDATES) break;
      }

      if (
        isDirectory &&
        !RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)
      ) {
        queue.push({
          absolutePath: join(current.absolutePath, entry.name),
          relativePath,
        });
      }
    }
  }

  return matches;
}

/**
 * Resolve an `@` mention query to completion candidates, all relative to the
 * current working directory.
 *
 * The query reads as `<directory>/<name prefix>`: the directory half is listed
 * and filtered by the prefix. Anything that listing can't answer falls through
 * to {@link searchMentionTree}, so a half-remembered name or a partial path
 * both still find their target.
 */
async function getMentionCandidates(
  query: string,
): Promise<MentionCandidate[]> {
  const normalizedQuery = query.startsWith("./") ? query.slice(2) : query;
  if (isAbsolute(normalizedQuery)) {
    return [];
  }

  // A trailing slash needs no special case: it puts the whole query in the
  // directory half and leaves an empty prefix, which is "list this directory".
  const lastSlashIndex = normalizedQuery.lastIndexOf("/");
  const directoryPart =
    lastSlashIndex === -1 ? "" : normalizedQuery.slice(0, lastSlashIndex);
  const namePrefix = normalizedQuery.slice(lastSlashIndex + 1);

  const lowerCasePrefix = namePrefix.toLowerCase();
  // A leading dot is the only way to ask for dotfiles; otherwise they're noise.
  const showHiddenEntries = namePrefix.startsWith(".");

  const directory = await resolveMentionDirectory(directoryPart);
  const directMatches: MentionCandidate[] = [];

  if (directory) {
    let entries: Dirent[] = [];
    try {
      entries = await readdir(directory.absolutePath, { withFileTypes: true });
    } catch {
      // Vanished between resolving and listing — the search below still runs.
    }

    for (const entry of entries.sort(compareEntries)) {
      if (!showHiddenEntries && entry.name.startsWith(".")) continue;
      if (NEVER_OFFERED_ENTRIES.has(entry.name)) continue;
      if (!entry.name.toLowerCase().startsWith(lowerCasePrefix)) continue;
      // Built from the canonical directory, not the typed one.
      directMatches.push(
        toCandidate(entry.name, entry.isDirectory(), directory.canonicalPath),
      );
    }
  }

  if (directMatches.length > 0) return directMatches;

  // An empty prefix under a directory that does exist means "show me what's in
  // here" — the listing is the complete answer, even when it came back empty.
  if (directory && namePrefix === "") return directMatches;

  return searchMentionTree(normalizedQuery, showHiddenEntries);
}

/** Width of the leading icon column; wide enough for a double-width emoji. */
const MENTION_ICON_COL_WIDTH = 2 + spacing.xs;

type FileMentionMenuProps = {
  /** Candidates for the current query, in display order. */
  candidates: MentionCandidate[];
  /** Index of the highlighted row. */
  selectedIndex: number;
  /** Scroll container ref, owned by the InputBar so it can keep up with keys. */
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** Called when a row is highlighted. */
  onSelect: (index: number) => void;
  /** Called when a row is activated. */
  onExecute: (index: number) => void;
};

/**
 * Renders the `@` mention candidates as a scrolling list of paths, mirroring
 * the slash-command menu's look. Paths truncate rather than wrap so a deeply
 * nested match can't push the menu into a second line.
 */
function FileMentionMenu({
  candidates,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: FileMentionMenuProps) {
  const { colors, textVariant } = useTheme();
  const visibleHeight = Math.min(candidates.length, MAX_VISIBLE_MENTIONS);

  if (candidates.length === 0) {
    return (
      <box
        width="100%"
        paddingLeft={spacing.sm}
        paddingRight={spacing.sm}
        backgroundColor={colors.surfaceRaised}
      >
        <text {...textVariant("subtle")}>No matching files or directories</text>
      </box>
    );
  }

  return (
    <scrollbox
      ref={scrollRef}
      width="100%"
      height={visibleHeight}
      backgroundColor={colors.surfaceRaised}
    >
      {candidates.map((candidate, index) => {
        const isSelected = index === selectedIndex;
        const textStyle = isSelected
          ? { ...textVariant("body"), fg: colors.textInverse }
          : textVariant("subtle");

        return (
          <box
            key={candidate.path}
            flexDirection="row"
            paddingLeft={spacing.sm}
            paddingRight={spacing.sm}
            height={1}
            overflow="hidden"
            backgroundColor={isSelected ? colors.accent : palette.transparent}
            onMouseMove={() => onSelect(index)}
            onMouseDown={() => onExecute(index)}
          >
            <box width={MENTION_ICON_COL_WIDTH} flexShrink={0}>
              <text selectable={false} {...textStyle}>
                {candidate.kind === "directory" ? "📁" : "📄"}
              </text>
            </box>
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              <text selectable={false} wrapMode="none" truncate {...textStyle}>
                {candidate.path}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
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
  const { mode, toggleMode, setMode, setModel } = usePromptConfig();
  const textAreaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const onCursorChangeRef = useRef<() => void>(() => {});
  const renderer = useRenderer();
  /**
   * The mention the cursor currently sits in. Mirrored in a ref because the
   * textarea's callbacks and the keyboard handler read it outside React's
   * render cycle, where the state value would be a render behind.
   */
  const activeMentionRef = useRef<MentionMatch | null>(null);
  /** Query whose candidates are loaded or in flight; dedupes redundant reads. */
  const loadedMentionQueryRef = useRef<string | null>(null);
  /** Monotonic id so a slow directory read can't overwrite a newer one. */
  const mentionRequestIdRef = useRef(0);
  /** Set while we rewrite the buffer ourselves, to ignore the echoed change. */
  const applyingMentionRef = useRef(false);
  const mentionScrollRef = useRef<ScrollBoxRenderable | null>(null);

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
  const { isTopLayer, setResponder, push, pop } = useKeyboardLayer();
  const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<
    MentionCandidate[]
  >([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    textArea.onSubmit = () => {
      onSubmitRef.current();
    };
    // Arrow keys move the cursor without changing the content, so the mention
    // menu needs this to notice the cursor leaving (or entering) a mention.
    textArea.onCursorChange = () => {
      onCursorChangeRef.current();
    };
  }, []);

  // On Enter: accept a mention, else run the highlighted command, else submit.
  onSubmitRef.current = () => {
    if (disabled) return;
    if (showMentionMenu && mentionCandidates.length > 0) {
      applyMention(mentionSelectedIndex);
      return;
    }
    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      handleCommand(command);
      return;
    }
    handleSubmit();
  };

  onCursorChangeRef.current = () => {
    const textarea = textAreaRef.current;
    if (disabled || !textarea || applyingMentionRef.current) return;
    void syncMentionMenu(textarea.plainText, textarea.cursorOffset);
  };

  const showMentionMenu = activeMention !== null;

  const closeMentionMenu = useCallback(() => {
    activeMentionRef.current = null;
    loadedMentionQueryRef.current = null;
    // Bump the id so an in-flight read resolves into a discarded result.
    mentionRequestIdRef.current++;
    setActiveMention(null);
    setMentionCandidates([]);
    setMentionSelectedIndex(0);
    pop("mention");
  }, [pop]);

  /** Clear the input and invoke a command's action with the app context. */
  const handleCommand = useCallback(
    (command: Command | undefined) => {
      const textarea = textAreaRef.current;
      if (!textarea || !command) return;
      // Clearing the buffer directly doesn't fire `onContentChange`, so the
      // menu's own view of the text has to be reset alongside it.
      textarea.setText("");
      handleContentChange("");
      closeMentionMenu();

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

  /**
   * Recompute the mention under the cursor and load its candidates. Safe to
   * call on every keystroke: an unchanged query short-circuits before touching
   * the filesystem, and stale reads are dropped by request id.
   */
  const syncMentionMenu = useCallback(
    async (text: string, cursorOffset: number) => {
      const previousMention = activeMentionRef.current;
      const nextMention = findActiveMention(text, cursorOffset);

      if (!nextMention) {
        if (previousMention) closeMentionMenu();
        return;
      }

      const isSameMention =
        previousMention?.start === nextMention.start &&
        previousMention?.end === nextMention.end &&
        previousMention?.query === nextMention.query;

      activeMentionRef.current = nextMention;
      setActiveMention(nextMention);
      // Taking the top layer redirects up/down/escape away from the textarea
      // and the command menu for as long as the mention is being typed.
      push("mention", () => {
        closeMentionMenu();
        return true;
      });

      // The same query already listed (or is listing) the same directory —
      // typing that only moved the cursor shouldn't re-read the disk.
      if (
        isSameMention &&
        loadedMentionQueryRef.current === nextMention.query
      ) {
        return;
      }

      if (previousMention?.query !== nextMention.query) {
        setMentionSelectedIndex(0);
        mentionScrollRef.current?.scrollTo(0);
      }

      loadedMentionQueryRef.current = nextMention.query;
      const requestId = ++mentionRequestIdRef.current;
      const candidates = await getMentionCandidates(nextMention.query);
      // A newer query (or a close) won the race while we were reading.
      if (requestId !== mentionRequestIdRef.current) return;

      setMentionCandidates(candidates);
      setMentionSelectedIndex((previous) =>
        Math.min(previous, Math.max(0, candidates.length - 1)),
      );
    },
    [closeMentionMenu, push],
  );

  /**
   * Swap the mention under the cursor for the chosen path. Files complete to
   * `@path ` and close the menu; directories complete to `@path/` and stay
   * open so the next keystroke (or Tab) drills further in.
   */
  const applyMention = useCallback(
    (index: number) => {
      const textarea = textAreaRef.current;
      const mention = activeMentionRef.current;
      const candidate = mentionCandidates[index];
      if (!textarea || !mention || !candidate) return;

      const isDirectory = candidate.kind === "directory";
      const insertion = `@${candidate.path}${isDirectory ? "" : " "}`;
      const text = textarea.plainText;
      const nextText =
        text.slice(0, mention.start) + insertion + text.slice(mention.end);
      const nextCursorOffset = mention.start + insertion.length;

      // `replaceText` keeps the edit undoable, but it echoes back through
      // `onContentChange` before the cursor has moved — sync manually instead.
      applyingMentionRef.current = true;
      textarea.replaceText(nextText);
      textarea.cursorOffset = nextCursorOffset;
      applyingMentionRef.current = false;

      handleContentChange(nextText);
      if (isDirectory) {
        // Force a re-read: the query changed even though the mention didn't move.
        loadedMentionQueryRef.current = null;
        void syncMentionMenu(nextText, nextCursorOffset);
      } else {
        closeMentionMenu();
      }
    },
    [mentionCandidates, handleContentChange, syncMentionMenu, closeMentionMenu],
  );

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const textarea = textAreaRef.current;
    if (!textarea) return;
    const text = textarea.plainText.trim();
    if (!text) return;
    onSubmit?.(text);
    // `setText` doesn't fire `onContentChange`, so the menu is closed by hand.
    textarea.setText("");
    closeMentionMenu();
  }, [onSubmit, disabled, closeMentionMenu]);

  const handleTextAreaContentChange = useCallback(() => {
    const textarea = textAreaRef.current;
    if (!textarea || applyingMentionRef.current) return;
    const text = textarea.plainText;
    handleContentChange(text);
    void syncMentionMenu(text, textarea.cursorOffset);
  }, [handleContentChange, syncMentionMenu]);

  // Up/down/tab/escape belong to the mention menu while it owns the top layer;
  // Enter arrives through the textarea's submit binding instead.
  useKeyboard((key) => {
    if (disabled || !showMentionMenu || !isTopLayer("mention")) return;

    if (key.name === "up") {
      key.preventDefault();
      setMentionSelectedIndex((previous) => {
        const nextIndex = Math.max(0, previous - 1);
        const scrollBox = mentionScrollRef.current;
        if (scrollBox && nextIndex < scrollBox.scrollTop) {
          scrollBox.scrollTo(nextIndex);
        }
        return nextIndex;
      });
    } else if (key.name === "down") {
      key.preventDefault();
      setMentionSelectedIndex((previous) => {
        if (mentionCandidates.length === 0) return 0;
        const nextIndex = Math.min(mentionCandidates.length - 1, previous + 1);
        const scrollBox = mentionScrollRef.current;
        if (scrollBox) {
          const viewportHeight = scrollBox.viewport.height;
          const visibleEnd = scrollBox.scrollTop + viewportHeight - 1;
          if (nextIndex > visibleEnd) {
            scrollBox.scrollTo(nextIndex - viewportHeight + 1);
          }
        }
        return nextIndex;
      });
    } else if (key.name === "tab") {
      key.preventDefault();
      applyMention(mentionSelectedIndex);
    } else if (key.name === "escape") {
      key.preventDefault();
      closeMentionMenu();
    }
  });

  // Empty deps here captured the *first* render's `resolveCommand`, which
  // closes over the unfiltered command list — so clicking a row after typing
  // a query ran whichever command sat at that index before filtering.
  const handleCommandExecute = useCallback(
    (index: number) => {
      handleCommand(resolveCommand(index));
    },
    [resolveCommand, handleCommand],
  );

  const handleMentionExecute = useCallback(
    (index: number) => {
      setMentionSelectedIndex(index);
      applyMention(index);
    },
    [applyMention],
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
      {/* A "/" query and an "@" query can't both be active, so one overlay
          slot is enough — the command menu wins if they ever collide. */}
      {showMentionMenu && !showCommandMenu && (
        <box position="absolute" top="-100%" width="100%" zIndex={1000}>
          <FileMentionMenu
            candidates={mentionCandidates}
            selectedIndex={mentionSelectedIndex}
            scrollRef={mentionScrollRef}
            onSelect={setMentionSelectedIndex}
            onExecute={handleMentionExecute}
          />
        </box>
      )}
      <textarea
        ref={textAreaRef}
        flexGrow={1}
        minHeight={1}
        focused={
          focused &&
          (isTopLayer("base") || isTopLayer("command") || isTopLayer("mention"))
        }
        placeholder={placeholder}
        placeholderColor={colors.textSubtle}
        textColor={colors.text}
        keyBindings={KEY_BINDINGS}
        onContentChange={handleTextAreaContentChange}
      />

      <box width="100%" marginTop={spacing.xs}>
        <StatusBar
          hints={
            showMentionMenu
              ? [
                  { key: "↑↓", label: "select" },
                  { key: "⇥", label: "insert" },
                  { key: "esc", label: "dismiss" },
                ]
              : [
                  { key: "↵", label: "send" },
                  { key: "^C", label: "quit" },
                ]
          }
        />
      </box>
    </box>
  );
}

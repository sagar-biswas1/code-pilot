/**
 * Agent picker dialog body.
 *
 * Rendered inside the app dialog (opened by the `/agents` command). Walks the
 * user through two searchable steps — first the agent mode (Build/Plan), then
 * the chat model — committing each choice as it is picked and closing once the
 * model is chosen.
 */

import { useCallback, useMemo, useState } from "react";

import { Mode } from "@codepilot/database/enums";
import {
  SUPPORTED_CHAT_MODELS,
  type SupportedChatModel,
  type SupportedChatModelID,
} from "@codepilot/shared";

import { DialogSearchList } from "./DialogSearchList";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { useToast } from "../providers/toast";

type Step = "mode" | "model";

const MODE_DETAILS: Record<Mode, { label: string; hint: string }> = {
  [Mode.BUILD]: { label: "Build", hint: "write and edit code" },
  [Mode.PLAN]: { label: "Plan", hint: "research and plan, no edits" },
};

// `Mode` is a const object (Prisma's generated enums), so the option list is
// derived from it rather than hand-listed — a new mode shows up automatically.
const MODE_OPTIONS = Object.values(Mode);

// Copied out of the `as const` tuple so the list is a plain mutable array.
const MODEL_OPTIONS: SupportedChatModel[] = [...SUPPORTED_CHAT_MODELS];

export function AgentDialogueContent({
  mode,
  setMode,
  setModel,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  setModel: (model: SupportedChatModelID) => void;
}) {
  const [step, setStep] = useState<Step>("mode");
  // The mode picked in step one, used only for the closing toast — `mode` from
  // props is a snapshot taken when the dialog opened and won't reflect it.
  const [pickedMode, setPickedMode] = useState(mode);
  const dialog = useDialog();
  const toast = useToast();
  const { textVariant } = useTheme();

  const handleSelectMode = useCallback(
    (next: Mode) => {
      setMode(next);
      setPickedMode(next);
      setStep("model");
    },
    [setMode],
  );

  const handleSelectModel = useCallback(
    (model: SupportedChatModel) => {
      setModel(model.id);
      dialog.close();
      toast.show({
        variant: "success",
        message: `Agent: ${MODE_DETAILS[pickedMode].label} · ${model.id}`,
      });
    },
    [setModel, dialog, toast, pickedMode],
  );

  // Neither list previews anything, but `DialogSearchList` reports highlights
  // unconditionally.
  const handleHighlight = useCallback(() => {}, []);

  const renderMode = useCallback(
    (option: Mode) => {
      const marker = option === mode ? "●" : " ";
      const { label, hint } = MODE_DETAILS[option];
      return `${marker} ${label}  (${hint})`;
    },
    [mode],
  );

  const stepHint = useMemo(
    () =>
      step === "mode"
        ? "Step 1 of 2 — agent mode"
        : `Step 2 of 2 — model  (mode: ${MODE_DETAILS[pickedMode].label})`,
    [step, pickedMode],
  );

  return (
    <box flexDirection="column" gap={1}>
      <text {...textVariant("subtle")}>{stepHint}</text>

      {/* Keyed by step so the search input and highlight reset between them. */}
      {step === "mode" ? (
        <DialogSearchList
          key="mode"
          items={MODE_OPTIONS}
          getKey={getModeKey}
          renderItem={renderMode}
          filterFn={matchesMode}
          onHighlight={handleHighlight}
          onSelect={handleSelectMode}
          placeholder="Search modes…"
          emptyText="No modes found"
        />
      ) : (
        <DialogSearchList
          key="model"
          items={MODEL_OPTIONS}
          getKey={getModelKey}
          renderItem={renderModel}
          filterFn={matchesModel}
          onHighlight={handleHighlight}
          onSelect={handleSelectModel}
          placeholder="Search models…"
          emptyText="No models found"
        />
      )}
    </box>
  );
}

function getModeKey(option: Mode) {
  return option;
}

function matchesMode(option: Mode, query: string) {
  const needle = query.toLowerCase();
  const { label, hint } = MODE_DETAILS[option];
  return (
    label.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle)
  );
}

// The same id can be served by two providers (e.g. `gpt-4o-mini` on OpenAI and
// Azure), so the row key has to include the provider to stay unique.
function getModelKey(model: SupportedChatModel) {
  return `${model.provider}:${model.id}`;
}

function matchesModel(model: SupportedChatModel, query: string) {
  const needle = query.toLowerCase();
  return (
    model.id.toLowerCase().includes(needle) ||
    model.provider.toLowerCase().includes(needle)
  );
}

function renderModel(model: SupportedChatModel) {
  return `${model.id}  (${model.provider})`;
}

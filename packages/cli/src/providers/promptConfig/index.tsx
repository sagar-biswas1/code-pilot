import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_CHAT_MODEL_ID,
  type SupportedChatModelID,
} from "@codepilot/shared";
import { Mode } from "@codepilot/database/enums";

type PromptConfigContextValue = {
  mode: Mode;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  model: SupportedChatModelID;
  setModel: (model: SupportedChatModelID) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(
  null,
);

export function usePromptConfig(): PromptConfigContextValue {
  const context = useContext(PromptConfigContext);
  if (!context) {
    throw new Error(
      "usePromptConfig must be used within a PromptConfigProvider",
    );
  }
  return context;
}

export function PromptConfigProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(Mode.BUILD);
  const [model, setModel] = useState<SupportedChatModelID>(
    DEFAULT_CHAT_MODEL_ID,
  );

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
  }, []);

  return (
    <PromptConfigContext.Provider
      value={{ mode, toggleMode, setMode, model, setModel }}
    >
      {children}
    </PromptConfigContext.Provider>
  );
}

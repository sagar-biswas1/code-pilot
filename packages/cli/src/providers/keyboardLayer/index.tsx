import { useKeyboard, useRenderer } from "@opentui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type Responder = () => boolean;

type KeyboardLayerContextValue = {
  push: (id: string, responder: Responder) => void;
  pop: (id: string) => void;
  clear: () => void;
  isTopLayer: (id: string) => boolean;
  setResponder: (id: string, responder: Responder | null) => void;
};

const KeyboardLayerContext = createContext<KeyboardLayerContextValue | null>(
  null,
);

export const KeyboardLayerProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [stack, setStack] = useState<string[]>(["base"]);
  const stackRef = useRef(stack);

  // Keep the ref in sync so the useKeyboard handler (which closes over the ref,
  // not the state) always walks the current layer stack.
  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  const responders = useRef<Map<string, Responder>>(new Map());
  const renderer = useRenderer();

  const push = useCallback((id: string, responder: Responder) => {
    if (responder) {
      responders.current.set(id, responder);
    }
    setStack((prev) => {
      if (prev.includes(id)) {
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  const pop = useCallback((id: string) => {
    responders.current.delete(id);
    setStack((prev) => prev.filter((layer) => layer !== id));
  }, []);

  const clear = useCallback(() => {
    responders.current.clear();
    setStack(["base"]);
  }, []);

  const isTopLayer = useCallback(
    (id: string) => {
      return stack.length === 0 || stack[stack.length - 1] === id;
    },
    [stack],
  );

  const setResponder = useCallback(
    (id: string, responder: Responder | null) => {
      if (responder) {
        responders.current.set(id, responder);
      } else {
        responders.current.delete(id);
      }
    },
    [],
  );
  useKeyboard((key) => {
    if (!key.ctrl || key.name !== "c") {
      return;
    }
    const currentStack = stackRef.current;
    for (let i = currentStack.length - 1; i >= 0; i--) {
      const layer = currentStack[i]!;
      const responder = responders.current.get(layer);
      if (responder && responder()) {
        return;
      }
    }
    renderer.destroy();
    process.exit(0);
  });
  return (
    <KeyboardLayerContext.Provider
      value={{ push, pop, clear, isTopLayer, setResponder }}
    >
      {children}
    </KeyboardLayerContext.Provider>
  );
};

export function useKeyboardLayer() {
  const context = useContext(KeyboardLayerContext);
  if (!context) {
    throw new Error(
      "useKeyboardLayer must be used within a KeyboardLayerProvider",
    );
  }
  return context;
}

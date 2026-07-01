import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Header } from "./components/Header";
import { InputBar } from "./components/InputBar";
import { StatusBar } from "./components/StatusBar";
import { colors } from "./theme";

function App() {
  return (
    <box flexGrow={1}>
      <Header />

      <box flexGrow={1} />

      <box backgroundColor={colors.surface}>
        <InputBar onSubmit={(value) => console.log(value)} />
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);

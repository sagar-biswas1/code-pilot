import { TextAttributes } from "@opentui/core";
import { InputBar } from "./InputBar";
import { Spinner } from "./Spinner";

type Props = {
  children: React.ReactNode;
  onSubmit: (text: string) => void;
  inputDisabled?: boolean;
  loading?: boolean;
};

export function SessionShell({
  children,
  onSubmit,
  inputDisabled,
  loading,
}: Props) {
  return (
    <box
      flexDirection="column"
      height="100%"
      width="100%"
      flexGrow={1}
      padding={2}
      gap={2}
    >
      <scrollbox flexGrow={1} width="100%" stickyScroll stickyStart="bottom">
        <box gap={1}>{children}</box>
      </scrollbox>
      <box flexShrink={0}>
        <InputBar onSubmit={onSubmit} disabled={inputDisabled} />
      </box>
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        height={1}
        gap={2}
        paddingLeft={2}
      >
        <box
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap={2}
        >
          {loading ? (
            <box
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              gap={2}
            >
              <Spinner />
            </box>
          ) : null}
        </box>

        <box
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap={2}
          marginLeft="auto"
        >
          <text>tab</text>
          <text attributes={TextAttributes.DIM}>agents</text>
        </box>
      </box>
    </box>
  );
}

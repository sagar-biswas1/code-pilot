import type { ReactNode } from "react";

/** Content passed to `dialog.open(...)` to describe a modal. */
export interface DialogProps {
  /**
   * Body of the dialog. Must be OpenTUI nodes (e.g. `<text>`/`<box>`); raw
   * strings are not allowed as direct children of a `<box>`.
   */
  children: ReactNode;
  /** Heading shown in the dialog header. */
  title: string;
}
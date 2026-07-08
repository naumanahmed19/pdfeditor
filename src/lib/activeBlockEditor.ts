// Points at the block editor of the text box currently being edited (if any).
// The toolbar's paragraph-format controls (headings, lists, indent) consult
// this the same way style controls consult `activeTextEditor`.
import type { BlockKind } from "../types";

export interface ActiveBlockEditor {
  annId: string;
  /** Format state at the caret, for the toolbar's active indicators. */
  state: () => { kind: BlockKind; list?: "bullet" | "numbered" };
  /** Set the current paragraph to a heading or plain paragraph. */
  setKind: (kind: "p" | "h1" | "h2" | "h3") => void;
  /** Toggle the current paragraph in/out of a bullet or numbered list. */
  toggleList: (list: "bullet" | "numbered") => void;
  indent: () => void;
  outdent: () => void;
}

export const activeBlockEditor: { current: ActiveBlockEditor | null } = { current: null };

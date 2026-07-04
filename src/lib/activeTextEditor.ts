// Points at the rich-text editor of the text box currently being edited (if
// any). Style controls in the toolbar and popover consult this: when a box is
// being edited they style the SELECTION via the editor; otherwise they patch
// the whole annotation. Cleared on blur/unmount.
import type { TextRun } from "../types";
import type { ResolvedStyle } from "./richtext";

export interface ActiveEditor {
  annId: string;
  /** Style the selection (whole text if collapsed). Returns false when the
   *  box has no text yet — the caller should patch the annotation instead. */
  applyStyle: (patch: Partial<Omit<TextRun, "text">>) => boolean;
  selection: () => { start: number; end: number } | null;
  /** Resolved value of `key` across the current selection, or undefined when
   *  the selection spans mixed values. Lets toolbar toggles reflect the
   *  SELECTION's style (not just the box), so they don't invert on runs. */
  styleValue: <K extends keyof ResolvedStyle>(key: K) => ResolvedStyle[K] | undefined;
}

export const activeTextEditor: { current: ActiveEditor | null } = { current: null };

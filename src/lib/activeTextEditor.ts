// Points at the rich-text editor of the text box currently being edited (if
// any). Style controls in the toolbar and popover consult this: when a box is
// being edited they style the SELECTION via the editor; otherwise they patch
// the whole annotation. Cleared on blur/unmount.
import type { TextRun } from "../types";

export interface ActiveEditor {
  annId: string;
  /** Style the selection (whole text if collapsed). Returns false when the
   *  box has no text yet — the caller should patch the annotation instead. */
  applyStyle: (patch: Partial<Omit<TextRun, "text">>) => boolean;
  selection: () => { start: number; end: number } | null;
}

export const activeTextEditor: { current: ActiveEditor | null } = { current: null };

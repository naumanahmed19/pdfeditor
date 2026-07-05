// Bridges the in-place "edit existing text" session (a floating textarea over
// the PDF, owned by a PageCanvas) to the top toolbar, so its font / size /
// color controls live in the toolbar's contextual row instead of a separate
// floating bar. The editor registers its current style + setters here; the
// toolbar subscribes and renders controls that drive them. Mirrors the
// `activeTextEditor` pattern used for new rich-text boxes.

export interface InlineEditControls {
  colorHex: string;
  sizePt: number;
  /** The run's real base font name (subset prefix stripped), for display. */
  fontName: string;
  /** "original" = keep the embedded face; otherwise a replacement family. */
  family: string;
  bold: boolean;
  italic: boolean;
  saving: boolean;
  setColorHex: (v: string) => void;
  setSizePt: (updater: (s: number) => number) => void;
  setFamily: (v: string) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
}

let current: InlineEditControls | null = null;
let version = 0;
const listeners = new Set<() => void>();

export const activeInlineEdit = {
  get current() {
    return current;
  },
  /** Monotonic counter for useSyncExternalStore snapshots. */
  getVersion() {
    return version;
  },
  set(v: InlineEditControls | null) {
    current = v;
    version++;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

// Pure text-editing utilities extracted from Viewer.tsx: types, line/diff
// helpers and font resolution for in-place ("inline") text edits. No JSX, no
// React — safe to import from components or the store.
import type { TextObject, TextRunEdit } from "../../lib/pdfium";

/** One content-stream run of the edited visual line. */
export interface InlineEditRun {
  objectIndex: number;
  text: string;
  /** Offset of this run's text within the joined line string. */
  start: number;
  /** Separator inferred after this run ("" or " ") — virtual, not run text. */
  sep: string;
  /** Baseline origin (text-matrix e,f) in page space. */
  originX: number;
  originY: number;
  /** Base font name of THIS run — glyph coverage is per-face, per-subset. */
  fontName: string;
}

/** Paragraph geometry captured at click time so a commit can reflow. */
export interface ReflowMeta {
  /** Per visual line, top→bottom: its runs and baseline origin. */
  lines: { objectIndexes: number[]; originX: number; originY: number }[];
  /** Paragraph column width in points. */
  width: number;
  /** Baseline-to-baseline distance in points (positive, downward). */
  leading: number;
}

export interface InlineEdit {
  /** Identifies this click session so deferred font hydration cannot update a later edit. */
  id: number;
  /** All runs of the clicked visual line, left to right. */
  runs: InlineEditRun[];
  /** The joined line text shown in the editor. */
  original: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Remaining page room available to a naturally growing editor. */
  maxWidth: number;
  maxHeight: number;
  /** Approximate character position corresponding to the user's click. */
  caretOffset: number;
  fontPx: number;
  /** Original ink color as an rgb() string (for on-screen display). */
  color: string;
  /** Original ink color as hex (for the color control). */
  colorHex: string;
  /** Original font size in PDF points (of the clicked run). */
  fontSize: number;
  /** Real base font name of the clicked run (subset prefix stripped). */
  fontName: string;
  /** Closest bundled family — used only when the face must be replaced. */
  fallbackFamily: string;
  /** The clicked run's real embedded font program, for the on-screen preview.
   *  Null when it can't be loaded or can't render the line (CSS fallback then). */
  embeddedFont: Uint8Array | null;
  /** Style detected from the font name (initial state of the B/I toggles). */
  bold: boolean;
  italic: boolean;
  /** Line baseline origin (first run) — anchor for scale/skew transforms. */
  anchor: [number, number];
  /** Per-font proven glyphs: all page text drawn with each face. */
  fontChars: Record<string, string>;
  /** One sample objectIndex per page face: fontName -> objectIndex. */
  faceIndexes: Record<string, number>;
  /** Same-family runs in other styles: styleKey() -> objectIndex. */
  siblings: Partial<Record<string, number>>;
  /**
   * Present when the selection can reflow on commit: paragraph/block scope
   * with one face and size across every run. Absent = line breaks are fixed
   * (line scope, or mixed styles reflow would destroy).
   */
  reflow?: ReflowMeta;
}

/** Key for a bold/italic combination ("r", "b", "i", "bi"). */
export function styleKey(bold: boolean, italic: boolean): string {
  return `${bold ? "b" : ""}${italic ? "i" : ""}` || "r";
}

/** Family part of a base font name — subset prefix and style tokens removed. */
export function familyRoot(name: string): string {
  return name
    .replace(/^[A-Z]{6}\+/, "")
    .replace(
      /[-,._ ]?(extra ?bold|semi ?bold|demi ?bold|bold|black|heavy|italic|oblique|regular|roman|book|light|medium)/gi,
      "",
    )
    .replace(/(MT|PS|Std|Pro)$/i, "")
    .toLowerCase();
}

/**
 * Typeface part of a base font name: weight/width/slant and foundry tokens
 * stripped entirely, so "HQMWAZ+UniversLTStd-LightUltraCn",
 * "Univers67CondensedBold" and "UniversLTStd-Cn" all yield "univers".
 * Looser than familyRoot (which keeps width, so B/I sibling switching never
 * jumps to a differently-proportioned face) — used to find same-typeface
 * faces in the document when the edited run's subset lacks a typed glyph:
 * any Univers beats a generic bundled substitute.
 */
export function typefaceRoot(name: string): string {
  let n = name
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
  const tokens =
    /(extrabold|semibold|demibold|bold|black|heavy|italic|oblique|obl|regular|roman|book|extralight|ultralight|light|thin|medium|ultra|condensed|cond|cn|compressed|narrow|wide|extended|std|pro|lt|mt|ps)$/;
  for (;;) {
    const next = n.replace(tokens, "");
    if (next === n) break;
    n = next;
  }
  return n.length >= 3 ? n : "";
}

/** Weight/width/slant traits read from a base font name. */
export function faceTraits(name: string): {
  bold: boolean;
  italic: boolean;
  condensed: boolean;
  light: boolean;
} {
  const n = name.replace(/^[A-Z]{6}\+/, "");
  return {
    bold: /bold|black|heavy|semib|demib/i.test(n),
    italic: /italic|oblique|obl$/i.test(n),
    condensed: /cond|narrow|compres|cn(?![a-bd-z])/i.test(n),
    light: /light|thin/i.test(n),
  };
}

/**
 * How far a candidate face is from the wanted style, for ranking the
 * same-typeface fallbacks. Weight/slant mismatches dominate (a Bold where
 * Regular was asked reads as an error); width and lightness refine.
 */
export function faceStyleDistance(
  candidate: string,
  target: string,
  wantBold: boolean,
  wantItalic: boolean,
): number {
  const c = faceTraits(candidate);
  const t = faceTraits(target);
  return (
    (c.bold !== wantBold ? 4 : 0) +
    (c.italic !== wantItalic ? 4 : 0) +
    (c.condensed !== t.condensed ? 2 : 0) +
    (c.light !== t.light ? 1 : 0)
  );
}

/**
 * The visual line around `hit`: runs that overlap it vertically by more than
 * half a line-height, limited to the horizontally contiguous cluster — a wide
 * gap is a different column or table cell, not the same sentence.
 */
export function collectLine(objs: TextObject[], hit: TextObject): TextObject[] {
  const height = (o: TextObject) => o.top - o.bottom;
  const line = objs
    .filter((o) => {
      if (!o.text.trim()) return false;
      const overlap = Math.min(o.top, hit.top) - Math.max(o.bottom, hit.bottom);
      return overlap > 0.5 * Math.min(height(o), height(hit));
    })
    .sort((a, b) => a.left - b.left);
  const maxGap = Math.max(hit.fontSize, 6) * 1.5;
  let a = line.indexOf(hit);
  let b = a;
  while (a > 0 && line[a].left - line[a - 1].right <= maxGap) a--;
  while (b < line.length - 1 && line[b + 1].left - line[b].right <= maxGap) b++;
  return line.slice(a, b + 1);
}

/**
 * Map an edit of the joined line string back onto the underlying runs via a
 * common prefix/suffix diff. A change inside one run touches only that run;
 * a change spanning runs collapses them into the first (the rest are removed).
 * Untouched runs keep their exact bytes — and their exact positions.
 */
export function mapLineEditToRuns(edit: InlineEdit, newJoined: string): TextRunEdit[] {
  const old = edit.original;
  if (newJoined === old) {
    return edit.runs.map((r) => ({ objectIndex: r.objectIndex }));
  }
  let p = 0;
  const pMax = Math.min(old.length, newJoined.length);
  while (p < pMax && old[p] === newJoined[p]) p++;
  let s = 0;
  const sMax = pMax - p;
  while (
    s < sMax &&
    old[old.length - 1 - s] === newJoined[newJoined.length - 1 - s]
  ) {
    s++;
  }
  const oldEnd = old.length - s; // changed old span is [p, oldEnd)

  // Each run's span includes its inferred separator, so an edit at a word
  // boundary belongs to the run on the left.
  const spans = edit.runs.map((r) => ({
    start: r.start,
    end: r.start + r.text.length + r.sep.length,
  }));
  let first = -1;
  let last = -1;
  spans.forEach((sp, i) => {
    if (sp.end > p && sp.start < Math.max(oldEnd, p + 1)) {
      if (first === -1) first = i;
      last = i;
    }
  });
  if (first === -1) {
    // Pure insertion at the very end of the line — append to the last run.
    first = last = edit.runs.length - 1;
  }

  // New text for the merged first..last range, in new-string coordinates.
  const newEnd = newJoined.length - (old.length - spans[last].end);
  let merged = newJoined.slice(
    spans[first].start,
    Math.max(newEnd, spans[first].start),
  );
  // The inferred separator is not real document text — don't bake it.
  const lastSep = edit.runs[last].sep;
  if (lastSep && merged.endsWith(lastSep)) {
    merged = merged.slice(0, -lastSep.length);
  }

  return edit.runs.map((r, i) => {
    if (i < first || i > last) return { objectIndex: r.objectIndex };
    if (i === first) return { objectIndex: r.objectIndex, text: merged };
    return { objectIndex: r.objectIndex, text: "" };
  });
}

/**
 * True when a font whose glyph coverage could NOT be verified can still be
 * trusted to render `chars`. Applies only to non-subset standard text faces
 * (Helvetica/Arial, Times, Courier): those aren't embedded — every viewer
 * renders them with its own complete face — so plain Latin characters are
 * covered by definition. Subsets (ABCDEF+…) are never trusted: they carry
 * only the glyphs the document already uses.
 */
export function trustedStandardFont(fontName: string, chars: string[]): boolean {
  if (/^[A-Z]{6}\+/.test(fontName)) return false;
  if (!/^(Helvetica|Arial|Times ?New ?Roman|Times|Courier ?New|Courier)([ ,._-].*)?$/i.test(fontName)) {
    return false;
  }
  // Printable Latin-1 plus the common typographic marks of WinAnsi (checked
  // by code point so no literal special characters live in the source).
  return chars.every((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return (
      (cp >= 0x20 && cp <= 0x7e) ||
      (cp >= 0xa0 && cp <= 0xff) ||
      [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026].includes(cp)
    );
  });
}

// Standard-14 font names by [regular, bold, italic, bold-italic].
export const STD_FONT_NAMES: Record<string, [string, string, string, string]> = {
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};
export const BUNDLED_FONT_FILES: Record<string, [string, string, string, string]> = {
  carlito: [
    "/fonts/Carlito-Regular.ttf",
    "/fonts/Carlito-Bold.ttf",
    "/fonts/Carlito-Italic.ttf",
    "/fonts/Carlito-BoldItalic.ttf",
  ],
  caladea: [
    "/fonts/Caladea-Regular.ttf",
    "/fonts/Caladea-Bold.ttf",
    "/fonts/Caladea-Italic.ttf",
    "/fonts/Caladea-BoldItalic.ttf",
  ],
  roboto: [
    "/fonts/Roboto-Regular.ttf",
    "/fonts/Roboto-Bold.ttf",
    "/fonts/Roboto-Italic.ttf",
    "/fonts/Roboto-BoldItalic.ttf",
  ],
  opensans: [
    "/fonts/OpenSans-Regular.ttf",
    "/fonts/OpenSans-Bold.ttf",
    "/fonts/OpenSans-Italic.ttf",
    "/fonts/OpenSans-BoldItalic.ttf",
  ],
  montserrat: [
    "/fonts/Montserrat-Regular.ttf",
    "/fonts/Montserrat-Bold.ttf",
    "/fonts/Montserrat-Italic.ttf",
    "/fonts/Montserrat-BoldItalic.ttf",
  ],
  lora: [
    "/fonts/Lora-Regular.ttf",
    "/fonts/Lora-Bold.ttf",
    "/fonts/Lora-Italic.ttf",
    "/fonts/Lora-BoldItalic.ttf",
  ],
};
export const FONT_CSS: Record<string, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
  carlito: "Carlito, Calibri, sans-serif",
  caladea: "Caladea, Cambria, serif",
  roboto: "Roboto, Arial, sans-serif",
  opensans: "'Open Sans', Arial, sans-serif",
  montserrat: "Montserrat, Arial, sans-serif",
  lora: "Lora, Georgia, serif",
};

/** Best-effort family/weight/slant from a PDF base font name. */
export function detectFontFromName(name: string): { family: string; bold: boolean; italic: boolean } {
  const n = name.replace(/^[A-Z]{6}\+/, "");
  let family = "helvetica";
  if (/calibri|carlito/i.test(n)) family = "carlito";
  else if (/cambria|caladea/i.test(n)) family = "caladea";
  else if (/courier|mono/i.test(n)) family = "courier";
  else if (/times|georgia|garamond|roman|serif/i.test(n) && !/sans/i.test(n)) family = "times";
  return {
    family,
    bold: /bold|black|heavy|semib|demib/i.test(n),
    italic: /italic|oblique/i.test(n),
  };
}

/** Resolve a family+weight+slant to a PDFium font (standard name or TTF bytes). */
export async function resolveTextFont(
  family: string,
  bold: boolean,
  italic: boolean,
): Promise<{ standardName?: string; bytes?: Uint8Array }> {
  const idx = (bold ? 1 : 0) + (italic ? 2 : 0);
  if (STD_FONT_NAMES[family]) return { standardName: STD_FONT_NAMES[family][idx] };
  const files = BUNDLED_FONT_FILES[family];
  if (files) {
    try {
      const bytes = new Uint8Array(await (await fetch(files[idx])).arrayBuffer());
      return { bytes };
    } catch {
      /* fall back to the metric-compatible standard font */
    }
  }
  const sub = family === "caladea" || family === "lora" ? "times" : "helvetica";
  return { standardName: STD_FONT_NAMES[sub][idx] };
}

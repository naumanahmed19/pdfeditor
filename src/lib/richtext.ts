// Rich-text run helpers for text annotations. A text box is either plain
// (box-level style applies to all of `ann.text`) or rich (`ann.runs` holds
// styled spans). These pure helpers are shared by the editor, the on-screen
// display, size measurement and PDF baking — no React or DOM-framework deps.
import type { FontFamilyKind, TextAnnotation, TextRun } from "../types";

export interface ResolvedStyle {
  color: string;
  fontSize: number;
  fontFamily: FontFamilyKind;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export const FONT_CSS: Record<FontFamilyKind, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
  carlito: "Carlito, Calibri, sans-serif",
  caladea: "Caladea, Cambria, serif",
};

/** A run's style with the box-level defaults filled in. */
export function resolveRun(run: Partial<TextRun>, ann: TextAnnotation): ResolvedStyle {
  return {
    color: run.color ?? ann.color,
    fontSize: run.fontSize ?? ann.fontSize,
    fontFamily: run.fontFamily ?? ann.fontFamily ?? "helvetica",
    bold: run.bold ?? !!ann.bold,
    italic: run.italic ?? !!ann.italic,
    underline: run.underline ?? !!ann.underline,
    strike: run.strike ?? !!ann.strike,
  };
}

/** Always returns runs (a plain box becomes one run of its whole text). */
export function getRuns(ann: TextAnnotation): TextRun[] {
  if (ann.runs && ann.runs.length) return ann.runs;
  return [{ text: ann.text }];
}

export function runsText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join("");
}

function styleKey(r: TextRun): string {
  return [r.color, r.fontSize, r.fontFamily, r.bold, r.italic, r.underline, r.strike].join("|");
}

/** Merge adjacent runs with identical styling; drop empties. */
export function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && styleKey(last) === styleKey(r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Apply a style patch to the character range [start, end) across runs,
 * splitting runs at the boundaries. Passing `undefined` for a field clears it.
 */
export function applyStyleToRange(
  runs: TextRun[],
  start: number,
  end: number,
  patch: Partial<Omit<TextRun, "text">>,
): TextRun[] {
  if (end <= start) return runs;
  const out: TextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const rStart = pos;
    const rEnd = pos + run.text.length;
    pos = rEnd;
    if (rEnd <= start || rStart >= end) {
      out.push({ ...run });
      continue;
    }
    // Split the run into before / inside / after the selection.
    const a = Math.max(start, rStart) - rStart;
    const b = Math.min(end, rEnd) - rStart;
    if (a > 0) out.push({ ...run, text: run.text.slice(0, a) });
    const inside: TextRun = { ...run, text: run.text.slice(a, b), ...patch };
    // Remove keys explicitly set to undefined so they inherit the box style.
    const insideRec = inside as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      if ((patch as Record<string, unknown>)[k] === undefined) delete insideRec[k];
    }
    out.push(inside);
    if (b < run.text.length) out.push({ ...run, text: run.text.slice(b) });
  }
  return mergeRuns(out);
}

/**
 * The uniform resolved value of `key` across [start, end) (or the run at the
 * caret when collapsed); undefined if it varies — used to show the controls'
 * current state for a selection.
 */
export function rangeStyleValue<K extends keyof ResolvedStyle>(
  runs: TextRun[],
  start: number,
  end: number,
  key: K,
  ann: TextAnnotation,
): ResolvedStyle[K] | undefined {
  const s = end <= start ? Math.max(0, start - 1) : start;
  const e = end <= start ? s + 1 : end;
  let seen: ResolvedStyle[K] | undefined;
  let found = false;
  let pos = 0;
  for (const run of runs) {
    const rStart = pos;
    const rEnd = pos + run.text.length;
    pos = rEnd;
    if (rEnd <= s || rStart >= e) continue;
    const v = resolveRun(run, ann)[key];
    if (!found) {
      seen = v;
      found = true;
    } else if (seen !== v) {
      return undefined;
    }
  }
  return seen;
}

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => escapes[c]);
}

/**
 * Build the editor/display HTML for runs. Each run is a <span> carrying both
 * inline CSS (for rendering at `scale`) and data-* attributes (scale-free, so
 * parsing back to runs never has to divide by scale). Newlines become <br>.
 */
export function runsToHtml(
  runs: TextRun[],
  ann: TextAnnotation,
  scale: number,
): string {
  const parts: string[] = [];
  for (const run of runs) {
    const s = resolveRun(run, ann);
    const deco =
      [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") ||
      "none";
    const css =
      `color:${s.color};` +
      `font-size:${s.fontSize * scale}px;` +
      `font-family:${ann.displayFontCss || FONT_CSS[s.fontFamily]};` +
      `font-weight:${s.bold ? 700 : 400};` +
      `font-style:${s.italic ? "italic" : "normal"};` +
      `text-decoration:${deco};`;
    const data =
      `data-c="${s.color}" data-s="${s.fontSize}" data-f="${s.fontFamily}"` +
      ` data-b="${s.bold ? 1 : 0}" data-i="${s.italic ? 1 : 0}"` +
      ` data-u="${s.underline ? 1 : 0}" data-st="${s.strike ? 1 : 0}"`;
    const html = esc(run.text).replace(/\n/g, "<br>");
    parts.push(`<span style="${css}" ${data}>${html || "​"}</span>`);
  }
  return parts.join("");
}

function readSpanStyle(el: HTMLElement): Partial<TextRun> {
  const out: Partial<TextRun> = {};
  const c = el.getAttribute("data-c");
  const s = el.getAttribute("data-s");
  const f = el.getAttribute("data-f");
  const b = el.getAttribute("data-b");
  const i = el.getAttribute("data-i");
  const u = el.getAttribute("data-u");
  const st = el.getAttribute("data-st");
  if (c) out.color = c;
  if (s) out.fontSize = Number(s);
  if (f) out.fontFamily = f as FontFamilyKind;
  if (b !== null) out.bold = b === "1";
  if (i !== null) out.italic = i === "1";
  if (u !== null) out.underline = u === "1";
  if (st !== null) out.strike = st === "1";
  return out;
}

/** Read a contentEditable root back into runs (relative to `ann` defaults). */
export function parseEditorRuns(root: HTMLElement, ann: TextAnnotation): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (node: Node, inherited: Partial<TextRun>) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/​/g, "");
        if (text) runs.push({ ...inherited, text });
      } else if (child instanceof HTMLElement) {
        if (child.tagName === "BR") {
          runs.push({ ...inherited, text: "\n" });
        } else {
          walk(child, { ...inherited, ...readSpanStyle(child) });
        }
      }
    }
  };
  walk(root, {});
  // Strip run fields that match the box style so plain boxes stay plain.
  const cleaned = runs.map((r) => {
    const o: TextRun = { text: r.text };
    if (r.color !== undefined && r.color !== ann.color) o.color = r.color;
    if (r.fontSize !== undefined && r.fontSize !== ann.fontSize) o.fontSize = r.fontSize;
    if (r.fontFamily !== undefined && r.fontFamily !== (ann.fontFamily ?? "helvetica"))
      o.fontFamily = r.fontFamily;
    if (r.bold !== undefined && r.bold !== !!ann.bold) o.bold = r.bold;
    if (r.italic !== undefined && r.italic !== !!ann.italic) o.italic = r.italic;
    if (r.underline !== undefined && r.underline !== !!ann.underline) o.underline = r.underline;
    if (r.strike !== undefined && r.strike !== !!ann.strike) o.strike = r.strike;
    return o;
  });
  return mergeRuns(cleaned);
}

/** Character offset of the current selection within `root` (BR counts as 1). */
export function getSelectionOffsets(
  root: HTMLElement,
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const offsetOf = (container: Node, offset: number): number => {
    let count = 0;
    let done = false;
    const walk = (node: Node) => {
      if (done) return;
      if (node === container && node.nodeType === Node.TEXT_NODE) {
        count += Math.min(offset, (node.textContent ?? "").replace(/​/g, "").length);
        done = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        count += (node.textContent ?? "").replace(/​/g, "").length;
      } else if (node instanceof HTMLElement && node.tagName === "BR") {
        count += 1;
      }
      if (node === container && node.nodeType !== Node.TEXT_NODE) {
        // Element container: offset counts child nodes before the caret.
        let i = 0;
        for (const c of Array.from(node.childNodes)) {
          if (i++ >= offset) break;
          walk(c);
        }
        done = true;
        return;
      }
      for (const c of Array.from(node.childNodes)) walk(c);
    };
    walk(root);
    return count;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** Restore a selection by character offsets within `root`. */
export function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const find = (target: number): { node: Node; offset: number } => {
    let count = 0;
    let result: { node: Node; offset: number } | null = null;
    const walk = (node: Node) => {
      if (result) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.textContent ?? "").replace(/​/g, "").length;
        if (count + len >= target) {
          result = { node, offset: target - count };
          return;
        }
        count += len;
      } else if (node instanceof HTMLElement && node.tagName === "BR") {
        if (count + 1 > target) {
          result = { node: node.parentNode!, offset: 0 };
          return;
        }
        count += 1;
      }
      for (const c of Array.from(node.childNodes)) walk(c);
    };
    walk(root);
    return result ?? { node: root, offset: root.childNodes.length };
  };
  const a = find(start);
  const b = find(end);
  const range = document.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* offsets out of range — ignore */
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ctxFont(s: ResolvedStyle, ann: TextAnnotation): string {
  return `${s.italic ? "italic " : ""}${s.bold ? "700 " : "400 "}${s.fontSize}px ${
    ann.displayFontCss || FONT_CSS[s.fontFamily]
  }`;
}

/**
 * Lay out rich runs into lines (wrapping at maxWidthPts), returning the box
 * width/height in PDF points. Uses per-run fonts so mixed sizes measure right.
 */
export function measureRichText(
  ann: TextAnnotation,
  runs: TextRun[],
  maxWidthPts: number,
): { w: number; h: number } {
  const ctx = (measureCtx ??= document.createElement("canvas").getContext("2d"));
  if (!ctx) return { w: ann.w, h: ann.h };
  const pad = ann.fontSize * 0.3 + 3;

  // Flatten runs into styled words split on spaces and newlines.
  type Tok = { text: string; nl: boolean; s: ResolvedStyle };
  const toks: Tok[] = [];
  for (const run of runs) {
    const s = resolveRun(run, ann);
    const pieces = run.text.split(/(\n)/);
    for (const p of pieces) {
      if (p === "") continue;
      if (p === "\n") toks.push({ text: "", nl: true, s });
      else {
        for (const w of p.split(/(\s+)/)) if (w) toks.push({ text: w, nl: false, s });
      }
    }
  }
  // Empty content: keep the box at its placed width (rather than collapsing
  // to a tiny nub) so the "start typing" placeholder has room to render.
  if (!toks.length) {
    return {
      w: Math.min(maxWidthPts, Math.max(ann.fontSize * 2, ann.w, pad)),
      h: ann.fontSize * 1.25 + 3,
    };
  }

  const usable = maxWidthPts - pad;
  let widest = 0;
  let lineW = 0;
  let lineMax = 0; // max fontSize on the current line
  let totalH = 0;
  const flush = () => {
    widest = Math.max(widest, lineW);
    totalH += (lineMax || ann.fontSize) * 1.25;
    lineW = 0;
    lineMax = 0;
  };
  for (const t of toks) {
    if (t.nl) {
      flush();
      continue;
    }
    ctx.font = ctxFont(t.s, ann);
    const w = ctx.measureText(t.text).width;
    if (lineW > 0 && lineW + w > usable) flush();
    lineW += w;
    lineMax = Math.max(lineMax, t.s.fontSize);
  }
  flush();
  return { w: Math.min(maxWidthPts, Math.max(ann.fontSize * 2, widest + pad)), h: totalH + 3 };
}

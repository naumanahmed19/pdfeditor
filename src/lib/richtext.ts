// Rich-text run helpers for text annotations. A text box is either plain
// (box-level style applies to all of `ann.text`) or rich (`ann.runs` holds
// styled spans). These pure helpers are shared by the editor, the on-screen
// display, size measurement and PDF baking — no React or DOM-framework deps.
import type { BlockKind, FontFamilyKind, TextAnnotation, TextBlock, TextRun } from "../types";
import { LINK_COLOR } from "./linktarget";

/** A display/bake-time clone of a linked text box, restyled as a hyperlink
 *  (blue + underline) across the box and every run. Derived from `ann.link`,
 *  so the stored colors are untouched and removing the link restores them. */
export function linkStyledText(ann: TextAnnotation): TextAnnotation {
  const restyle = (r: TextRun): TextRun => ({ ...r, color: LINK_COLOR, underline: true });
  return {
    ...ann,
    color: LINK_COLOR,
    underline: true,
    runs: ann.runs?.map(restyle),
    blocks: ann.blocks?.map((b) => ({ ...b, runs: b.runs.map(restyle) })),
  };
}

export interface ResolvedStyle {
  color: string;
  fontSize: number;
  fontFamily: FontFamilyKind;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/** Default line-height multiplier for a text box when `lineHeight` is unset. */
export const DEFAULT_LINE_HEIGHT = 1.25;

export const FONT_CSS: Record<FontFamilyKind, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
  carlito: "Carlito, Calibri, sans-serif",
  caladea: "Caladea, Cambria, serif",
  roboto: "Roboto, Arial, sans-serif",
  opensans: "'Open Sans', Arial, sans-serif",
  montserrat: "Montserrat, Arial, sans-serif",
  lora: "Lora, Georgia, serif",
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
  const lh = ann.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const ls = ann.letterSpacing ?? 0;

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
      h: ann.fontSize * lh + 3,
    };
  }

  const usable = maxWidthPts - pad;
  let widest = 0;
  let lineW = 0;
  let lineMax = 0; // max fontSize on the current line
  let totalH = 0;
  const flush = () => {
    widest = Math.max(widest, lineW);
    totalH += (lineMax || ann.fontSize) * lh;
    lineW = 0;
    lineMax = 0;
  };
  for (const t of toks) {
    if (t.nl) {
      flush();
      continue;
    }
    ctx.font = ctxFont(t.s, ann);
    // Letter-spacing adds `ls` after every glyph (CSS applies it per char).
    const w = ctx.measureText(t.text).width + ls * t.text.length;
    if (lineW > 0 && lineW + w > usable) flush();
    lineW += w;
    lineMax = Math.max(lineMax, t.s.fontSize);
  }
  flush();
  return { w: Math.min(maxWidthPts, Math.max(ann.fontSize * 2, widest + pad)), h: totalH + 3 };
}

/* ------------------------------------------------------------------ */
/* Block layer: headings + nested lists on top of the inline run model */
/* ------------------------------------------------------------------ */

/** Heading font-size multipliers (× box fontSize); all headings render bold. */
export const HEADING_SCALE: Record<string, number> = { h1: 1.7, h2: 1.4, h3: 1.15 };
/** Indent added per list nesting level, in PDF points. */
export const LIST_INDENT_PTS = 22;
/** Gap between a list marker and its text, in PDF points. */
export const LIST_MARKER_GAP_PTS = 5;
const BULLET_GLYPHS = ["•", "◦", "▪"];

/** Blocks for a text box: `ann.blocks` when present, else plain paragraphs
 *  derived from the flat runs (splitting on "\n"). */
export function getBlocks(ann: TextAnnotation): TextBlock[] {
  if (ann.blocks && ann.blocks.length) return ann.blocks;
  const runs = getRuns(ann);
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...run, text: part });
    });
  }
  return lines.map((r) => ({ kind: "p" as const, runs: r }));
}

/** Plain text of all blocks (newline-separated), for search/extract/bake fallback. */
export function blocksPlainText(blocks: TextBlock[]): string {
  return blocks.map((b) => runsText(b.runs)).join("\n");
}

/** Whether a text box has any real content across its blocks. */
export function blocksHaveText(blocks: TextBlock[]): boolean {
  return blocks.some((b) => runsText(b.runs).trim() !== "");
}

const HEADING_KINDS: BlockKind[] = ["h1", "h2", "h3"];

/** Resolve a run's style within a block — headings force a scaled, bold size. */
export function resolveBlockRun(
  run: Partial<TextRun>,
  block: TextBlock,
  ann: TextAnnotation,
): ResolvedStyle {
  const base = resolveRun(run, ann);
  if (HEADING_KINDS.includes(block.kind)) {
    return { ...base, fontSize: ann.fontSize * HEADING_SCALE[block.kind], bold: true };
  }
  return base;
}

/** The base font size a block renders at (drives spacing & marker sizing). */
export function blockFontSize(block: TextBlock, ann: TextAnnotation): number {
  return HEADING_KINDS.includes(block.kind)
    ? ann.fontSize * HEADING_SCALE[block.kind]
    : ann.fontSize;
}

/** List markers per block ("" for non-list); nested numbering restarts per
 *  sublist. Used by the PDF bake and by measurement (marker width). */
export function computeMarkers(blocks: TextBlock[]): string[] {
  const counters: number[] = []; // decimal counter per indent level
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind !== "li") {
      out.push("");
      counters.length = 0; // any non-list block breaks numbering
      continue;
    }
    const indent = Math.max(0, b.indent ?? 0);
    counters.length = indent + 1; // drop deeper counters when we come back out
    if (b.list === "numbered") {
      counters[indent] = (counters[indent] ?? 0) + 1;
      out.push(`${counters[indent]}.`);
    } else {
      counters[indent] = 0;
      out.push(BULLET_GLYPHS[indent % BULLET_GLYPHS.length]);
    }
  }
  return out;
}

/** A structural change applied to the blocks spanned by the selection. */
export type BlockOp =
  | { type: "kind"; kind: "p" | "h1" | "h2" | "h3" }
  | { type: "list"; list: "bullet" | "numbered" }
  | { type: "indent"; delta: 1 | -1 };

const MAX_LIST_INDENT = 5;

/**
 * Apply a structural op to blocks [start, end] (pure — no DOM). Toggling a list
 * off when all selected items already use it converts them back to paragraphs;
 * out-denting a top-level item likewise drops it to a paragraph. Run content is
 * always preserved (this is what makes "convert to bullets" non-destructive).
 */
export function applyBlockOp(
  blocks: TextBlock[],
  start: number,
  end: number,
  op: BlockOp,
): TextBlock[] {
  const selected = blocks.slice(start, end + 1);
  return blocks.map((b, i) => {
    if (i < start || i > end) return b;
    if (op.type === "kind") return { kind: op.kind, runs: b.runs };
    if (op.type === "list") {
      const allThisList = selected.every((x) => x.kind === "li" && x.list === op.list);
      return allThisList
        ? { kind: "p", runs: b.runs }
        : { kind: "li", list: op.list, indent: b.indent ?? 0, runs: b.runs };
    }
    if (b.kind !== "li") return b;
    if (op.delta === 1) return { ...b, indent: Math.min(MAX_LIST_INDENT, (b.indent ?? 0) + 1) };
    const next = (b.indent ?? 0) - 1;
    return next < 0 ? { kind: "p", runs: b.runs } : { ...b, indent: next };
  });
}

/** Inline spans for a block's runs. In `semantic` mode the base font-size is
 *  omitted (so the block tag / container controls it — headings inherit their
 *  size, list items inherit the base); only run-level overrides are emitted. */
function blockInlineHtml(
  block: TextBlock,
  ann: TextAnnotation,
  scale: number,
  semantic: boolean,
): string {
  if (!block.runs.length) return "<br>";
  const parts: string[] = [];
  for (const run of block.runs) {
    const s = resolveBlockRun(run, block, ann);
    const deco =
      [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || "none";
    // In semantic mode, only emit font-size when this run overrides the box size
    // and the block isn't a heading (headings size via their tag).
    const emitSize = !semantic || (!HEADING_KINDS.includes(block.kind) && run.fontSize !== undefined);
    const css =
      `color:${s.color};` +
      (emitSize ? `font-size:${s.fontSize * scale}px;` : "") +
      `font-family:${ann.displayFontCss || FONT_CSS[s.fontFamily]};` +
      `font-weight:${s.bold ? 700 : 400};` +
      `font-style:${s.italic ? "italic" : "normal"};` +
      `text-decoration:${deco};`;
    const data =
      `data-c="${s.color}" data-s="${s.fontSize}" data-f="${s.fontFamily}"` +
      ` data-b="${s.bold ? 1 : 0}" data-i="${s.italic ? 1 : 0}"` +
      ` data-u="${s.underline ? 1 : 0}" data-st="${s.strike ? 1 : 0}"`;
    parts.push(`<span style="${css}" ${data}>${esc(run.text) || "​"}</span>`);
  }
  return parts.join("");
}

/**
 * Render blocks to semantic HTML (`<h1>`, nested `<ul>/<ol>` with `<li>`) used
 * for BOTH the contentEditable editor and the on-screen display — the browser
 * draws list markers, nesting and numbering natively. `fontSize` on the wrapper
 * (set by the caller) scales headings (em-based) and list markers with zoom.
 */
export function blocksToSemanticHtml(blocks: TextBlock[], ann: TextAnnotation, scale: number): string {
  const out: string[] = [];
  // Stack of open list contexts: { tag, indent }.
  const stack: Array<{ tag: "ul" | "ol"; indent: number }> = [];
  const closeTo = (indent: number, sameTag?: "ul" | "ol") => {
    while (
      stack.length &&
      (stack[stack.length - 1].indent > indent ||
        (stack[stack.length - 1].indent === indent && sameTag && stack[stack.length - 1].tag !== sameTag))
    ) {
      out.push(`</li></${stack.pop()!.tag}>`);
    }
  };
  const closeAll = () => {
    while (stack.length) out.push(`</li></${stack.pop()!.tag}>`);
  };

  for (const b of blocks) {
    if (b.kind === "li") {
      const indent = Math.max(0, b.indent ?? 0);
      const tag = b.list === "numbered" ? "ol" : "ul";
      closeTo(indent, tag);
      const top = stack[stack.length - 1];
      if (top && top.indent === indent && top.tag === tag) {
        out.push(`</li><li>`);
      } else {
        // Open deeper (or first) list level.
        out.push(`<${tag}><li>`);
        stack.push({ tag, indent });
      }
      out.push(blockInlineHtml(b, ann, scale, true));
    } else {
      closeAll();
      const tag = b.kind === "p" ? "p" : b.kind; // h1/h2/h3/p
      out.push(`<${tag}>${blockInlineHtml(b, ann, scale, true)}</${tag}>`);
    }
  }
  closeAll();
  return out.join("");
}

function readSpanStyleBlock(el: HTMLElement): Partial<TextRun> {
  return readSpanStyle(el);
}

/**
 * Parse a contentEditable root (semantic HTML from native editing) back into
 * blocks. Recurses `<ul>/<ol>` for nesting/indent, reads `<h1..3>` as headings,
 * everything else as paragraphs. Inline styling comes from the run spans.
 */
export function parseEditorBlocks(root: HTMLElement, ann: TextAnnotation): TextBlock[] {
  const blocks: TextBlock[] = [];

  const readRuns = (el: HTMLElement): TextRun[] => {
    const runs: TextRun[] = [];
    const walk = (node: Node, inherited: Partial<TextRun>) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = (child.textContent ?? "").replace(/​/g, "");
          if (t) runs.push({ ...inherited, text: t });
        } else if (child instanceof HTMLElement) {
          const tag = child.tagName;
          if (tag === "BR") {
            /* placeholder <br> in an empty/last line — carries no content */
          } else if (tag === "UL" || tag === "OL" || tag === "LI") {
            /* nested list handled by the block walker, skip here */
          } else {
            const style = { ...inherited, ...readSpanStyleBlock(child) };
            // Bare <b>/<i>/<u>/<s> from execCommand carry semantics too.
            if (tag === "B" || tag === "STRONG") style.bold = true;
            if (tag === "I" || tag === "EM") style.italic = true;
            if (tag === "U") style.underline = true;
            if (tag === "S" || tag === "STRIKE" || tag === "DEL") style.strike = true;
            walk(child, style);
          }
        }
      }
    };
    walk(el, {});
    return runs;
  };

  const clean = (runs: TextRun[], heading: boolean): TextRun[] =>
    mergeRuns(
      runs.map((r) => {
        const o: TextRun = { text: r.text };
        if (r.color !== undefined && r.color !== ann.color) o.color = r.color;
        // Heading size/bold come from the block; don't persist them per-run.
        if (!heading) {
          if (r.fontSize !== undefined && r.fontSize !== ann.fontSize) o.fontSize = r.fontSize;
          if (r.bold !== undefined && r.bold !== !!ann.bold) o.bold = r.bold;
        }
        if (r.fontFamily !== undefined && r.fontFamily !== (ann.fontFamily ?? "helvetica"))
          o.fontFamily = r.fontFamily;
        if (r.italic !== undefined && r.italic !== !!ann.italic) o.italic = r.italic;
        if (r.underline !== undefined && r.underline !== !!ann.underline) o.underline = r.underline;
        if (r.strike !== undefined && r.strike !== !!ann.strike) o.strike = r.strike;
        return o;
      }),
    );

  const walkList = (listEl: HTMLElement, list: "bullet" | "numbered", indent: number) => {
    for (const li of Array.from(listEl.children)) {
      if (!(li instanceof HTMLElement) || li.tagName !== "LI") continue;
      blocks.push({ kind: "li", list, indent, runs: clean(readRuns(li), false) });
      // Nested lists inside this <li>.
      for (const child of Array.from(li.children)) {
        if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) {
          walkList(child, child.tagName === "OL" ? "numbered" : "bullet", indent + 1);
        }
      }
    }
  };

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/​/g, "");
      if (t.trim()) blocks.push({ kind: "p", runs: clean([{ text: t }], false) });
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName;
    if (tag === "UL" || tag === "OL") {
      walkList(node, tag === "OL" ? "numbered" : "bullet", 0);
    } else if (tag === "H1" || tag === "H2" || tag === "H3") {
      blocks.push({ kind: tag.toLowerCase() as BlockKind, runs: clean(readRuns(node), true) });
    } else {
      // <p>, <div>, or bare inline content → a paragraph.
      blocks.push({ kind: "p", runs: clean(readRuns(node), false) });
    }
  }
  // Never return zero blocks (keeps an empty box editable).
  return blocks.length ? blocks : [{ kind: "p", runs: [] }];
}

/**
 * Lay blocks out into lines (headings scaled, list items indented with a
 * hanging marker column) and return the box width/height in PDF points.
 */
export function measureBlocks(
  ann: TextAnnotation,
  blocks: TextBlock[],
  maxWidthPts: number,
): { w: number; h: number } {
  const ctx = (measureCtx ??= document.createElement("canvas").getContext("2d"));
  if (!ctx) return { w: ann.w, h: ann.h };
  const pad = ann.fontSize * 0.3 + 3;
  const lh = ann.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const ls = ann.letterSpacing ?? 0;
  const markers = computeMarkers(blocks);

  if (!blocksHaveText(blocks)) {
    return {
      w: Math.min(maxWidthPts, Math.max(ann.fontSize * 2, ann.w, pad)),
      h: ann.fontSize * lh + 3,
    };
  }

  let widest = 0;
  let totalH = 0;
  blocks.forEach((b, bi) => {
    const isHeading = HEADING_KINDS.includes(b.kind);
    const bfs = blockFontSize(b, ann);
    const indentX = b.kind === "li" ? (b.indent ?? 0) * LIST_INDENT_PTS : 0;
    let markerW = 0;
    if (b.kind === "li") {
      ctx.font = `700 ${bfs}px ${ann.displayFontCss || FONT_CSS[ann.fontFamily ?? "helvetica"]}`;
      markerW = ctx.measureText(markers[bi]).width + LIST_MARKER_GAP_PTS;
    }
    const textX = indentX + markerW;
    const usable = maxWidthPts - pad - textX;

    // Tokenise this block's runs.
    type Tok = { text: string; s: ResolvedStyle };
    const toks: Tok[] = [];
    for (const run of b.runs) {
      const s = resolveBlockRun(run, b, ann);
      for (const w of run.text.split(/(\s+)/)) if (w) toks.push({ text: w, s });
    }
    let lineW = 0;
    let lineMax = 0;
    let lines = 0;
    const flush = () => {
      widest = Math.max(widest, textX + lineW);
      totalH += (lineMax || bfs) * lh;
      lineW = 0;
      lineMax = 0;
      lines++;
    };
    for (const t of toks) {
      ctx.font = ctxFont(t.s, ann);
      const w = ctx.measureText(t.text).width + ls * t.text.length;
      if (lineW > 0 && lineW + w > usable) flush();
      lineW += w;
      lineMax = Math.max(lineMax, t.s.fontSize);
    }
    flush();
    if (lines === 0) totalH += bfs * lh;
    // Extra breathing room above headings (except the first block).
    if (isHeading && bi > 0) totalH += bfs * 0.3;
  });

  return { w: Math.min(maxWidthPts, Math.max(ann.fontSize * 2, widest + pad)), h: totalH + 3 };
}

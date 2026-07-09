// Word-like text selection for the PDF text layer.
//
// Native browser selection over the absolutely-positioned .textLayer spans is
// unreliable: spans only cover the glyph rectangles, so a cursor a few pixels
// above or below a line hit-tests against empty container space and the
// browser's nearest-position fallback jumps to unrelated text (another line,
// or same-row text in the next column). Instead of relying on browser
// hit-testing, this module resolves carets from PDFium character geometry —
// line snapping, column awareness — and writes the result into the REAL
// document selection via Selection.setBaseAndExtent. Painting (::selection),
// native copy, the AI "selected text" actions and the mark-on-mouseup
// pipeline all keep consuming a plain native selection.
//
// Everything above attachTextSelection is pure geometry (unit-testable
// without a browser); only the controller at the bottom touches the DOM.

// ---------------------------------------------------------------------------
// Character segmentation (page space) — used by engine.getTextRuns()
// ---------------------------------------------------------------------------

/** A char from the PDFium walk. Box in any space where text lines run
 *  horizontally (PDF page space qualifies — the overlap/gap math is
 *  y-direction agnostic). `s` is the full code point (1–2 UTF-16 units). */
export interface SegChar {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** PDFium emitted a line-break marker (\r\n) right before this char. */
  br?: boolean;
}

function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/** Distance from `p` to the interval [a, b] (0 when inside). */
function axisDist(p: number, a: number, b: number): number {
  return p < a ? a - p : p > b ? p - b : 0;
}

/**
 * Give degenerate boxes (PDFium-generated spaces, zero-width marks) usable
 * geometry synthesized from their neighbors, so segmentation and caret
 * hit-testing see a sane box. Mutates in place.
 */
export function fixDegenerateBoxes(chars: SegChar[]): void {
  const usable = (c?: SegChar): SegChar | undefined =>
    c && c.w > 0 && c.h > 0 ? c : undefined;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (usable(c)) continue;
    const prev = usable(i > 0 ? chars[i - 1] : undefined);
    const next = usable(chars[i + 1]);
    const between =
      !c.br &&
      !!prev &&
      !!next &&
      !next.br &&
      overlap1D(prev.y, prev.y + prev.h, next.y, next.y + next.h) > 0 &&
      next.x >= prev.x + prev.w;
    if (between) {
      // A generated space between two words: fill the gap.
      c.x = prev.x + prev.w;
      c.w = Math.max(0, next.x - c.x);
      c.y = Math.min(prev.y, next.y);
      c.h = Math.max(prev.y + prev.h, next.y + next.h) - c.y;
    } else if (!c.br && prev) {
      c.x = prev.x + prev.w;
      c.y = prev.y;
      c.h = prev.h;
      c.w = Math.max(0.1, prev.h * 0.25);
    } else if (next) {
      c.w = Math.max(0.1, next.h * 0.25);
      c.x = next.x - c.w;
      c.y = next.y;
      c.h = next.h;
    }
    // No reference geometry at all: leave the zero box; a run whose union is
    // empty is dropped by the caller.
  }
}

/**
 * Group a char walk into single-line runs. Breaks on PDFium line markers, on
 * leaving the line's accumulated vertical band, and on horizontal gaps large
 * enough to be a tab stop or column gutter. The gap test is symmetric so RTL
 * progression doesn't split every character pair.
 */
export function segmentChars<T extends SegChar>(chars: T[]): T[][] {
  const runs: T[][] = [];
  let cur: T[] = [];
  let b0 = 0; // accumulated line band: min y
  let b1 = 0; // max y+h
  for (const c of chars) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const bandH = b1 - b0;
      const ov = overlap1D(b0, b1, c.y, c.y + c.h);
      const cy = c.y + c.h / 2;
      // Same line when the char meaningfully overlaps the band, or its center
      // sits within it (rescues apostrophes/quotes whose tight box floats
      // above x-height glyphs without overlapping them).
      const sameLine =
        ov >= 0.5 * Math.min(c.h, bandH) ||
        (cy >= b0 - 0.2 * bandH && cy <= b1 + 0.2 * bandH);
      const gap = Math.max(c.x - (last.x + last.w), last.x - (c.x + c.w));
      if (c.br || !sameLine || gap > 1.2 * Math.max(bandH, c.h)) {
        runs.push(cur);
        cur = [];
      }
    }
    if (!cur.length) {
      b0 = c.y;
      b1 = c.y + c.h;
    } else {
      b0 = Math.min(b0, c.y);
      b1 = Math.max(b1, c.y + c.h);
    }
    cur.push(c);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

// ---------------------------------------------------------------------------
// Selection geometry (text-layer space, CSS px at the rendered scale)
// ---------------------------------------------------------------------------

/** Per-character box aligned 1:1 with UTF-16 indices of the run text.
 *  `cont` marks a surrogate-pair tail (zero-width continuation) so carets
 *  never land inside a pair. */
export interface CharBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cont?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelRun {
  span: HTMLElement;
  text: string;
  chars: CharBox[];
  rect: Rect;
  /** +1 = text advances along the main axis (LTR / top-down), -1 = reversed. */
  dir: 1 | -1;
}

export interface SelLine {
  rect: Rect;
  runs: SelRun[];
  /** True when the line runs vertically on screen (rotated page). */
  vertical: boolean;
}

/** A caret between characters: line/run indices + UTF-16 offset in the run. */
export interface Caret {
  line: number;
  run: number;
  offset: number;
}

export function compareCaret(a: Caret, b: Caret): number {
  return a.line - b.line || a.run - b.run || a.offset - b.offset;
}

function charCenter(c: CharBox, vertical: boolean): number {
  return vertical ? c.y + c.h / 2 : c.x + c.w / 2;
}

/** First/last real (non-continuation) chars decide the run's direction. */
function runOrientation(chars: CharBox[]): { vertical: boolean; dir: 1 | -1 } {
  const real = chars.filter((c) => !c.cont);
  if (real.length < 2) return { vertical: false, dir: 1 };
  const a = real[0];
  const b = real[real.length - 1];
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const vertical = Math.abs(dy) > Math.abs(dx);
  const d = vertical ? dy : dx;
  return { vertical, dir: d < 0 ? -1 : 1 };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export interface LayerRun {
  span: HTMLElement;
  text: string;
  chars: CharBox[];
  rect: Rect;
  /** XY-cut leaf block the run belongs to — lines never span blocks, which
   *  keeps a column's lines from merging with same-row text next door. */
  block: number;
}

/**
 * Group reading-ordered runs into visual lines. Consecutive runs join a line
 * when they share the block and overlap on the line-stacking axis.
 */
export function buildLines(runs: LayerRun[]): SelLine[] {
  const lines: Array<SelLine & { block: number }> = [];
  for (const r of runs) {
    const { vertical, dir } = runOrientation(r.chars);
    const sr: SelRun = { span: r.span, text: r.text, chars: r.chars, rect: r.rect, dir };
    const cur = lines[lines.length - 1];
    let join = false;
    if (cur && cur.block === r.block && cur.vertical === vertical) {
      const ov = cur.vertical
        ? overlap1D(cur.rect.x, cur.rect.x + cur.rect.w, r.rect.x, r.rect.x + r.rect.w)
        : overlap1D(cur.rect.y, cur.rect.y + cur.rect.h, r.rect.y, r.rect.y + r.rect.h);
      const minSize = Math.min(
        cur.vertical ? cur.rect.w : cur.rect.h,
        cur.vertical ? r.rect.w : r.rect.h,
      );
      join = ov >= 0.5 * minSize;
    }
    if (join && cur) {
      cur.runs.push(sr);
      cur.rect = union(cur.rect, r.rect);
    } else {
      lines.push({ rect: { ...r.rect }, runs: [sr], vertical, block: r.block });
    }
  }
  return lines.map(({ block: _block, ...line }) => line);
}

/**
 * Word-like caret hit-testing. The line-stacking axis dominates the score so
 * a cursor slightly above/below a line stays on it instead of jumping to
 * same-row text in a neighboring column; clamping past the line ends lands on
 * the first/last character boundary.
 */
export function resolveCaret(lines: SelLine[], x: number, y: number): Caret | null {
  if (!lines.length) return null;
  let best = 0;
  let bestScore = Infinity;
  let bestCenter = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const R = lines[i].rect;
    const dx = axisDist(x, R.x, R.x + R.w);
    const dy = axisDist(y, R.y, R.y + R.h);
    const score = lines[i].vertical ? dx * 2.5 + dy : dy * 2.5 + dx;
    const center = Math.hypot(x - (R.x + R.w / 2), y - (R.y + R.h / 2));
    if (score < bestScore - 1e-6 || (score <= bestScore + 1e-6 && center < bestCenter)) {
      best = i;
      bestScore = score;
      bestCenter = center;
    }
  }
  const L = lines[best];
  const pos = L.vertical ? y : x;
  let runIdx = 0;
  let bestD = Infinity;
  for (let j = 0; j < L.runs.length; j++) {
    const r = L.runs[j].rect;
    const a = L.vertical ? r.y : r.x;
    const b = a + (L.vertical ? r.h : r.w);
    const d = axisDist(pos, a, b);
    if (d < bestD) {
      bestD = d;
      runIdx = j;
    }
  }
  const run = L.runs[runIdx];
  return { line: best, run: runIdx, offset: caretOffsetInRun(run, pos, L.vertical) };
}

function caretOffsetInRun(run: SelRun, pos: number, vertical: boolean): number {
  const { chars } = run;
  if (!chars.length) return 0;
  let j = -1;
  let best = Infinity;
  for (let k = 0; k < chars.length; k++) {
    if (chars[k].cont) continue;
    const d = Math.abs(pos - charCenter(chars[k], vertical));
    if (d < best) {
      best = d;
      j = k;
    }
  }
  if (j < 0) return 0;
  const after = run.dir > 0 ? pos > charCenter(chars[j], vertical) : pos < charCenter(chars[j], vertical);
  let off = after ? j + 1 : j;
  while (chars[off]?.cont) off++;
  return Math.min(off, run.text.length);
}

// --- Word / line expansion --------------------------------------------------

type CharClass = "word" | "space" | "other";

function charClass(ch: string): CharClass {
  if (/\s/.test(ch)) return "space";
  if (/[\p{L}\p{N}_]/u.test(ch)) return "word";
  return "other";
}

function globalCaret(L: SelLine, line: number, g: number): Caret {
  let acc = 0;
  for (let i = 0; i < L.runs.length; i++) {
    const len = L.runs[i].text.length;
    if (g <= acc + len) return { line, run: i, offset: g - acc };
    acc += len;
  }
  const last = L.runs.length - 1;
  return { line, run: last, offset: L.runs[last].text.length };
}

/** Expand a caret to the word (or whitespace stretch) under it, within its
 *  visual line — runs are crossed freely, matching how the line reads. */
export function wordRangeAt(lines: SelLine[], caret: Caret): { start: Caret; end: Caret } {
  const L = lines[caret.line];
  if (!L) return { start: caret, end: caret };
  let g = caret.offset;
  for (let i = 0; i < caret.run; i++) g += L.runs[i].text.length;
  const text = L.runs.map((r) => r.text).join("");
  if (!text.length) return { start: caret, end: caret };
  const i0 = Math.min(g, text.length - 1);
  const cls = charClass(text[i0]);
  let s = i0;
  let e = i0 + 1;
  if (cls !== "other") {
    while (s > 0 && charClass(text[s - 1]) === cls) s--;
    while (e < text.length && charClass(text[e]) === cls) e++;
  }
  return { start: globalCaret(L, caret.line, s), end: globalCaret(L, caret.line, e) };
}

export function lineRangeAt(lines: SelLine[], li: number): { start: Caret; end: Caret } {
  const L = lines[li];
  const last = L.runs.length - 1;
  return {
    start: { line: li, run: 0, offset: 0 },
    end: { line: li, run: last, offset: L.runs[last].text.length },
  };
}

// --- Caret → DOM position ----------------------------------------------------

/** Map a UTF-16 offset in the span's text to a concrete text node + offset.
 *  Walks descendants because search highlighting rewrites span children into
 *  .search-mark sub-spans (textContent stays identical). */
export function domPosition(span: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (offset <= acc + len) return { node: n, offset: offset - acc };
    acc += len;
    last = n;
  }
  return last ? { node: last, offset: last.data.length } : { node: span, offset: 0 };
}

// ---------------------------------------------------------------------------
// DOM controller
// ---------------------------------------------------------------------------

/** Per-text-layer selection geometry, registered by renderTextLayer. */
export const textLayerSelection = new WeakMap<HTMLElement, SelLine[]>();

type Granularity = "char" | "word" | "line";

function caretToDom(lines: SelLine[], caret: Caret): { node: Node; offset: number } | null {
  const L = lines[caret.line];
  const r = L?.runs[caret.run];
  if (!r || !r.span.isConnected) return null;
  return domPosition(r.span, Math.min(caret.offset, r.text.length));
}

/**
 * Take over drag-selection for every .textLayer under `root` (a scroll
 * container). Mouse/pen only — touch keeps the native long-press flow. Layers
 * without registered geometry, in edit-mode, or with pointer-events:none are
 * left to their native behavior.
 */
export function attachTextSelection(root: HTMLElement): () => void {
  let session: {
    layer: HTMLElement;
    anchor: Caret;
    granularity: Granularity;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  // Survives mouseup so shift-click can extend the previous selection.
  let lastAnchor: { layer: HTMLElement; caret: Caret } | null = null;
  let lastEvt: MouseEvent | null = null;
  let raf = 0;

  const selectableLayers = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(".textLayer")).filter(
      (l) =>
        !l.classList.contains("edit-mode") &&
        textLayerSelection.get(l)?.length &&
        getComputedStyle(l).pointerEvents !== "none",
    );

  /** Nearest selectable layer to a client point (same-row pages preferred). */
  const layerAt = (
    cx: number,
    cy: number,
  ): { layer: HTMLElement; x: number; y: number } | null => {
    let best: { layer: HTMLElement; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const layer of selectableLayers()) {
      const rc = layer.getBoundingClientRect();
      if (!rc.width || !rc.height) continue;
      const d = axisDist(cy, rc.top, rc.bottom) * 2 + axisDist(cx, rc.left, rc.right);
      if (d < bestD) {
        bestD = d;
        best = { layer, x: cx - rc.left, y: cy - rc.top };
      }
    }
    return best;
  };

  const unitRange = (layer: HTMLElement, caret: Caret, g: Granularity) => {
    const lines = textLayerSelection.get(layer)!;
    if (g === "word") return wordRangeAt(lines, caret);
    if (g === "line") return lineRangeAt(lines, caret.line);
    return { start: caret, end: caret };
  };

  const apply = (focusLayer: HTMLElement, focus: Caret) => {
    if (!session) return;
    const aLines = textLayerSelection.get(session.layer);
    const fLines = textLayerSelection.get(focusLayer);
    if (!aLines || !fLines) return;
    const a = unitRange(session.layer, session.anchor, session.granularity);
    const f = unitRange(focusLayer, focus, session.granularity);
    const forward =
      focusLayer === session.layer
        ? compareCaret(session.anchor, focus) <= 0
        : !!(
            session.layer.compareDocumentPosition(focusLayer) &
            Node.DOCUMENT_POSITION_FOLLOWING
          );
    const base = caretToDom(aLines, forward ? a.start : a.end);
    const ext = caretToDom(fLines, forward ? f.end : f.start);
    if (!base || !ext) return;
    window.getSelection()?.setBaseAndExtent(base.node, base.offset, ext.node, ext.offset);
  };

  const autoScroll = (e: MouseEvent) => {
    const rc = root.getBoundingClientRect();
    const M = 28;
    if (e.clientY < rc.top + M) {
      root.scrollTop -= Math.min(30, (rc.top + M - e.clientY) * 0.4);
    } else if (e.clientY > rc.bottom - M) {
      root.scrollTop += Math.min(30, (e.clientY - rc.bottom + M) * 0.4);
    }
  };

  // A rAF loop (not per-mousemove work) so selection keeps extending while
  // the pointer sits still past the edge and the container auto-scrolls.
  const tick = () => {
    if (!session) return;
    if (session.moved && lastEvt) {
      autoScroll(lastEvt);
      const hit = layerAt(lastEvt.clientX, lastEvt.clientY);
      if (hit) {
        const caret = resolveCaret(textLayerSelection.get(hit.layer)!, hit.x, hit.y);
        if (caret) apply(hit.layer, caret);
      }
    }
    raf = requestAnimationFrame(tick);
  };

  const onMove = (e: MouseEvent) => {
    lastEvt = e;
    if (
      session &&
      !session.moved &&
      Math.hypot(e.clientX - session.startX, e.clientY - session.startY) >= 3
    ) {
      session.moved = true;
    }
  };

  const onUp = () => {
    session = null;
    lastEvt = null;
    cancelAnimationFrame(raf);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const layer = (e.target as Element | null)?.closest?.(".textLayer") as HTMLElement | null;
    if (!layer || !root.contains(layer) || layer.classList.contains("edit-mode")) return;
    const lines = textLayerSelection.get(layer);
    if (!lines?.length) return; // no geometry — fall back to native selection
    const rc = layer.getBoundingClientRect();
    const caret = resolveCaret(lines, e.clientX - rc.left, e.clientY - rc.top);
    if (!caret) return;
    // Suppress the browser's own anchor placement/drag-selection. The click
    // event (edit-text uses it) still fires.
    e.preventDefault();
    // preventDefault also keeps a focused field focused — blur it like the
    // native mousedown would have.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
      ae.blur();
    }
    const granularity: Granularity = e.detail >= 3 ? "line" : e.detail === 2 ? "word" : "char";
    // A saved anchor can go stale when zoom rebuilds the layer's geometry.
    const anchorValid = (() => {
      if (!lastAnchor?.layer.isConnected) return false;
      const g = textLayerSelection.get(lastAnchor.layer);
      const L = g?.[lastAnchor.caret.line];
      const r = L?.runs[lastAnchor.caret.run];
      return !!r && lastAnchor.caret.offset <= r.text.length;
    })();
    if (e.shiftKey && anchorValid && lastAnchor) {
      // Shift-click: extend from the previous anchor, Word-style.
      session = {
        layer: lastAnchor.layer,
        anchor: lastAnchor.caret,
        granularity,
        startX: e.clientX,
        startY: e.clientY,
        moved: true,
      };
      apply(layer, caret);
    } else {
      session = {
        layer,
        anchor: caret,
        granularity,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      lastAnchor = { layer, caret };
      apply(layer, caret);
    }
    lastEvt = e;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    raf = requestAnimationFrame(tick);
  };

  root.addEventListener("mousedown", onDown);
  return () => {
    root.removeEventListener("mousedown", onDown);
    onUp();
  };
}

// PDF utility hub — PDFium-backed (see engine.ts). pdf.js has been removed;
// the same engine that edits documents now renders them, extracts text,
// resolves outlines/links and reads form fields.
import { PdfDoc, PasswordError, type PdfPage, type TextRunGeom } from "./engine";
import type { OutlineNode, SearchMatch, SearchOptions } from "../types";
import { buildSearchIndex, findInIndex, snippetAround } from "./search";
import {
  buildLines,
  textLayerSelection,
  type CharBox,
  type LayerRun,
} from "./textselect";

export type { PdfPage };
export { PdfDoc };

/** How password prompts are shown. The app injects its in-app modal (masked
 *  input) via setPasswordPrompter; window.prompt is only the headless
 *  fallback — it would display the password in plain text. */
export type PasswordPrompter = (opts: {
  message: string;
  isRetry: boolean;
}) => Promise<string | null>;

let promptForPassword: PasswordPrompter = async ({ message }) =>
  window.prompt(message);

export function setPasswordPrompter(fn: PasswordPrompter): void {
  promptForPassword = fn;
}

/** Load a document, prompting for a password when the file needs one. */
export async function loadPdf(bytes: Uint8Array): Promise<PdfDoc> {
  let password = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await PdfDoc.load(bytes, password);
    } catch (err) {
      if (err instanceof PasswordError) {
        const input = await promptForPassword({
          message: "This PDF is password-protected. Enter its password to open it.",
          isRetry: !!password || attempt > 0,
        });
        if (input === null) throw new Error("Password required");
        password = input;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Too many wrong password attempts");
}

export interface PageText {
  pageIndex: number;
  items: string[];
  full: string;
}

/** Extract one page without forcing a full-document indexing pass. */
export function extractPageText(pdf: PdfDoc, pageIndex: number): PageText | null {
  if (pageIndex < 0 || pageIndex >= pdf.numPages) return null;
  const page = pdf.page(pageIndex);
  const items = page.getTextRuns().map((r) => r.text);
  return {
    pageIndex,
    items,
    full: items.length ? items.join(" ") : page.getText(),
  };
}

/**
 * Build a bounded AI context without materializing the entire document.
 * The current page is most relevant, then pages are read from the beginning
 * until the character budget is full.
 */
export function extractTextContext(
  pdf: PdfDoc,
  currentPage: number,
  limit: number,
): string {
  if (limit <= 0 || pdf.numPages <= 0) return "";
  let context = "";

  const appendPage = (pageIndex: number): boolean => {
    const page = extractPageText(pdf, pageIndex);
    if (!page?.full.trim()) return false;
    const chunk = `\n--- Page ${page.pageIndex + 1} ---\n${page.full}`;
    const remaining = limit - context.length;
    if (chunk.length >= remaining) {
      context += chunk.slice(0, remaining);
      return true;
    }
    context += chunk;
    return context.length >= limit;
  };

  const safeCurrent = Math.min(Math.max(0, currentPage), pdf.numPages - 1);
  if (appendPage(safeCurrent)) return context;
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    if (pageIndex === safeCurrent) continue;
    if (appendPage(pageIndex)) break;
  }
  return context;
}

// Caches the in-flight promise (not the result) so concurrent callers — the
// scanned-PDF check at open plus an early search — share one extraction pass.
const textCache = new WeakMap<PdfDoc, Promise<PageText[]>>();

export function extractAllText(pdf: PdfDoc): Promise<PageText[]> {
  const cached = textCache.get(pdf);
  if (cached) return cached;
  const promise = (async () => {
    const pages: PageText[] = [];
    // Extraction parses each page's full content stream synchronously; on a
    // large document that's seconds of main-thread work, so yield to the
    // event loop between time slices to keep the UI responsive.
    let sliceStart = performance.now();
    for (let i = 0; i < pdf.numPages; i++) {
      if (performance.now() - sliceStart > 12) {
        await new Promise((r) => setTimeout(r, 0));
        sliceStart = performance.now();
      }
      const page = extractPageText(pdf, i);
      if (page) pages.push(page);
    }
    return pages;
  })();
  textCache.set(pdf, promise);
  // A failed pass (e.g. the document was closed mid-extraction) must not
  // poison the cache for a retry.
  promise.catch(() => {
    if (textCache.get(pdf) === promise) textCache.delete(pdf);
  });
  return promise;
}

/**
 * True if any of the first `maxPages` pages contains a raster image object —
 * the signature of a scanned document. Lets callers tell a genuine scan
 * (image, no text) apart from a blank or purely vector page (no text, no
 * image), so OCR is only offered for the former.
 */
export function hasRasterImages(pdf: PdfDoc, maxPages = 5): boolean {
  const n = Math.min(pdf.numPages, maxPages);
  for (let i = 0; i < n; i++) {
    if (pdf.page(i).getObjects().some((o) => o.kind === "image")) return true;
  }
  return false;
}

export async function searchDocument(
  pdf: PdfDoc,
  query: string,
  options?: Partial<SearchOptions>,
): Promise<SearchMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pages = await extractAllText(pdf);
  const matches: SearchMatch[] = [];
  for (const page of pages) {
    page.items.forEach((str, itemIndex) => {
      const lower = str.toLowerCase();
      if (lower.includes(q)) {
        const at = lower.indexOf(q);
        const start = Math.max(0, at - 30);
        const snippet =
          (start > 0 ? "…" : "") + str.slice(start, at + q.length + 40);
        matches.push({
          id: `pdf:${page.pageIndex}:${itemIndex}:${at}`,
          page: page.pageIndex,
          source: "pdf-content",
          snippet,
          text: str.slice(at, at + q.length),
          ranges: [{ itemIndex, start: at, end: at + q.length }],
          replaceable: true,
          start: at,
          end: at + q.length,
          ordinal: matches.length,
        });
      }
    });
  }
  return matches;
}

export async function searchDocumentAdvanced(
  pdf: PdfDoc,
  query: string,
  options?: Partial<SearchOptions>,
): Promise<SearchMatch[]> {
  const pages = await extractAllText(pdf);
  const matches: SearchMatch[] = [];
  for (const page of pages) {
    const index = buildSearchIndex(
      page.items.map((text, itemIndex) => ({ itemIndex, text })),
    );
    const hits = findInIndex(index, query, options);
    if ("error" in hits) throw new Error(hits.error);
    hits.forEach((hit, ordinal) => {
      matches.push({
        id: `pdf:${page.pageIndex}:${ordinal}:${hit.start}:${hit.end}`,
        page: page.pageIndex,
        source: "pdf-content",
        snippet: snippetAround(index.text, hit.start, hit.end),
        text: hit.text,
        ranges: hit.ranges,
        replaceable: hit.ranges.length > 0,
        start: hit.start,
        end: hit.end,
        ordinal,
      });
    });
  }
  return matches;
}

export async function getOutline(pdf: PdfDoc): Promise<OutlineNode[]> {
  try {
    return pdf.getOutline();
  } catch {
    return [];
  }
}

export async function renderPageToCanvas(
  pdf: PdfDoc,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const page = pdf.page(pageIndex);
  page.renderToCanvas(canvas, scale * dpr);
  canvas.style.width = `${(page.width * scale).toFixed(2)}px`;
  canvas.style.height = `${(page.height * scale).toFixed(2)}px`;
}

// ---------------------------------------------------------------------------
// Text layer — replaces pdf.js's TextLayer. Builds absolutely-positioned
// spans (same `.textLayer > span` structure the selection, search-highlight
// and click-to-edit code already rely on) from PDFium text-run geometry.
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, fontPx: number): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d")!;
  }
  measureCtx.font = `${fontPx}px sans-serif`;
  return measureCtx.measureText(text).width;
}

// --- Reading-order layout (recursive XY-cut) --------------------------------
// Native selection walks the DOM in document order, so spans must be appended
// in visual reading order or dragging jumps between far-apart runs. Extraction
// order isn't reliably reading order, and a naive top→bottom/left→right sort
// interleaves columns. XY-cut recursively splits a block by its widest empty
// band: a full-width horizontal gap peels off titles/rows, a vertical gutter
// splits columns (read left→right). Blocks with no significant gap fall back to
// line-by-line ordering.

type LayoutItem = {
  r: { x: number; y: number; w: number; h: number; text: string };
  i: number;
};

/** Widest empty band between item intervals projected onto one axis. */
function widestGap(
  items: LayoutItem[],
  axis: "x" | "y",
): { gap: number; pos: number } {
  const iv = items.map(({ r }): [number, number] =>
    axis === "x" ? [r.x, r.x + r.w] : [r.y, r.y + r.h],
  );
  iv.sort((a, b) => a[0] - b[0]);
  let maxEnd = iv[0][1];
  const best = { gap: 0, pos: 0 };
  for (let k = 1; k < iv.length; k++) {
    const [s, e] = iv[k];
    if (s > maxEnd && s - maxEnd > best.gap) {
      best.gap = s - maxEnd;
      best.pos = (maxEnd + s) / 2;
    }
    if (e > maxEnd) maxEnd = e;
  }
  return best;
}

/** A single block (no column structure): order line-by-line, top→bottom. */
function orderBlock(items: LayoutItem[]): LayoutItem[] {
  const sorted = [...items].sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const lines: LayoutItem[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(item.r.y - line[0].r.y) <= item.r.h * 0.5) line.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.r.x - b.r.x);
  return lines.flat();
}

/** Reading-ordered runs grouped into leaf blocks (one array per XY-cut leaf).
 *  Selection uses the block boundaries to keep a column's lines from merging
 *  with same-row text in the next column. */
function readingOrder(items: LayoutItem[], mh: number, depth = 0): LayoutItem[][] {
  if (items.length <= 1 || depth >= 6) return [orderBlock(items)];
  const yGap = widestGap(items, "y"); // full-width horizontal band
  const xGap = widestGap(items, "x"); // vertical column gutter
  const yThresh = mh * 1.2;
  const xThresh = mh * 1.0;
  // Peel a full-width horizontal band first when it dominates — this separates
  // a title/header from the columns below it before columns are detected.
  if (yGap.gap >= yThresh && yGap.gap >= xGap.gap) {
    const top: LayoutItem[] = [];
    const bottom: LayoutItem[] = [];
    for (const it of items) (it.r.y + it.r.h <= yGap.pos ? top : bottom).push(it);
    if (top.length && bottom.length)
      return [
        ...readingOrder(top, mh, depth + 1),
        ...readingOrder(bottom, mh, depth + 1),
      ];
  }
  // Otherwise split on a vertical gutter into columns, read left → right.
  if (xGap.gap >= xThresh) {
    const left: LayoutItem[] = [];
    const right: LayoutItem[] = [];
    for (const it of items) (it.r.x + it.r.w <= xGap.pos ? left : right).push(it);
    if (left.length && right.length)
      return [
        ...readingOrder(left, mh, depth + 1),
        ...readingOrder(right, mh, depth + 1),
      ];
  }
  return [orderBlock(items)];
}

/**
 * Populate `container` with selectable text spans for `page` at `scale`.
 * Spans are transparent (styled by the .textLayer CSS) and horizontally
 * scaled so their metric width matches the rendered glyphs — which is what
 * makes native selection track the page text.
 */
export function renderTextLayer(
  page: PdfPage,
  container: HTMLElement,
  scale: number,
): void {
  container.replaceChildren();
  container.style.width = `${page.width * scale}px`;
  container.style.height = `${page.height * scale}px`;

  const runs = page.getTextRuns();

  // Lay out spans in visual reading order (XY-cut, column-aware) so selection
  // between two carets covers reading-order text. Each span keeps its
  // ORIGINAL run index in `data-run` so search (which indexes by run) stays
  // aligned after reorder.
  const heights = runs.map((r) => r.h).sort((a, b) => a - b);
  const mh = heights.length ? heights[Math.floor(heights.length / 2)] : 12;
  const blocks = readingOrder(
    runs.map((r, i) => ({ r, i })),
    mh,
  );

  const layerRuns: LayerRun[] = [];
  blocks.forEach((block, blockIndex) => {
    for (const { r: run, i } of block) {
      const span = document.createElement("span");
      span.textContent = run.text;
      span.dataset.run = String(i);
      const h = run.h * scale;
      const w = run.w * scale;
      const fontPx = Math.max(1, h * 0.85);
      const measured = measure(run.text, fontPx);
      span.style.left = `${run.x * scale}px`;
      span.style.top = `${run.y * scale}px`;
      span.style.fontSize = `${fontPx}px`;
      span.style.fontFamily = "sans-serif";
      span.style.lineHeight = `${h}px`;
      if (measured > 0) {
        span.style.transform = `scaleX(${w / measured})`;
      }
      container.appendChild(span);

      layerRuns.push({
        span,
        text: run.text,
        rect: { x: run.x * scale, y: run.y * scale, w, h },
        chars: charBoxesFromMetrics(run, scale, fontPx),
        block: blockIndex,
      });
    }
  });

  // Caret hit-testing geometry for the custom (Word-like) selection.
  textLayerSelection.set(container, buildLines(layerRuns));
}

/**
 * Per-character boxes for caret hit-testing, derived from the same canvas
 * metrics that size the span — so carets land exactly where the ::selection
 * highlight will paint. Widths are normalized to the run's true on-page
 * width; surrogate pairs get a zero-width continuation so the array aligns
 * 1:1 with UTF-16 indices.
 */
function charBoxesFromMetrics(
  run: TextRunGeom,
  scale: number,
  fontPx: number,
): CharBox[] {
  const x0 = run.x * scale;
  const y = run.y * scale;
  const h = run.h * scale;
  const runW = run.w * scale;
  const widths: number[] = [];
  const points = Array.from(run.text); // code points, not UTF-16 units
  let sum = 0;
  for (const cp of points) {
    const w = Math.max(0.01, measure(cp, fontPx));
    widths.push(w);
    sum += w;
  }
  const k = sum > 0 ? runW / sum : 0;
  const boxes: CharBox[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const w = widths[i] * k;
    boxes.push({ x: x0 + acc, y, w, h });
    if (points[i].length === 2) {
      boxes.push({ x: x0 + acc + w, y, w: 0, h, cont: true });
    }
    acc += w;
  }
  return boxes;
}

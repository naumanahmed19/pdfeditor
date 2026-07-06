// PDF utility hub — PDFium-backed (see engine.ts). pdf.js has been removed;
// the same engine that edits documents now renders them, extracts text,
// resolves outlines/links and reads form fields.
import { PdfDoc, PasswordError, type PdfPage } from "./engine";
import type { OutlineNode, SearchMatch } from "../types";

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

const textCache = new WeakMap<PdfDoc, PageText[]>();

export async function extractAllText(pdf: PdfDoc): Promise<PageText[]> {
  const cached = textCache.get(pdf);
  if (cached) return cached;
  const pages: PageText[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = pdf.page(i);
    const items = page.getTextRuns().map((r) => r.text);
    pages.push({
      pageIndex: i,
      items,
      full: items.length ? items.join(" ") : page.getText(),
    });
  }
  textCache.set(pdf, pages);
  return pages;
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
        matches.push({ page: page.pageIndex, itemIndex, snippet });
      }
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

function readingOrder(items: LayoutItem[], mh: number, depth = 0): LayoutItem[] {
  if (items.length <= 1 || depth >= 6) return orderBlock(items);
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
  return orderBlock(items);
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

  // Lay out spans in visual reading order (XY-cut, column-aware) so native
  // selection tracks the page. Each span keeps its ORIGINAL run index in
  // `data-run` so search (which indexes by run) stays aligned after reorder.
  const heights = runs.map((r) => r.h).sort((a, b) => a - b);
  const mh = heights.length ? heights[Math.floor(heights.length / 2)] : 12;
  const ordered = readingOrder(
    runs.map((r, i) => ({ r, i })),
    mh,
  );

  for (const { r: run, i } of ordered) {
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
  }
}

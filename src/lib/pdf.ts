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

  for (const run of page.getTextRuns()) {
    const span = document.createElement("span");
    span.textContent = run.text;
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

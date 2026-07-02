import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { OutlineNode, SearchMatch } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  let password: string | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // pdf.js transfers the buffer to the worker, so hand it a copy.
      const copy = bytes.slice();
      return await pdfjsLib.getDocument({ data: copy, password }).promise;
    } catch (err: any) {
      if (err?.name === "PasswordException") {
        const label =
          err.code === 2 || attempt > 0
            ? "Wrong password. This PDF is password-protected — enter the password:"
            : "This PDF is password-protected. Enter the password:";
        const input = window.prompt(label);
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

const textCache = new WeakMap<PDFDocumentProxy, PageText[]>();

export async function extractAllText(pdf: PDFDocumentProxy): Promise<PageText[]> {
  const cached = textCache.get(pdf);
  if (cached) return cached;
  const pages: PageText[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.map((it) => ("str" in it ? it.str : ""));
    pages.push({ pageIndex: i - 1, items, full: items.join(" ") });
  }
  textCache.set(pdf, pages);
  return pages;
}

export async function searchDocument(
  pdf: PDFDocumentProxy,
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

export async function getOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await pdf.getOutline().catch(() => null);
  if (!raw) return [];

  async function resolve(items: any[]): Promise<OutlineNode[]> {
    const out: OutlineNode[] = [];
    for (const item of items) {
      let pageIndex: number | null = null;
      try {
        let dest = item.dest;
        if (typeof dest === "string") dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          pageIndex = await pdf.getPageIndex(dest[0]);
        }
      } catch {
        pageIndex = null;
      }
      out.push({
        title: item.title ?? "Untitled",
        pageIndex,
        children: item.items?.length ? await resolve(item.items) : [],
      });
    }
    return out;
  }

  return resolve(raw as any[]);
}

export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const page = await pdf.getPage(pageIndex + 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport } as any).promise;
}

export { pdfjsLib };

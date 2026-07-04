import { createWorker, OEM } from "tesseract.js";
import type { PdfDoc } from "./pdf";

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrPage {
  pageIndex: number;
  /** Page size in PDF points (scale-1 viewport). */
  width: number;
  height: number;
  /** Scale the page was rasterized at for OCR. */
  renderScale: number;
  words: OcrWord[];
}

const RENDER_SCALE = 2;

/**
 * Recognize text on every page of a PDF, returning per-page words with their
 * bounding boxes (in rasterized-pixel coordinates). The language model is
 * fetched once from a CDN and cached; the recognition itself runs locally.
 */
export async function runOcr(
  pdf: PdfDoc,
  onProgress: (page: number, total: number, phase: "prepare" | "recognize") => void,
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  const total = pdf.numPages;
  onProgress(0, total, "prepare");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    logger: () => {},
    errorHandler: () => {},
  });
  const pages: OcrPage[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      if (signal?.aborted) throw new Error("OCR cancelled");
      onProgress(i - 1, total, "recognize");

      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      // White background so faint scans OCR cleanly.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp } as any).promise;

      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              if (w.text && w.text.trim() && w.confidence > 30) {
                words.push({
                  text: w.text,
                  x0: w.bbox.x0,
                  y0: w.bbox.y0,
                  x1: w.bbox.x1,
                  y1: w.bbox.y1,
                });
              }
            }
          }
        }
      }
      pages.push({
        pageIndex: i - 1,
        width: vp1.width,
        height: vp1.height,
        renderScale: RENDER_SCALE,
        words,
      });
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }
  onProgress(total, total, "recognize");
  return pages;
}

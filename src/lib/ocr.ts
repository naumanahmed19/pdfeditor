import { createWorker, OEM } from "tesseract.js";
import type { PdfDoc } from "./pdf";
import { DEFAULT_OCR_LANGUAGE, normalizeOcrLanguage } from "./ocrLanguages";
import { chromeExtensionAssetUrl } from "./chromeExtension";

// The curated language list lives in ocrLanguages.ts (dependency-free, so UI
// code can import it without dragging tesseract.js into the main bundle).
export {
  DEFAULT_OCR_LANGUAGE,
  OCR_LANGUAGES,
  OCR_LANGUAGE_OPTIONS,
  normalizeOcrLanguage,
  ocrLanguageLabel,
  type OcrLanguage,
} from "./ocrLanguages";

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
 * bounding boxes (in rasterized-pixel coordinates). The traineddata for the
 * requested language is fetched once from tesseract.js's data CDN and cached;
 * the recognition itself runs locally — page images never leave the device.
 * The Chrome extension packages the executable worker and WASM core locally,
 * as required by Manifest V3.
 */
export async function runOcr(
  pdf: PdfDoc,
  lang: string = DEFAULT_OCR_LANGUAGE,
  onProgress: (page: number, total: number, phase: "prepare" | "recognize") => void = () => {},
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  return runOcrPages(
    pdf,
    Array.from({ length: pdf.numPages }, (_, pageIndex) => pageIndex),
    lang,
    onProgress,
    signal,
  );
}

/** Recognize only selected zero-based pages, avoiding a whole-document OCR pass. */
export async function runOcrPages(
  pdf: PdfDoc,
  pageIndexes: readonly number[],
  lang: string = DEFAULT_OCR_LANGUAGE,
  onProgress: (page: number, total: number, phase: "prepare" | "recognize") => void = () => {},
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  const indexes = [...new Set(pageIndexes)].filter(
    (pageIndex) => pageIndex >= 0 && pageIndex < pdf.numPages,
  );
  const total = indexes.length;
  if (!total) return [];
  onProgress(0, total, "prepare");
  const extensionWorker = chromeExtensionAssetUrl("tesseract/worker.min.js");
  const extensionCore = chromeExtensionAssetUrl(
    "tesseract/tesseract-core-simd-lstm.js",
  );
  const worker = await createWorker(normalizeOcrLanguage(lang), OEM.LSTM_ONLY, {
    logger: () => {},
    errorHandler: () => {},
    ...(extensionWorker && extensionCore
      ? {
          workerPath: extensionWorker,
          workerBlobURL: false,
          corePath: extensionCore,
        }
      : {}),
  });
  const pages: OcrPage[] = [];
  try {
    for (let position = 0; position < indexes.length; position++) {
      if (signal?.aborted) throw new Error("OCR cancelled");
      onProgress(position, total, "recognize");

      const pageIndex = indexes[position];
      const page = await pdf.getPage(pageIndex + 1);
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
        pageIndex,
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

const recognizedTextCache = new WeakMap<PdfDoc, Map<string, string>>();

/** OCR one page for AI context without modifying the PDF. */
export async function recognizePageText(
  pdf: PdfDoc,
  pageIndex: number,
  lang: string = DEFAULT_OCR_LANGUAGE,
  onProgress: (phase: "prepare" | "recognize") => void = () => {},
  signal?: AbortSignal,
): Promise<string> {
  const normalizedLang = normalizeOcrLanguage(lang);
  const key = `${pageIndex}:${normalizedLang}`;
  const cached = recognizedTextCache.get(pdf)?.get(key);
  if (cached !== undefined) return cached;

  const [page] = await runOcrPages(
    pdf,
    [pageIndex],
    normalizedLang,
    (_page, _total, phase) => onProgress(phase),
    signal,
  );
  const text = page?.words.map((word) => word.text).join(" ").trim() ?? "";
  let documentCache = recognizedTextCache.get(pdf);
  if (!documentCache) {
    documentCache = new Map();
    recognizedTextCache.set(pdf, documentCache);
  }
  documentCache.set(key, text);
  return text;
}

// Experimental PDFium (WASM) engine wrapper.
//
// This is a prototype for the "Evaluate @embedpdf/pdfium" TODO item. It lazily
// loads the ~5 MB PDFium WASM (bundled locally, not from the CDN default) and
// exposes two capabilities pdf.js / pdf-lib can't do well on their own:
//
//   1. renderPage()  — high-fidelity rasterization (PNG export, render-fallback)
//   2. redactRegions() — TRUE redaction: destructively removes the underlying
//      page content under a rectangle, not just a whiteout cover.
//
// Nothing here is wired into the main app yet; it's opt-in via the dev hooks so
// we can validate the engine in our stack before committing to it.

import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
// Bundle the wasm as a local asset URL (keeps the app fully local-first).
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";

// PDFium render flags (from fpdfview.h)
const FPDF_ANNOT = 0x01;
const FPDF_LCD_TEXT = 0x02;

let modPromise: Promise<WrappedPdfiumModule> | null = null;

/** Lazily load + init the PDFium library (once per session). */
export async function getPdfium(): Promise<WrappedPdfiumModule> {
  if (!modPromise) {
    modPromise = (async () => {
      const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
      const mod = await init({ wasmBinary });
      mod.FPDF_InitLibrary();
      return mod;
    })();
  }
  return modPromise;
}

/** Access the raw emscripten heap/runtime (typed loosely — not in the .d.ts). */
function runtime(mod: WrappedPdfiumModule) {
  return mod.pdfium as unknown as {
    HEAPU8: Uint8Array;
    wasmExports: { malloc: (n: number) => number; free: (p: number) => void };
  };
}

/** Copy JS bytes into the wasm heap; returns a pointer the caller must free. */
function toHeap(mod: WrappedPdfiumModule, bytes: Uint8Array): number {
  const rt = runtime(mod);
  const ptr = rt.wasmExports.malloc(bytes.length);
  rt.HEAPU8.set(bytes, ptr);
  return ptr;
}

async function withDoc<T>(
  bytes: Uint8Array,
  fn: (mod: WrappedPdfiumModule, doc: number) => T,
): Promise<T> {
  const mod = await getPdfium();
  const rt = runtime(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, "");
  if (!doc) {
    rt.wasmExports.free(filePtr);
    throw new Error(`PDFium: could not open document (err ${mod.FPDF_GetLastError()})`);
  }
  try {
    return fn(mod, doc);
  } finally {
    mod.FPDF_CloseDocument(doc);
    rt.wasmExports.free(filePtr);
  }
}

export interface RenderedPage {
  width: number;
  height: number;
  /** RGBA pixels, row-major, ready for ImageData / canvas. */
  rgba: Uint8ClampedArray;
}

/**
 * Render one page to RGBA pixels at `scale` (1 = 72dpi points → device px).
 */
export async function renderPage(
  bytes: Uint8Array,
  pageIndex: number,
  scale = 2,
): Promise<RenderedPage> {
  return withDoc(bytes, (mod, doc) => {
    const rt = runtime(mod);
    const page = mod.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`PDFium: could not load page ${pageIndex}`);
    try {
      const pw = mod.FPDF_GetPageWidthF(page);
      const ph = mod.FPDF_GetPageHeightF(page);
      const W = Math.max(1, Math.round(pw * scale));
      const H = Math.max(1, Math.round(ph * scale));

      // format 4 = FPDFBitmap_BGRA; scan0=0 => PDFium allocates the buffer.
      const bitmap = mod.FPDFBitmap_CreateEx(W, H, 4, 0, 0);
      mod.FPDFBitmap_FillRect(bitmap, 0, 0, W, H, 0xffffffff); // white bg
      mod.FPDF_RenderPageBitmap(
        bitmap,
        page,
        0,
        0,
        W,
        H,
        0,
        FPDF_ANNOT | FPDF_LCD_TEXT,
      );

      const bufPtr = mod.FPDFBitmap_GetBuffer(bitmap);
      const stride = mod.FPDFBitmap_GetStride(bitmap);
      const heap = rt.HEAPU8;
      const rgba = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) {
        let src = bufPtr + y * stride;
        let dst = y * W * 4;
        for (let x = 0; x < W; x++) {
          // BGRA -> RGBA
          const b = heap[src], g = heap[src + 1], r = heap[src + 2], a = heap[src + 3];
          rgba[dst] = r;
          rgba[dst + 1] = g;
          rgba[dst + 2] = b;
          rgba[dst + 3] = a;
          src += 4;
          dst += 4;
        }
      }
      mod.FPDFBitmap_Destroy(bitmap);
      return { width: W, height: H, rgba };
    } finally {
      mod.FPDF_ClosePage(page);
    }
  });
}

/** Get the page count without a full render. */
export async function getPageCount(bytes: Uint8Array): Promise<number> {
  return withDoc(bytes, (mod, doc) => mod.FPDF_GetPageCount(doc));
}

// --- True redaction -------------------------------------------------------

const FS_QUADPOINTSF_SIZE = 32; // 8 floats

/** Loosely-typed emscripten runtime helpers used for structs/callbacks. */
function rtx(mod: WrappedPdfiumModule) {
  return mod.pdfium as unknown as {
    HEAPU8: Uint8Array;
    wasmExports: { malloc: (n: number) => number; free: (p: number) => void };
    setValue: (ptr: number, value: number, type: string) => void;
    addFunction: (fn: (...a: number[]) => number, sig: string) => number;
    removeFunction: (ptr: number) => void;
  };
}

/** A rectangle to redact, in PDF points (origin bottom-left). */
export interface RedactRect {
  pageIndex: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/**
 * Destructively redact rectangular regions: text (and, with recurseForms, form
 * field values) intersecting each rect is REMOVED from the page content — not
 * just covered — and an optional black box is drawn in its place. Returns a
 * fresh PDF byte array.
 *
 * This is what a whiteout can't do: the redacted text no longer exists in the
 * saved file, so it can't be copied, searched, or recovered. Uses EmbedPDF's
 * EPDFText_RedactInQuads primitive (the same one their redaction plugin uses).
 */
export async function redactRegions(
  bytes: Uint8Array,
  rects: RedactRect[],
  opts: { drawBlackBoxes?: boolean } = {},
): Promise<Uint8Array> {
  const drawBlackBoxes = opts.drawBlackBoxes ?? true;
  const mod = await getPdfium();
  const rt = rtx(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, "");
  if (!doc) {
    rt.wasmExports.free(filePtr);
    throw new Error(`PDFium: could not open document (err ${mod.FPDF_GetLastError()})`);
  }
  try {
    const byPage = new Map<number, RedactRect[]>();
    for (const r of rects) {
      const list = byPage.get(r.pageIndex) ?? [];
      list.push(r);
      byPage.set(r.pageIndex, list);
    }

    for (const [pageIndex, list] of byPage) {
      const page = mod.FPDF_LoadPage(doc, pageIndex);
      if (!page) continue;
      try {
        // Pack an array of FS_QUADPOINTSF (page-space, origin bottom-left).
        // Field order per point: (x1,y1)=TL (x2,y2)=TR (x3,y3)=BL (x4,y4)=BR.
        const ptr = rt.wasmExports.malloc(FS_QUADPOINTSF_SIZE * list.length);
        list.forEach((r, i) => {
          const b = ptr + i * FS_QUADPOINTSF_SIZE;
          rt.setValue(b + 0, r.left, "float");
          rt.setValue(b + 4, r.top, "float");
          rt.setValue(b + 8, r.right, "float");
          rt.setValue(b + 12, r.top, "float");
          rt.setValue(b + 16, r.left, "float");
          rt.setValue(b + 20, r.bottom, "float");
          rt.setValue(b + 24, r.right, "float");
          rt.setValue(b + 28, r.bottom, "float");
        });
        const ok = mod.EPDFText_RedactInQuads(
          page,
          ptr,
          list.length,
          true, // recurseForms — also strip matching form field content
          drawBlackBoxes,
        );
        rt.wasmExports.free(ptr);
        if (ok) mod.FPDFPage_GenerateContent(page);
      } finally {
        mod.FPDF_ClosePage(page);
      }
    }

    return saveAsCopy(mod, doc);
  } finally {
    mod.FPDF_CloseDocument(doc);
    rt.wasmExports.free(filePtr);
  }
}

/** Serialize the (possibly modified) document to bytes via FPDF_SaveAsCopy. */
function saveAsCopy(mod: WrappedPdfiumModule, doc: number): Uint8Array {
  const rt = rtx(mod);
  const parts: Uint8Array[] = [];
  let total = 0;
  // WriteBlock(FPDF_FILEWRITE* pThis, const void* pData, unsigned long size)
  const cb = rt.addFunction((_pThis: number, pData: number, size: number) => {
    parts.push(rt.HEAPU8.slice(pData, pData + size)); // copy out of heap
    total += size;
    return 1;
  }, "iiii");
  // struct FPDF_FILEWRITE { int version; WriteBlock* fn } — 8 bytes on wasm32.
  const structPtr = rt.wasmExports.malloc(8);
  rt.setValue(structPtr, 1, "i32"); // version = 1
  rt.setValue(structPtr + 4, cb, "i32"); // function pointer
  const ok = mod.FPDF_SaveAsCopy(doc, structPtr, 0);
  rt.wasmExports.free(structPtr);
  rt.removeFunction(cb);
  if (!ok) throw new Error("PDFium: FPDF_SaveAsCopy failed");
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Render a page straight onto a canvas element (creates one if omitted). */
export async function renderPageToCanvas(
  bytes: Uint8Array,
  pageIndex: number,
  scale = 2,
  canvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const { width, height, rgba } = await renderPage(bytes, pageIndex, scale);
  const c = canvas ?? document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return c;
}

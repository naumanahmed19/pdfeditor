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
    getValue: (ptr: number, type: string) => number;
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

// --- In-place text editing (page objects) ---------------------------------

const FPDF_PAGEOBJ_TEXT = 1;

/** A text run on a page, as PDFium sees it (page space, origin bottom-left). */
export interface TextObject {
  /** Index into the page's object list — the handle for editing. */
  index: number;
  text: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  fontSize: number;
  /** Fill color 0–255. */
  color: [number, number, number, number];
  fontName: string;
}

/** Write a JS string as a NUL-terminated UTF-16LE buffer; caller frees it. */
function allocUtf16(mod: WrappedPdfiumModule, str: string): number {
  const rt = rtx(mod);
  const ptr = rt.wasmExports.malloc((str.length + 1) * 2);
  for (let i = 0; i < str.length; i++) {
    rt.setValue(ptr + i * 2, str.charCodeAt(i), "i16");
  }
  rt.setValue(ptr + str.length * 2, 0, "i16");
  return ptr;
}

/** Read a NUL-terminated UTF-16LE buffer of at most `byteLen` bytes. */
function readUtf16(mod: WrappedPdfiumModule, ptr: number, byteLen: number): string {
  const rt = rtx(mod);
  let s = "";
  for (let i = 0; i + 1 < byteLen; i += 2) {
    const c = rt.HEAPU8[ptr + i] | (rt.HEAPU8[ptr + i + 1] << 8);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/**
 * Enumerate the text runs on a page with their exact geometry, font size,
 * fill color and font name — everything the editor needs to hit-test a click
 * and match the replacement. Unlike pdf.js text items (display-oriented), these
 * are the real content-stream objects that can be edited in place.
 */
export async function getTextObjects(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<TextObject[]> {
  return withDoc(bytes, (mod, doc) => {
    const rt = rtx(mod);
    const page = mod.FPDF_LoadPage(doc, pageIndex);
    const textPage = mod.FPDFText_LoadPage(page);
    const out: TextObject[] = [];
    // Scratch space reused across objects.
    const f4 = rt.wasmExports.malloc(16); // 4 floats (bounds)
    const c4 = rt.wasmExports.malloc(16); // 4 uints (color)
    const fs = rt.wasmExports.malloc(4); // 1 float (font size)
    try {
      const count = mod.FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        const obj = mod.FPDFPage_GetObject(page, i);
        if (mod.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue;

        // Text: two-pass (query length, then read).
        const need = mod.FPDFTextObj_GetText(obj, textPage, 0, 0);
        let text = "";
        if (need > 0) {
          const buf = rt.wasmExports.malloc(need * 2);
          mod.FPDFTextObj_GetText(obj, textPage, buf, need);
          text = readUtf16(mod, buf, need * 2);
          rt.wasmExports.free(buf);
        }

        mod.FPDFPageObj_GetBounds(obj, f4, f4 + 4, f4 + 8, f4 + 12);
        mod.FPDFPageObj_GetFillColor(obj, c4, c4 + 4, c4 + 8, c4 + 12);
        mod.FPDFTextObj_GetFontSize(obj, fs);

        let fontName = "";
        const font = mod.FPDFTextObj_GetFont(obj);
        if (font) {
          const n = mod.FPDFFont_GetBaseFontName(font, 0, 0);
          if (n > 0) {
            const nb = rt.wasmExports.malloc(n);
            mod.FPDFFont_GetBaseFontName(font, nb, n);
            fontName = readUtf8(mod, nb, n);
            rt.wasmExports.free(nb);
          }
        }

        out.push({
          index: i,
          text,
          left: rt.getValue(f4, "float"),
          bottom: rt.getValue(f4 + 4, "float"),
          right: rt.getValue(f4 + 8, "float"),
          top: rt.getValue(f4 + 12, "float"),
          color: [
            rt.getValue(c4, "i32") & 0xff,
            rt.getValue(c4 + 4, "i32") & 0xff,
            rt.getValue(c4 + 8, "i32") & 0xff,
            rt.getValue(c4 + 12, "i32") & 0xff,
          ],
          fontSize: rt.getValue(fs, "float"),
          fontName,
        });
      }
      return out;
    } finally {
      rt.wasmExports.free(f4);
      rt.wasmExports.free(c4);
      rt.wasmExports.free(fs);
      mod.FPDFText_ClosePage(textPage);
      mod.FPDF_ClosePage(page);
    }
  });
}

/** Read a NUL-terminated ASCII/UTF-8 buffer of at most `byteLen` bytes. */
function readUtf8(mod: WrappedPdfiumModule, ptr: number, byteLen: number): string {
  const rt = rtx(mod);
  let end = ptr;
  while (end < ptr + byteLen && rt.HEAPU8[end] !== 0) end++;
  return new TextDecoder().decode(rt.HEAPU8.subarray(ptr, end));
}

/**
 * TRUE in-place text edit: replace the string of the text object at
 * `objectIndex` with `newText`, keeping its original font, size, color and
 * position. The original text is genuinely replaced in the content stream — no
 * whiteout patch, and nothing left behind to extract. Returns fresh PDF bytes.
 *
 * Caveat: subset-embedded fonts only carry the glyphs the document already
 * used, so characters not present in the subset won't render — fine for
 * correcting words with existing letters, not for arbitrary new text.
 */
export async function editTextObject(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
  newText: string,
): Promise<Uint8Array> {
  const mod = await getPdfium();
  const rt = rtx(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, "");
  if (!doc) {
    rt.wasmExports.free(filePtr);
    throw new Error(`PDFium: could not open document (err ${mod.FPDF_GetLastError()})`);
  }
  try {
    const page = mod.FPDF_LoadPage(doc, pageIndex);
    try {
      const obj = mod.FPDFPage_GetObject(page, objectIndex);
      if (!obj || mod.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        throw new Error(`PDFium: object ${objectIndex} is not a text object`);
      }
      const strPtr = allocUtf16(mod, newText);
      const ok = mod.FPDFText_SetText(obj, strPtr);
      rt.wasmExports.free(strPtr);
      if (!ok) throw new Error("PDFium: FPDFText_SetText failed");
      mod.FPDFPage_GenerateContent(page);
    } finally {
      mod.FPDF_ClosePage(page);
    }
    return saveAsCopy(mod, doc);
  } finally {
    mod.FPDF_CloseDocument(doc);
    rt.wasmExports.free(filePtr);
  }
}

// --- Page objects: enumerate / move / resize / delete ---------------------

const FPDF_PAGEOBJ_IMAGE = 3;

/** Any editable page object (text or image), page space, origin bottom-left. */
export interface PageObject {
  index: number;
  kind: "text" | "image";
  /** Text content ("" for images). */
  text: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  /** Font size for text (0 for images). */
  fontSize: number;
}

/** A 2x3 affine matrix { a b c d e f } in PDF page space. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Enumerate the movable objects on a page — text runs and images — with their
 * exact bounds. Used to hit-test clicks in the object editor.
 */
export async function getPageObjects(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<PageObject[]> {
  return withDoc(bytes, (mod, doc) => {
    const rt = rtx(mod);
    const page = mod.FPDF_LoadPage(doc, pageIndex);
    const textPage = mod.FPDFText_LoadPage(page);
    const f4 = rt.wasmExports.malloc(16);
    const fs = rt.wasmExports.malloc(4);
    const out: PageObject[] = [];
    try {
      const count = mod.FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        const obj = mod.FPDFPage_GetObject(page, i);
        const type = mod.FPDFPageObj_GetType(obj);
        if (type !== FPDF_PAGEOBJ_TEXT && type !== FPDF_PAGEOBJ_IMAGE) continue;
        if (!mod.FPDFPageObj_GetBounds(obj, f4, f4 + 4, f4 + 8, f4 + 12)) continue;
        let text = "";
        let fontSize = 0;
        if (type === FPDF_PAGEOBJ_TEXT) {
          const need = mod.FPDFTextObj_GetText(obj, textPage, 0, 0);
          if (need > 0) {
            const b = rt.wasmExports.malloc(need * 2);
            mod.FPDFTextObj_GetText(obj, textPage, b, need);
            text = readUtf16(mod, b, need * 2);
            rt.wasmExports.free(b);
          }
          mod.FPDFTextObj_GetFontSize(obj, fs);
          fontSize = rt.getValue(fs, "float");
        }
        out.push({
          index: i,
          kind: type === FPDF_PAGEOBJ_TEXT ? "text" : "image",
          text,
          left: rt.getValue(f4, "float"),
          bottom: rt.getValue(f4 + 4, "float"),
          right: rt.getValue(f4 + 8, "float"),
          top: rt.getValue(f4 + 12, "float"),
          fontSize,
        });
      }
      return out;
    } finally {
      rt.wasmExports.free(f4);
      rt.wasmExports.free(fs);
      mod.FPDFText_ClosePage(textPage);
      mod.FPDF_ClosePage(page);
    }
  });
}

/** Open a page, run an edit, regenerate its content, and save to fresh bytes. */
async function editPage(
  bytes: Uint8Array,
  pageIndex: number,
  fn: (mod: WrappedPdfiumModule, page: number) => void,
): Promise<Uint8Array> {
  const mod = await getPdfium();
  const rt = rtx(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, "");
  if (!doc) {
    rt.wasmExports.free(filePtr);
    throw new Error(`PDFium: could not open document (err ${mod.FPDF_GetLastError()})`);
  }
  try {
    const page = mod.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`PDFium: could not load page ${pageIndex}`);
    try {
      fn(mod, page);
      mod.FPDFPage_GenerateContent(page);
    } finally {
      mod.FPDF_ClosePage(page);
    }
    return saveAsCopy(mod, doc);
  } finally {
    mod.FPDF_CloseDocument(doc);
    rt.wasmExports.free(filePtr);
  }
}

/**
 * Apply an affine transform to the page object at `objectIndex` (in page
 * space) — used to move (translate) or resize (scale) an existing text run or
 * image. Returns fresh PDF bytes.
 */
export async function transformObject(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
  m: Matrix,
): Promise<Uint8Array> {
  return editPage(bytes, pageIndex, (mod, page) => {
    const obj = mod.FPDFPage_GetObject(page, objectIndex);
    if (!obj) throw new Error(`PDFium: object ${objectIndex} not found`);
    mod.FPDFPageObj_Transform(obj, m.a, m.b, m.c, m.d, m.e, m.f);
  });
}

/** Delete the page object at `objectIndex` from the content stream. */
export async function removeObject(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
): Promise<Uint8Array> {
  return editPage(bytes, pageIndex, (mod, page) => {
    const obj = mod.FPDFPage_GetObject(page, objectIndex);
    if (!obj) throw new Error(`PDFium: object ${objectIndex} not found`);
    if (mod.FPDFPage_RemoveObject(page, obj)) mod.FPDFPageObj_Destroy(obj);
  });
}

// --- Form field appearances -----------------------------------------------

const FPDF_ANNOT_WIDGET = 20; // annotation subtype for form field widgets

/**
 * Regenerate the appearance stream of every form-field widget from its current
 * value, so filled values render correctly in every viewer (not just ones that
 * honor /NeedAppearances). Returns fresh bytes, or the input unchanged if the
 * document has no widgets.
 */
export async function regenerateFormAppearances(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const mod = await getPdfium();
  const rt = runtime(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, "");
  if (!doc) {
    rt.wasmExports.free(filePtr);
    throw new Error(`PDFium: could not open document (err ${mod.FPDF_GetLastError()})`);
  }
  // A form-fill environment is required for PDFium to build widget appearances
  // from field values (EmbedPDF's OpenFormFillInfo avoids the 30-callback struct).
  const formInfo = mod.PDFiumExt_OpenFormFillInfo();
  const formHandle = mod.PDFiumExt_InitFormFillEnvironment(doc, formInfo);
  try {
    let changed = false;
    const pages = mod.FPDF_GetPageCount(doc);
    for (let p = 0; p < pages; p++) {
      const page = mod.FPDF_LoadPage(doc, p);
      if (!page) continue;
      mod.FORM_OnAfterLoadPage(page, formHandle);
      try {
        const n = mod.FPDFPage_GetAnnotCount(page);
        for (let i = 0; i < n; i++) {
          const annot = mod.FPDFPage_GetAnnot(page, i);
          if (!annot) continue;
          if (
            mod.FPDFAnnot_GetSubtype(annot) === FPDF_ANNOT_WIDGET &&
            mod.EPDFAnnot_GenerateFormFieldAP(annot)
          ) {
            changed = true;
          }
          mod.FPDFPage_CloseAnnot(annot);
        }
      } finally {
        mod.FORM_OnBeforeClosePage(page, formHandle);
        mod.FPDF_ClosePage(page);
      }
    }
    return changed ? saveAsCopy(mod, doc) : bytes;
  } finally {
    mod.PDFiumExt_ExitFormFillEnvironment(formHandle);
    mod.PDFiumExt_CloseFormFillInfo(formInfo);
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

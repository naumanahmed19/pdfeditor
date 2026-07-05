// PDFium (WASM) engine wrapper — the app's EDITING engine.
//
// It lazily loads the ~5 MB PDFium WASM (bundled locally, not from the CDN
// default) and provides the capabilities pdf-lib can't do on its own: true
// in-place text editing (content-stream rewrite), moving/resizing/deleting
// existing page objects, destructive redaction, high-fidelity rasterization,
// and form-appearance regeneration.
//
// Division of labour: PDFium renders, provides the text layer and edits page
// content (viewing lives in engine.ts, editing here); pdf-lib assembles
// documents (merge/split/bake). The store wires these edits into the undo
// history via applyPdfiumEdit.

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
  /** Text-matrix origin (the baseline start point) — the anchor that keeps a
      run in place when scaling or skewing it. Falls back to the bounds
      corner when the matrix can't be read. */
  originX: number;
  originY: number;
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
    const m6 = rt.wasmExports.malloc(24); // FS_MATRIX (6 floats)
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
        const hasMatrix = mod.FPDFPageObj_GetMatrix(obj, m6);

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

        const left = rt.getValue(f4, "float");
        const bottom = rt.getValue(f4 + 4, "float");
        out.push({
          index: i,
          text,
          left,
          bottom,
          right: rt.getValue(f4 + 8, "float"),
          top: rt.getValue(f4 + 12, "float"),
          originX: hasMatrix ? rt.getValue(m6 + 16, "float") : left,
          originY: hasMatrix ? rt.getValue(m6 + 20, "float") : bottom,
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
      rt.wasmExports.free(m6);
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

const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_IMAGE = 3;

/** RGBA 0–255, or null if the object has no such color. */
export type Rgba = [number, number, number, number] | null;

/** An editable page object (text, image or vector path), origin bottom-left. */
export interface PageObject {
  index: number;
  kind: "text" | "image" | "path";
  /** Text content ("" for non-text). */
  text: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  /** Font size for text (0 otherwise). */
  fontSize: number;
  /** Fill color (text ink / path fill), if any. */
  fill: Rgba;
  /** Stroke color (path outline), if any. */
  stroke: Rgba;
  /** Stroke width in points (paths). */
  strokeWidth: number;
  /** Base font name for text objects ("" otherwise). */
  fontName: string;
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
    const c4 = rt.wasmExports.malloc(16); // 4 uints for a color read
    const readColor = (get: (o: number, r: number, g: number, b: number, a: number) => boolean, obj: number): Rgba => {
      if (!get(obj, c4, c4 + 4, c4 + 8, c4 + 12)) return null;
      const a = rt.getValue(c4 + 12, "i32") & 0xff;
      if (a === 0) return null; // fully transparent = "no color"
      return [
        rt.getValue(c4, "i32") & 0xff,
        rt.getValue(c4 + 4, "i32") & 0xff,
        rt.getValue(c4 + 8, "i32") & 0xff,
        a,
      ];
    };
    const out: PageObject[] = [];
    try {
      const count = mod.FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        const obj = mod.FPDFPage_GetObject(page, i);
        const type = mod.FPDFPageObj_GetType(obj);
        if (
          type !== FPDF_PAGEOBJ_TEXT &&
          type !== FPDF_PAGEOBJ_IMAGE &&
          type !== FPDF_PAGEOBJ_PATH
        )
          continue;
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
        let fontName = "";
        if (type === FPDF_PAGEOBJ_TEXT) {
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
        }
        out.push({
          index: i,
          kind:
            type === FPDF_PAGEOBJ_TEXT
              ? "text"
              : type === FPDF_PAGEOBJ_IMAGE
                ? "image"
                : "path",
          text,
          left: rt.getValue(f4, "float"),
          bottom: rt.getValue(f4 + 4, "float"),
          right: rt.getValue(f4 + 8, "float"),
          top: rt.getValue(f4 + 12, "float"),
          fontSize,
          fill: type === FPDF_PAGEOBJ_IMAGE ? null : readColor(mod.FPDFPageObj_GetFillColor, obj),
          stroke: type === FPDF_PAGEOBJ_PATH ? readColor(mod.FPDFPageObj_GetStrokeColor, obj) : null,
          strokeWidth:
            type === FPDF_PAGEOBJ_PATH && mod.FPDFPageObj_GetStrokeWidth(obj, fs)
              ? rt.getValue(fs, "float")
              : 0,
          fontName,
        });
      }
      return out;
    } finally {
      rt.wasmExports.free(f4);
      rt.wasmExports.free(fs);
      rt.wasmExports.free(c4);
      mod.FPDFText_ClosePage(textPage);
      mod.FPDF_ClosePage(page);
    }
  });
}

/** Style edits for a page object. */
export interface ObjectStyle {
  fill?: [number, number, number, number];
  stroke?: [number, number, number, number];
  strokeWidth?: number;
}

const FPDF_FONT_TRUETYPE = 2;

const FPDF_FONT_TYPE1 = 1;
// Fill + stroke render mode — used to synthesize bold on a face the document
// doesn't embed a bold variant of (the same trick browsers use).
const FPDF_TEXTRENDERMODE_FILL_STROKE = 2;
// tan(12°) — the shear browsers use for synthetic italic.
const ITALIC_SKEW = 0.21256;

/** A replacement font for the recreate path (changing font family/weight). */
export interface TextFont {
  /** One of the 14 standard PDF font names, e.g. "Helvetica-Bold". */
  standardName?: string;
  /** Or a TrueType/OpenType/Type1 font program to embed. */
  bytes?: Uint8Array;
}

/** Per-run part of a line edit. */
export interface TextRunEdit {
  objectIndex: number;
  /** New string for the run; omit to keep it, "" removes the run entirely. */
  text?: string;
}

/** Style applied to every run of the edited line. */
export interface LineStyle {
  /** New ink (fill) color, RGBA 0–255. */
  fill?: [number, number, number, number];
  /** Multiply the font size by this factor (scale about `anchor`). */
  fontScale?: number;
  /**
   * Shared anchor (the line's baseline origin) for scale/skew, so all runs
   * grow coherently instead of each about its own corner. Falls back to each
   * run's own baseline origin.
   */
  anchor?: [number, number];
  /** Synthesize bold on the original face (fill+stroke render mode). */
  synthBold?: boolean;
  /** Synthesize italic on the original face (shear about the baseline). */
  synthItalic?: boolean;
  /**
   * Replace the font — recreates each run at its original matrix with this
   * face. Every run must then carry an explicit `text`.
   */
  font?: TextFont;
  /** Absolute size (pt) for the recreate path. */
  fontSize?: number;
}

/** 'OTTO'/'true'/'ttcf'/sfnt-v1 → TrueType loader; anything else Type1/CFF. */
function sniffFontType(data: Uint8Array): number {
  const tag = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (tag === "OTTO" || tag === "true" || tag === "ttcf") return FPDF_FONT_TRUETYPE;
  if (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0)
    return FPDF_FONT_TRUETYPE;
  return FPDF_FONT_TYPE1;
}

/** Read an object's fill color, defaulting to opaque black. */
function readFillColor(
  mod: WrappedPdfiumModule,
  obj: number,
): [number, number, number, number] {
  const rt = rtx(mod);
  const c4 = rt.wasmExports.malloc(16);
  try {
    return mod.FPDFPageObj_GetFillColor(obj, c4, c4 + 4, c4 + 8, c4 + 12)
      ? [
          rt.getValue(c4, "i32") & 0xff,
          rt.getValue(c4 + 4, "i32") & 0xff,
          rt.getValue(c4 + 8, "i32") & 0xff,
          rt.getValue(c4 + 12, "i32") & 0xff || 255,
        ]
      : [0, 0, 0, 255];
  } finally {
    rt.wasmExports.free(c4);
  }
}

/**
 * Edit the runs of one visual line in a single pass: per-run text replacement
 * or removal, plus line-wide restyling. Two modes:
 *  - keep the original fonts (default): text via FPDFText_SetText, size via a
 *    baseline-anchored scale, bold/italic synthesized on the existing face —
 *    the embedded font is never swapped out;
 *  - replace the font (`style.font`): each run is recreated with the new face
 *    at its original matrix, color and (unless overridden) size.
 */
export async function styleTextRuns(
  bytes: Uint8Array,
  pageIndex: number,
  runs: TextRunEdit[],
  style: LineStyle = {},
): Promise<Uint8Array> {
  return editPage(bytes, pageIndex, (mod, page, doc) => {
    const rt = rtx(mod);
    // Resolve all handles up front — removals don't disturb other handles.
    const objs = runs.map((r) => {
      const obj = mod.FPDFPage_GetObject(page, r.objectIndex);
      if (!obj || mod.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        throw new Error(`PDFium: object ${r.objectIndex} is not a text object`);
      }
      return obj;
    });
    const removeObj = (obj: number) => {
      if (mod.FPDFPage_RemoveObject(page, obj)) mod.FPDFPageObj_Destroy(obj);
    };

    // --- Font replacement: recreate every run with the new face ---
    if (style.font) {
      let font: number;
      if (style.font.bytes) {
        const fp = toHeap(mod, style.font.bytes);
        font = mod.FPDFText_LoadFont(
          doc,
          fp,
          style.font.bytes.length,
          sniffFontType(style.font.bytes),
          false,
        );
        rt.wasmExports.free(fp);
      } else {
        font = mod.FPDFText_LoadStandardFont(doc, style.font.standardName ?? "Helvetica");
      }
      if (!font) throw new Error("PDFium: could not load replacement font");

      const mPtr = rt.wasmExports.malloc(24); // FS_MATRIX = 6 floats
      const fs = rt.wasmExports.malloc(4);
      try {
        runs.forEach((r, i) => {
          if (r.text == null) {
            throw new Error("styleTextRuns: font replacement needs explicit text per run");
          }
          const obj = objs[i];
          if (r.text === "") {
            removeObj(obj);
            return;
          }
          // Preserve the original placement (matrix), color and size.
          mod.FPDFPageObj_GetMatrix(obj, mPtr);
          const fill = style.fill ?? readFillColor(mod, obj);
          mod.FPDFTextObj_GetFontSize(obj, fs);
          const size = style.fontSize ?? rt.getValue(fs, "float");

          const next = mod.FPDFPageObj_CreateTextObj(doc, font, size);
          const sp = allocUtf16(mod, r.text);
          mod.FPDFText_SetText(next, sp);
          rt.wasmExports.free(sp);
          mod.FPDFPageObj_SetMatrix(next, mPtr);
          mod.FPDFPageObj_SetFillColor(next, fill[0], fill[1], fill[2], fill[3]);
          mod.FPDFPage_InsertObject(page, next);
          removeObj(obj);
        });
      } finally {
        rt.wasmExports.free(mPtr);
        rt.wasmExports.free(fs);
      }
      return;
    }

    // --- In-place edits (keep the original embedded fonts) ---
    const mPtr = rt.wasmExports.malloc(24);
    const fs = rt.wasmExports.malloc(4);
    const removed = new Set<number>();
    try {
      runs.forEach((r, i) => {
        if (r.text === "") {
          removeObj(objs[i]);
          removed.add(i);
          return;
        }
        if (r.text != null) {
          const p = allocUtf16(mod, r.text);
          const ok = mod.FPDFText_SetText(objs[i], p);
          rt.wasmExports.free(p);
          if (!ok) throw new Error("PDFium: FPDFText_SetText failed");
        }
      });

      const s = style.fontScale && style.fontScale !== 1 ? style.fontScale : 0;
      runs.forEach((_, i) => {
        if (removed.has(i)) return;
        const obj = objs[i];
        // Anchor for scale/skew: the shared line origin, else this run's own
        // baseline origin (text-matrix e,f) so it doesn't drift.
        let ax = style.anchor?.[0];
        let ay = style.anchor?.[1];
        if (ax == null || ay == null) {
          ax = 0;
          ay = 0;
          if (mod.FPDFPageObj_GetMatrix(obj, mPtr)) {
            ax = rt.getValue(mPtr + 16, "float");
            ay = rt.getValue(mPtr + 20, "float");
          }
        }
        if (style.fill) mod.FPDFPageObj_SetFillColor(obj, ...style.fill);
        if (s) {
          // Scale about the anchor so the baseline stays put.
          mod.FPDFPageObj_Transform(obj, s, 0, 0, s, ax * (1 - s), ay * (1 - s));
        }
        if (style.synthItalic) {
          // Shear x by y about the baseline: x' = x + k·(y − ay).
          mod.FPDFPageObj_Transform(obj, 1, 0, ITALIC_SKEW, 1, -ITALIC_SKEW * ay, 0);
        }
        if (style.synthBold) {
          // Fill+stroke with a hairline in the ink color reads as a bold face.
          mod.FPDFTextObj_GetFontSize(obj, fs);
          const size = rt.getValue(fs, "float") * (s || 1);
          const ink = style.fill ?? readFillColor(mod, obj);
          mod.FPDFPageObj_SetStrokeColor(obj, ink[0], ink[1], ink[2], ink[3]);
          mod.FPDFPageObj_SetStrokeWidth(obj, Math.max(0.05, size * 0.032));
          mod.FPDFTextObj_SetTextRenderMode(obj, FPDF_TEXTRENDERMODE_FILL_STROKE);
        }
      });
    } finally {
      rt.wasmExports.free(mPtr);
      rt.wasmExports.free(fs);
    }
  });
}

/** The font behind a text run: its base name and decoded font program. */
export interface FontInfo {
  /** Base font name, possibly with a subset prefix ("ABCDEF+Lato-Bold"). */
  name: string;
  /**
   * Decoded font program bytes (PDFium substitutes a system face for
   * unembedded fonts), or null when no data is available. Used to check
   * glyph coverage before committing an in-place text edit.
   */
  data: Uint8Array | null;
}

export async function getFontInfo(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
): Promise<FontInfo> {
  return withDoc(bytes, (mod, doc) => {
    const rt = rtx(mod);
    const page = mod.FPDF_LoadPage(doc, pageIndex);
    try {
      const obj = mod.FPDFPage_GetObject(page, objectIndex);
      if (!obj || mod.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        throw new Error(`PDFium: object ${objectIndex} is not a text object`);
      }
      const font = mod.FPDFTextObj_GetFont(obj);
      if (!font) return { name: "", data: null };

      let name = "";
      const n = mod.FPDFFont_GetBaseFontName(font, 0, 0);
      if (n > 0) {
        const nb = rt.wasmExports.malloc(n);
        mod.FPDFFont_GetBaseFontName(font, nb, n);
        name = readUtf8(mod, nb, n);
        rt.wasmExports.free(nb);
      }

      // Two-pass read of the decoded font program.
      let data: Uint8Array | null = null;
      const lenPtr = rt.wasmExports.malloc(4);
      try {
        if (mod.FPDFFont_GetFontData(font, 0, 0, lenPtr)) {
          const size = rt.getValue(lenPtr, "i32");
          if (size > 0) {
            const buf = rt.wasmExports.malloc(size);
            if (mod.FPDFFont_GetFontData(font, buf, size, lenPtr)) {
              data = rt.HEAPU8.slice(buf, buf + size);
            }
            rt.wasmExports.free(buf);
          }
        }
      } finally {
        rt.wasmExports.free(lenPtr);
      }
      return { name, data };
    } finally {
      mod.FPDF_ClosePage(page);
    }
  });
}

/** Set the fill/stroke color (RGBA 0–255) and/or stroke width of a page object. */
export async function setObjectStyle(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
  style: ObjectStyle,
): Promise<Uint8Array> {
  return editPage(bytes, pageIndex, (mod, page) => {
    const obj = mod.FPDFPage_GetObject(page, objectIndex);
    if (!obj) throw new Error(`PDFium: object ${objectIndex} not found`);
    if (style.fill) mod.FPDFPageObj_SetFillColor(obj, ...style.fill);
    if (style.stroke) mod.FPDFPageObj_SetStrokeColor(obj, ...style.stroke);
    if (style.strokeWidth != null) mod.FPDFPageObj_SetStrokeWidth(obj, style.strokeWidth);
  });
}

/** Open a page, run an edit, regenerate its content, and save to fresh bytes. */
async function editPage(
  bytes: Uint8Array,
  pageIndex: number,
  fn: (mod: WrappedPdfiumModule, page: number, doc: number) => void,
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
      fn(mod, page, doc);
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

// --- Password protection (AES-256) -----------------------------------------

/**
 * PDF permission bits (spec table 22). What the USER password holder may do;
 * the owner password always has full access. Never cryptographically enforced
 * — compliant viewers honor them, but they are advisory.
 */
export const PDF_PERMISSIONS = {
  print: 4,
  modifyContents: 8,
  copyContents: 16,
  modifyAnnotations: 32,
  fillForms: 256,
  extractForAccessibility: 512,
  assembleDocument: 1024,
  printHighQuality: 2048,
  allowAll: 3900,
} as const;

export interface EncryptOptions {
  /** Password required to OPEN the document ("" = none; anyone can open). */
  userPassword: string;
  /** Password that unlocks full permissions. Required by PDFium. */
  ownerPassword: string;
  /** OR'd PDF_PERMISSIONS bits granted to the user-password holder. */
  permissions: number;
}

/**
 * Encrypt a document with AES-256 (PDF 2.0 security handler, revision 6).
 * The input must not already be encrypted. Returns fresh encrypted bytes.
 */
export async function encryptPdf(
  bytes: Uint8Array,
  opts: EncryptOptions,
): Promise<Uint8Array> {
  return withDoc(bytes, (mod, doc) => {
    const ok = mod.EPDF_SetEncryption(
      doc,
      opts.userPassword,
      opts.ownerPassword,
      opts.permissions,
    );
    if (!ok) {
      throw new Error(
        "PDFium: could not set encryption (is the document already encrypted?)",
      );
    }
    return saveAsCopy(mod, doc);
  });
}

/** Thrown when removing protection needs the owner (permissions) password. */
export class OwnerPasswordError extends Error {
  constructor() {
    super("The permissions (owner) password is required");
    this.name = "OwnerPasswordError";
  }
}

/**
 * Remove encryption: open with `password` and save a fully decrypted copy.
 * Requires OWNER rights — opening with the user password alone (or no password
 * on a restrictions-only file) throws OwnerPasswordError instead of silently
 * stripping the document's restrictions. Returns fresh bytes that open
 * everywhere without a password.
 */
export async function decryptPdf(
  bytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const mod = await getPdfium();
  const rt = runtime(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, password);
  if (!doc) {
    const err = mod.FPDF_GetLastError();
    rt.wasmExports.free(filePtr);
    throw new Error(
      err === 4
        ? "Wrong password"
        : `PDFium: could not open document (err ${err})`,
    );
  }
  try {
    // Opening with the owner password grants owner rights implicitly; a user
    // password (or "" on a restrictions-only file) does not — try to elevate
    // with the same string, then refuse rather than bypass the restrictions.
    if (!mod.EPDF_IsOwnerUnlocked(doc)) {
      if (!password || !mod.EPDF_UnlockOwnerPermissions(doc, password)) {
        throw new OwnerPasswordError();
      }
    }
    if (!mod.EPDF_RemoveEncryption(doc)) {
      throw new Error("PDFium: could not remove encryption");
    }
    return saveAsCopy(mod, doc);
  } finally {
    mod.FPDF_CloseDocument(doc);
    rt.wasmExports.free(filePtr);
  }
}

// --- Flatten ----------------------------------------------------------------

const FLAT_NORMALDISPLAY = 0;
const FLATTEN_FAIL = 0;

/**
 * Flatten every page: existing PDF annotations and form fields are baked into
 * the page content stream and stop being interactive objects. Returns fresh
 * bytes (unchanged input if there was nothing to flatten anywhere).
 */
export async function flattenPdf(bytes: Uint8Array): Promise<Uint8Array> {
  return withDoc(bytes, (mod, doc) => {
    let changed = false;
    const pages = mod.FPDF_GetPageCount(doc);
    for (let p = 0; p < pages; p++) {
      const page = mod.FPDF_LoadPage(doc, p);
      if (!page) continue;
      try {
        const res = mod.FPDFPage_Flatten(page, FLAT_NORMALDISPLAY);
        if (res !== FLATTEN_FAIL) changed = true;
      } finally {
        mod.FPDF_ClosePage(page);
      }
    }
    return changed ? saveAsCopy(mod, doc) : bytes;
  });
}

// --- Attachments (embedded files) -------------------------------------------

export interface AttachmentInfo {
  index: number;
  name: string;
  /** Payload size in bytes (0 when the entry has no file stream). */
  size: number;
}

/** List the document's embedded files (name + size). */
export async function listAttachments(bytes: Uint8Array): Promise<AttachmentInfo[]> {
  return withDoc(bytes, (mod, doc) => {
    const rt = rtx(mod);
    const out: AttachmentInfo[] = [];
    const count = mod.FPDFDoc_GetAttachmentCount(doc);
    const lenPtr = rt.wasmExports.malloc(4);
    try {
      for (let i = 0; i < count; i++) {
        const att = mod.FPDFDoc_GetAttachment(doc, i);
        if (!att) continue;
        // Name: two-pass UTF-16 read.
        const need = mod.FPDFAttachment_GetName(att, 0, 0);
        let name = "";
        if (need > 0) {
          const buf = rt.wasmExports.malloc(need * 2);
          mod.FPDFAttachment_GetName(att, buf, need);
          name = readUtf16(mod, buf, need * 2);
          rt.wasmExports.free(buf);
        }
        // Size: query pass with a null buffer.
        rt.setValue(lenPtr, 0, "i32");
        mod.FPDFAttachment_GetFile(att, 0, 0, lenPtr);
        out.push({ index: i, name, size: rt.getValue(lenPtr, "i32") >>> 0 });
      }
      return out;
    } finally {
      rt.wasmExports.free(lenPtr);
    }
  });
}

/** Read one embedded file's payload. */
export async function getAttachmentData(
  bytes: Uint8Array,
  index: number,
): Promise<Uint8Array> {
  return withDoc(bytes, (mod, doc) => {
    const rt = rtx(mod);
    const att = mod.FPDFDoc_GetAttachment(doc, index);
    if (!att) throw new Error("PDFium: attachment not found");
    const lenPtr = rt.wasmExports.malloc(4);
    try {
      rt.setValue(lenPtr, 0, "i32");
      if (!mod.FPDFAttachment_GetFile(att, 0, 0, lenPtr)) {
        throw new Error("PDFium: attachment has no file stream");
      }
      const size = rt.getValue(lenPtr, "i32") >>> 0;
      const buf = rt.wasmExports.malloc(Math.max(1, size));
      try {
        mod.FPDFAttachment_GetFile(att, buf, size, lenPtr);
        return rt.HEAPU8.slice(buf, buf + size);
      } finally {
        rt.wasmExports.free(buf);
      }
    } finally {
      rt.wasmExports.free(lenPtr);
    }
  });
}

/** Embed a file into the document. Returns fresh bytes. */
export async function addAttachment(
  bytes: Uint8Array,
  name: string,
  data: Uint8Array,
): Promise<Uint8Array> {
  return withDoc(bytes, (mod, doc) => {
    const rt = rtx(mod);
    const namePtr = allocUtf16(mod, name);
    try {
      const att = mod.FPDFDoc_AddAttachment(doc, namePtr);
      if (!att) throw new Error("PDFium: could not add attachment");
      const dataPtr = toHeap(mod, data);
      try {
        if (!mod.FPDFAttachment_SetFile(att, doc, dataPtr, data.length)) {
          throw new Error("PDFium: could not write attachment data");
        }
      } finally {
        rt.wasmExports.free(dataPtr);
      }
      return saveAsCopy(mod, doc);
    } finally {
      rt.wasmExports.free(namePtr);
    }
  });
}

/** Delete the embedded file at `index`. Returns fresh bytes. */
export async function removeAttachment(
  bytes: Uint8Array,
  index: number,
): Promise<Uint8Array> {
  return withDoc(bytes, (mod, doc) => {
    if (!mod.FPDFDoc_DeleteAttachment(doc, index)) {
      throw new Error("PDFium: could not delete attachment");
    }
    return saveAsCopy(mod, doc);
  });
}

// --- Compress / optimize (image downsampling) --------------------------------

export interface CompressOptions {
  /** JPEG quality 0–1 (canvas encoder scale). */
  quality: number;
  /** Downsample images above this effective resolution (dots per inch). */
  targetDpi: number;
}

export interface CompressResult {
  bytes: Uint8Array;
  /** Input / output file sizes in bytes. */
  before: number;
  after: number;
  imagesProcessed: number;
}

/**
 * Shrink the document by downsampling and re-encoding its images: every image
 * whose effective resolution exceeds `targetDpi` (or whose stored data is far
 * larger than a re-encode) is decoded, scaled down on a canvas, and re-embedded
 * as JPEG (opaque) or PNG (has transparency, keeps its alpha). Text and vector
 * content are untouched.
 */
export async function compressImages(
  bytes: Uint8Array,
  opts: CompressOptions,
): Promise<CompressResult> {
  const mod = await getPdfium();
  const rt = rtx(mod);
  const filePtr = toHeap(mod, bytes);
  const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, "");
  if (!doc) {
    rt.wasmExports.free(filePtr);
    throw new Error(`PDFium: could not open document (err ${mod.FPDF_GetLastError()})`);
  }
  let imagesProcessed = 0;
  try {
    const i4a = rt.wasmExports.malloc(4);
    const i4b = rt.wasmExports.malloc(4);
    const f4 = rt.wasmExports.malloc(16);
    const pageArr = rt.wasmExports.malloc(4); // FPDF_PAGE[1] for SetJpeg/SetPng
    try {
      const pageCount = mod.FPDF_GetPageCount(doc);
      for (let p = 0; p < pageCount; p++) {
        const page = mod.FPDF_LoadPage(doc, p);
        if (!page) continue;
        let pageChanged = false;
        try {
          rt.setValue(pageArr, page, "i32");
          const count = mod.FPDFPage_CountObjects(page);
          for (let i = 0; i < count; i++) {
            const obj = mod.FPDFPage_GetObject(page, i);
            if (mod.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) continue;
            if (!mod.FPDFImageObj_GetImagePixelSize(obj, i4a, i4b)) continue;
            const pxW = rt.getValue(i4a, "i32");
            const pxH = rt.getValue(i4b, "i32");
            if (pxW < 32 || pxH < 32) continue; // icons etc — not worth it
            if (!mod.FPDFPageObj_GetBounds(obj, f4, f4 + 4, f4 + 8, f4 + 12)) continue;
            const wPts = rt.getValue(f4 + 8, "float") - rt.getValue(f4, "float");
            const hPts = rt.getValue(f4 + 12, "float") - rt.getValue(f4 + 4, "float");
            if (wPts <= 1 || hPts <= 1) continue;
            // Effective DPI at the size the image is actually displayed.
            const dpi = pxW / (wPts / 72);
            const targetW = Math.max(32, Math.round((wPts / 72) * opts.targetDpi));
            const targetH = Math.max(32, Math.round((hPts / 72) * opts.targetDpi));
            const downsample = dpi > opts.targetDpi * 1.15;
            // Stored size — re-encoding tiny streams just bloats the file.
            const storedSize = mod.FPDFImageObj_GetImageDataRaw(obj, 0, 0);
            if (!downsample && storedSize < 50_000) continue;

            // Decode at native size (raw pixels, matrix and mask ignored).
            const bmp = mod.FPDFImageObj_GetBitmap(obj);
            if (!bmp) continue;
            try {
              const encoded = encodeBitmapScaled(
                mod,
                bmp,
                downsample ? Math.min(pxW, targetW) : pxW,
                downsample ? Math.min(pxH, targetH) : pxH,
                opts.quality,
              );
              if (!encoded || encoded.data.length >= storedSize * 0.9) continue;
              const dataPtr = toHeap(mod, encoded.data);
              const ok = encoded.png
                ? mod.EPDFImageObj_SetPng(pageArr, 1, obj, dataPtr, encoded.data.length)
                : mod.EPDFImageObj_SetJpeg(pageArr, 1, obj, dataPtr, encoded.data.length);
              rt.wasmExports.free(dataPtr);
              if (ok) {
                imagesProcessed++;
                pageChanged = true;
              }
            } finally {
              mod.FPDFBitmap_Destroy(bmp);
            }
          }
          if (pageChanged) mod.FPDFPage_GenerateContent(page);
        } finally {
          mod.FPDF_ClosePage(page);
        }
      }
    } finally {
      rt.wasmExports.free(i4a);
      rt.wasmExports.free(i4b);
      rt.wasmExports.free(f4);
      rt.wasmExports.free(pageArr);
    }
    const out = imagesProcessed ? saveAsCopy(mod, doc) : bytes;
    return {
      bytes: out,
      before: bytes.length,
      after: out.length,
      imagesProcessed,
    };
  } finally {
    mod.FPDF_CloseDocument(doc);
    rt.wasmExports.free(filePtr);
  }
}

// FPDFBitmap formats (fpdfview.h).
const FPDFBitmap_Gray = 1;
const FPDFBitmap_BGR = 2;
const FPDFBitmap_BGRx = 3;
const FPDFBitmap_BGRA = 4;

/**
 * Read a PDFium bitmap, scale it to `outW`×`outH` on a canvas and encode it —
 * JPEG for opaque images, PNG when real transparency is present. Returns null
 * when the bitmap format is unsupported or encoding fails.
 */
function encodeBitmapScaled(
  mod: WrappedPdfiumModule,
  bmp: number,
  outW: number,
  outH: number,
  quality: number,
): { data: Uint8Array; png: boolean } | null {
  const rt = rtx(mod);
  const w = mod.FPDFBitmap_GetWidth(bmp);
  const h = mod.FPDFBitmap_GetHeight(bmp);
  const format = mod.FPDFBitmap_GetFormat(bmp);
  const stride = mod.FPDFBitmap_GetStride(bmp);
  const bufPtr = mod.FPDFBitmap_GetBuffer(bmp);
  if (!w || !h || !bufPtr) return null;

  const rgba = new Uint8ClampedArray(w * h * 4);
  const heap = rt.HEAPU8;
  let hasAlpha = false;
  for (let y = 0; y < h; y++) {
    let src = bufPtr + y * stride;
    let dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 255;
      switch (format) {
        case FPDFBitmap_Gray:
          r = g = b = heap[src];
          src += 1;
          break;
        case FPDFBitmap_BGR:
          b = heap[src];
          g = heap[src + 1];
          r = heap[src + 2];
          src += 3;
          break;
        case FPDFBitmap_BGRx:
          b = heap[src];
          g = heap[src + 1];
          r = heap[src + 2];
          src += 4;
          break;
        case FPDFBitmap_BGRA:
          b = heap[src];
          g = heap[src + 1];
          r = heap[src + 2];
          a = heap[src + 3];
          if (a < 255) hasAlpha = true;
          src += 4;
          break;
        default:
          return null;
      }
      rgba[dst] = r;
      rgba[dst + 1] = g;
      rgba[dst + 2] = b;
      rgba[dst + 3] = a;
      dst += 4;
    }
  }

  const full = document.createElement("canvas");
  full.width = w;
  full.height = h;
  full.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);

  let canvas = full;
  if (outW < w || outH < h) {
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, outW);
    canvas.height = Math.max(1, outH);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }

  const dataUrl = hasAlpha
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const bin = atob(dataUrl.slice(comma + 1));
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, png: hasAlpha };
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

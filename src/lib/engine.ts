// PDFium-backed document engine — the app's single PDF runtime.
//
// Replaces pdf.js entirely: rendering, text layer geometry, search text,
// outline, links, form-field reading and metadata all come from the same
// PDFium (WASM) instance that already powers editing (see pdfium.ts).
//
// Lifecycle: unlike pdfium.ts's one-shot withDoc() helpers (open → op →
// close), the engine keeps a document handle ALIVE for the viewer — pages,
// text pages and the form handle are cached and freed on destroy(), mirroring
// how the store managed pdf.js proxies.

import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import type { OutlineNode } from "../types";

const FPDF_ANNOT = 0x01;
const FPDF_LCD_TEXT = 0x02;

let modPromise: Promise<WrappedPdfiumModule> | null = null;

async function getModule(): Promise<WrappedPdfiumModule> {
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

/** Loosely-typed emscripten runtime (not all members are in the .d.ts). */
function rt(mod: WrappedPdfiumModule) {
  return mod.pdfium as unknown as {
    HEAPU8: Uint8Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;
    wasmExports: { malloc: (n: number) => number; free: (p: number) => void };
    setValue: (ptr: number, value: number, type: string) => void;
    getValue: (ptr: number, type: string) => number;
  };
}

function toHeap(mod: WrappedPdfiumModule, bytes: Uint8Array): number {
  const r = rt(mod);
  const ptr = r.wasmExports.malloc(bytes.length);
  r.HEAPU8.set(bytes, ptr);
  return ptr;
}

/** Read a UTF-16LE string a PDFium `Get…Text`-style API wrote to the heap. */
function readUtf16(mod: WrappedPdfiumModule, ptr: number, bytes: number): string {
  const r = rt(mod);
  // bytes includes the trailing NUL (2 bytes).
  const chars = Math.max(0, bytes / 2 - 1);
  const view = new Uint16Array(r.HEAPU8.buffer, ptr, chars);
  return String.fromCharCode(...Array.from(view));
}

/** Call a PDFium "write UTF-16 into buffer" API with auto-sizing. */
function withUtf16Buffer(
  mod: WrappedPdfiumModule,
  call: (ptr: number, cap: number) => number,
): string {
  const r = rt(mod);
  const needed = call(0, 0); // byte count incl. NUL
  if (needed <= 2) return "";
  const ptr = r.wasmExports.malloc(needed);
  try {
    const written = call(ptr, needed);
    return readUtf16(mod, ptr, written);
  } finally {
    r.wasmExports.free(ptr);
  }
}

export class PasswordError extends Error {
  constructor() {
    super("Password required or incorrect");
    this.name = "PasswordError";
  }
}

export interface TextRunGeom {
  /** Display-space rect (CSS px at scale 1 == PDF points, origin top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface LinkGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  url?: string;
  destPageIndex?: number;
}

export interface FieldInfo {
  name: string;
  /** PDFium field types: 1=pushbutton 2=checkbox 3=radio 4=combo 5=list 6=text. */
  fieldType: number;
  value: string;
  isChecked: boolean;
  exportValue: string;
  options: string[];
  flags: number;
  readOnly: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * pdf.js-compatible viewport: display size at `scale` plus the two coordinate
 * conversions the app uses (screen↔page space, rotation-aware via PDFium).
 */
export class PageViewport {
  readonly width: number;
  readonly height: number;

  constructor(
    private page: PdfPage,
    readonly scale: number,
  ) {
    this.width = page.width * scale;
    this.height = page.height * scale;
  }

  /** Display px (top-left origin) → PDF page point (bottom-left origin). */
  convertToPdfPoint(x: number, y: number): [number, number] {
    return this.page.deviceToPage(x / this.scale, y / this.scale);
  }

  /** PDF page rect [x1,y1,x2,y2] → display rect [vx1,vy1,vx2,vy2] at scale. */
  convertToViewportRectangle(rect: [number, number, number, number]): [number, number, number, number] {
    const [x1, y1, x2, y2] = rect;
    const d = this.page.pageRectToDisplay(
      Math.min(x1, x2),
      Math.max(y1, y2),
      Math.max(x1, x2),
      Math.min(y1, y2),
    );
    return [d.x * this.scale, d.y * this.scale, (d.x + d.w) * this.scale, (d.y + d.h) * this.scale];
  }
}

/** pdf.js-shaped annotation objects (only the properties the app reads). */
export interface CompatAnnotation {
  subtype: "Link" | "Widget";
  /** PDF page-space [x1,y1,x2,y2] — feed to viewport.convertToViewportRectangle. */
  rect: [number, number, number, number];
  url?: string;
  /** Internal links: already-resolved 0-based page index. */
  destPage?: number;
  // Widget fields:
  id?: string;
  fieldName?: string;
  fieldType?: "Tx" | "Btn" | "Ch";
  fieldValue?: string;
  buttonValue?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  multiLine?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  options?: Array<{ displayValue: string; exportValue: string }>;
}

export class PdfPage {
  private textPage = 0;

  constructor(
    private mod: WrappedPdfiumModule,
    private doc: PdfDoc,
    readonly index: number,
    /** PDFium page handle. */
    readonly handle: number,
    /** Display size in PDF points (rotation already applied by PDFium). */
    readonly width: number,
    readonly height: number,
    /** /Rotate in quarter turns (0-3). */
    readonly rotation: number,
  ) {}

  private get form() {
    return this.doc.formHandle;
  }

  /** Lazily open (and cache) the text page. */
  private text(): number {
    if (!this.textPage) this.textPage = this.mod.FPDFText_LoadPage(this.handle);
    return this.textPage;
  }

  /** pdf.js-compatible viewport at `scale`. */
  getViewport({ scale }: { scale: number }): PageViewport {
    return new PageViewport(this, scale);
  }

  /** Display point at scale 1 (top-left origin) → page space (bottom-left). */
  deviceToPage(x: number, y: number): [number, number] {
    const m = this.mod;
    const r = rt(m);
    const buf = r.wasmExports.malloc(16); // two doubles
    try {
      const W = Math.round(this.width);
      const H = Math.round(this.height);
      m.FPDF_DeviceToPage(this.handle, 0, 0, W, H, 0, Math.round(x), Math.round(y), buf, buf + 8);
      return [r.getValue(buf, "double"), r.getValue(buf + 8, "double")];
    } finally {
      r.wasmExports.free(buf);
    }
  }

  /**
   * pdf.js-compatible render: paints into `canvasContext.canvas` at the
   * viewport's scale. Synchronous under the hood; `cancel()` is a no-op.
   */
  render({ canvasContext, viewport }: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }) {
    const run = async () => {
      this.renderToCanvas(canvasContext.canvas, viewport.scale);
    };
    return { promise: run(), cancel: () => {} };
  }

  /** pdf.js-compatible annotations (links + form widgets). */
  async getAnnotations(): Promise<CompatAnnotation[]> {
    const out: CompatAnnotation[] = [];
    for (const l of this.getLinks()) {
      out.push({
        subtype: "Link",
        rect: this.displayRectToPageRect(l),
        url: l.url,
        destPage: l.destPageIndex,
      });
    }
    const TYPE_MAP: Record<number, "Tx" | "Btn" | "Ch"> = {
      1: "Btn",
      2: "Btn",
      3: "Btn",
      4: "Ch",
      5: "Ch",
      6: "Tx",
    };
    this.getFields().forEach((f, i) => {
      const t = TYPE_MAP[f.fieldType];
      if (!t || !f.name) return;
      out.push({
        subtype: "Widget",
        rect: this.displayRectToPageRect(f.rect),
        id: `${f.name}#${i}`,
        fieldName: f.name,
        fieldType: t,
        fieldValue: f.value,
        buttonValue: f.exportValue || undefined,
        checkBox: f.fieldType === 2,
        radioButton: f.fieldType === 3,
        multiLine: (f.flags & (1 << 12)) !== 0,
        readOnly: f.readOnly,
        hidden: false,
        options: f.options.map((o) => ({ displayValue: o, exportValue: o })),
      });
    });
    return out;
  }

  /** Display-space rect (scale 1, top-left origin) → page-space [x1,y1,x2,y2]. */
  private displayRectToPageRect(r: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
    const [x1, y1] = this.deviceToPage(r.x, r.y + r.h);
    const [x2, y2] = this.deviceToPage(r.x + r.w, r.y);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  /** Map a page-space rect (origin bottom-left) to display space at scale 1. */
  pageRectToDisplay(left: number, top: number, right: number, bottom: number) {
    const m = this.mod;
    const r = rt(m);
    const buf = r.wasmExports.malloc(16); // two int pairs
    try {
      const W = Math.round(this.width);
      const H = Math.round(this.height);
      m.FPDF_PageToDevice(this.handle, 0, 0, W, H, 0, left, top, buf, buf + 4);
      const x1 = r.getValue(buf, "i32");
      const y1 = r.getValue(buf + 4, "i32");
      m.FPDF_PageToDevice(this.handle, 0, 0, W, H, 0, right, bottom, buf, buf + 4);
      const x2 = r.getValue(buf, "i32");
      const y2 = r.getValue(buf + 4, "i32");
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      };
    } finally {
      r.wasmExports.free(buf);
    }
  }

  /** Render into `canvas` at `scale` device px per point. */
  renderToCanvas(canvas: HTMLCanvasElement, scale: number): void {
    const m = this.mod;
    const r = rt(m);
    const W = Math.max(1, Math.round(this.width * scale));
    const H = Math.max(1, Math.round(this.height * scale));
    canvas.width = W;
    canvas.height = H;

    const bitmap = m.FPDFBitmap_CreateEx(W, H, 4 /* BGRA */, 0, 0);
    m.FPDFBitmap_FillRect(bitmap, 0, 0, W, H, 0xffffffff);
    m.FPDF_RenderPageBitmap(bitmap, this.handle, 0, 0, W, H, 0, FPDF_ANNOT | FPDF_LCD_TEXT);
    // Draw existing form-field values (widget appearance streams).
    if (this.form) {
      try {
        m.FPDF_FFLDraw(this.form, bitmap, this.handle, 0, 0, W, H, 0, FPDF_ANNOT);
      } catch {
        /* form drawing is best-effort */
      }
    }

    const bufPtr = m.FPDFBitmap_GetBuffer(bitmap);
    const stride = m.FPDFBitmap_GetStride(bitmap);
    const out = new Uint8ClampedArray(W * H * 4);
    const out32 = new Uint32Array(out.buffer);
    // BGRA → RGBA via 32-bit swizzle, row by row (stride can exceed W*4).
    for (let y = 0; y < H; y++) {
      const src32 = new Uint32Array(r.HEAPU8.buffer, bufPtr + y * stride, W);
      const dstRow = y * W;
      for (let x = 0; x < W; x++) {
        const v = src32[x];
        out32[dstRow + x] =
          (v & 0xff00ff00) | ((v & 0x00ff0000) >>> 16) | ((v & 0x000000ff) << 16);
      }
    }
    m.FPDFBitmap_Destroy(bitmap);

    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(new ImageData(out, W, H), 0, 0);
  }

  /** Full page text (reading order), for search / AI context. */
  getText(): string {
    const m = this.mod;
    const tp = this.text();
    const count = m.FPDFText_CountChars(tp);
    if (count <= 0) return "";
    const r = rt(m);
    const ptr = r.wasmExports.malloc((count + 1) * 2);
    try {
      const written = m.FPDFText_GetText(tp, 0, count, ptr);
      return readUtf16(m, ptr, written * 2);
    } finally {
      r.wasmExports.free(ptr);
    }
  }

  /**
   * Text runs with display-space geometry — the basis of the selectable
   * text layer. PDFium groups contiguous same-line text into rects.
   */
  getTextRuns(): TextRunGeom[] {
    const m = this.mod;
    const tp = this.text();
    const total = m.FPDFText_CountChars(tp);
    if (total <= 0) return [];
    const r = rt(m);
    const runs: TextRunGeom[] = [];
    const nRects = m.FPDFText_CountRects(tp, 0, total);
    const rectBuf = r.wasmExports.malloc(32); // 4 doubles
    try {
      for (let i = 0; i < nRects; i++) {
        m.FPDFText_GetRect(tp, i, rectBuf, rectBuf + 8, rectBuf + 16, rectBuf + 24);
        const left = r.getValue(rectBuf, "double");
        const top = r.getValue(rectBuf + 8, "double");
        const right = r.getValue(rectBuf + 16, "double");
        const bottom = r.getValue(rectBuf + 24, "double");
        // GetBoundedText counts CHARACTERS with no NUL terminator — don't
        // reuse the byte-count helper or the last char gets truncated.
        const charCount = m.FPDFText_GetBoundedText(tp, left, top, right, bottom, 0, 0);
        if (charCount <= 0) continue;
        const tptr = r.wasmExports.malloc((charCount + 1) * 2);
        let text = "";
        try {
          const written = m.FPDFText_GetBoundedText(tp, left, top, right, bottom, tptr, charCount);
          const view = new Uint16Array(r.HEAPU8.buffer, tptr, Math.max(0, written));
          text = String.fromCharCode(...Array.from(view)).replace(/\0+$/, "");
        } finally {
          r.wasmExports.free(tptr);
        }
        if (!text.trim()) continue;
        const d = this.pageRectToDisplay(left, top, right, bottom);
        if (d.w <= 0 || d.h <= 0) continue;
        runs.push({ ...d, text });
      }
    } finally {
      r.wasmExports.free(rectBuf);
    }
    return runs;
  }

  /** Link annotations with display-space rects and resolved targets. */
  getLinks(): LinkGeom[] {
    const m = this.mod;
    const r = rt(m);
    const links: LinkGeom[] = [];
    const posBuf = r.wasmExports.malloc(4);
    const rectBuf = r.wasmExports.malloc(16); // FS_RECTF: 4 floats
    try {
      r.setValue(posBuf, 0, "i32");
      // FPDFLink_Enumerate(page, &pos, &link)
      const linkPtrBuf = r.wasmExports.malloc(4);
      try {
        for (;;) {
          const ok = m.FPDFLink_Enumerate(this.handle, posBuf, linkPtrBuf);
          if (!ok) break;
          const link = r.getValue(linkPtrBuf, "i32");
          if (!link) continue;
          if (!m.FPDFLink_GetAnnotRect(link, rectBuf)) continue;
          const left = r.getValue(rectBuf, "float");
          const top = r.getValue(rectBuf + 4, "float");
          const right = r.getValue(rectBuf + 8, "float");
          const bottom = r.getValue(rectBuf + 12, "float");
          const d = this.pageRectToDisplay(left, top, right, bottom);

          const out: LinkGeom = { ...d };
          let dest = m.FPDFLink_GetDest(this.doc.handle, link);
          const action = m.FPDFLink_GetAction(link);
          if (!dest && action) {
            const type = m.FPDFAction_GetType(action);
            if (type === 1 /* GOTO */) {
              dest = m.FPDFAction_GetDest(this.doc.handle, action);
            } else if (type === 3 /* URI */) {
              const url = withAsciiBuffer(m, (p, cap) =>
                m.FPDFAction_GetURIPath(this.doc.handle, action, p, cap),
              );
              if (url) out.url = url;
            }
          }
          if (dest) {
            const idx = m.FPDFDest_GetDestPageIndex(this.doc.handle, dest);
            if (idx >= 0) out.destPageIndex = idx;
          }
          if (out.url || out.destPageIndex !== undefined) links.push(out);
        }
      } finally {
        r.wasmExports.free(linkPtrBuf);
      }
    } finally {
      r.wasmExports.free(posBuf);
      r.wasmExports.free(rectBuf);
    }
    return links;
  }

  /** Existing AcroForm widgets on this page (for the fill layer). */
  getFields(): FieldInfo[] {
    const m = this.mod;
    const r = rt(m);
    const form = this.form;
    if (!form) return [];
    const fields: FieldInfo[] = [];
    const n = m.FPDFPage_GetAnnotCount(this.handle);
    const rectBuf = r.wasmExports.malloc(16);
    try {
      for (let i = 0; i < n; i++) {
        const annot = m.FPDFPage_GetAnnot(this.handle, i);
        if (!annot) continue;
        try {
          if (m.FPDFAnnot_GetSubtype(annot) !== 20 /* WIDGET */) continue;
          const fieldType = m.FPDFAnnot_GetFormFieldType(form, annot);
          if (fieldType < 0) continue;
          const name = withUtf16Buffer(m, (p, cap) =>
            m.FPDFAnnot_GetFormFieldName(form, annot, p, cap),
          );
          const value = withUtf16Buffer(m, (p, cap) =>
            m.FPDFAnnot_GetFormFieldValue(form, annot, p, cap),
          );
          const exportValue = withUtf16Buffer(m, (p, cap) =>
            m.FPDFAnnot_GetFormFieldExportValue(form, annot, p, cap),
          );
          const flags = m.FPDFAnnot_GetFormFieldFlags(form, annot);
          const options: string[] = [];
          const optCount = m.FPDFAnnot_GetOptionCount(form, annot);
          for (let o = 0; o < optCount; o++) {
            options.push(
              withUtf16Buffer(m, (p, cap) => m.FPDFAnnot_GetOptionLabel(form, annot, o, p, cap)),
            );
          }
          if (!m.FPDFAnnot_GetRect(annot, rectBuf)) continue;
          const left = r.getValue(rectBuf, "float");
          const top = r.getValue(rectBuf + 4, "float");
          const right = r.getValue(rectBuf + 8, "float");
          const bottom = r.getValue(rectBuf + 12, "float");
          fields.push({
            name,
            fieldType,
            value,
            isChecked: !!m.FPDFAnnot_IsChecked(form, annot),
            exportValue,
            options,
            flags,
            readOnly: (flags & 1) !== 0,
            rect: this.pageRectToDisplay(left, top, right, bottom),
          });
        } finally {
          m.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      r.wasmExports.free(rectBuf);
    }
    return fields;
  }

  destroy(): void {
    if (this.textPage) {
      this.mod.FPDFText_ClosePage(this.textPage);
      this.textPage = 0;
    }
    this.mod.FPDF_ClosePage(this.handle);
  }
}

/** Call a PDFium "write ASCII/UTF-8 into buffer" API with auto-sizing. */
function withAsciiBuffer(
  mod: WrappedPdfiumModule,
  call: (ptr: number, cap: number) => number,
): string {
  const r = rt(mod);
  const needed = call(0, 0);
  if (needed <= 1) return "";
  const ptr = r.wasmExports.malloc(needed);
  try {
    const written = call(ptr, needed);
    let end = ptr + written;
    if (r.HEAPU8[end - 1] === 0) end--;
    return new TextDecoder().decode(r.HEAPU8.slice(ptr, end));
  } finally {
    r.wasmExports.free(ptr);
  }
}

export class PdfDoc {
  private pages = new Map<number, PdfPage>();
  private filePtr: number;
  formHandle = 0;
  private formInfoPtr = 0;
  readonly numPages: number;
  private destroyed = false;

  private constructor(
    private mod: WrappedPdfiumModule,
    readonly handle: number,
    filePtr: number,
  ) {
    this.filePtr = filePtr;
    this.numPages = mod.FPDF_GetPageCount(handle);
    // Zeroed FPDF_FORMFILLINFO (version 2) — enough for reading field values
    // and drawing widget appearances; we never run form JavaScript.
    const r = rt(mod);
    this.formInfoPtr = r.wasmExports.malloc(256);
    r.HEAPU8.fill(0, this.formInfoPtr, this.formInfoPtr + 256);
    r.setValue(this.formInfoPtr, 2, "i32"); // version
    try {
      this.formHandle = mod.FPDFDOC_InitFormFillEnvironment(handle, this.formInfoPtr);
    } catch {
      this.formHandle = 0;
    }
  }

  static async load(bytes: Uint8Array, password = ""): Promise<PdfDoc> {
    const mod = await getModule();
    const filePtr = toHeap(mod, bytes);
    const doc = mod.FPDF_LoadMemDocument(filePtr, bytes.length, password);
    if (!doc) {
      const err = mod.FPDF_GetLastError();
      rt(mod).wasmExports.free(filePtr);
      if (err === 4) throw new PasswordError();
      throw new Error(`PDFium: could not open document (err ${err})`);
    }
    return new PdfDoc(mod, doc, filePtr);
  }

  /** Load (and cache) a page. 0-based, synchronous. */
  page(index: number): PdfPage {
    const cached = this.pages.get(index);
    if (cached) return cached;
    const m = this.mod;
    const handle = m.FPDF_LoadPage(this.handle, index);
    if (!handle) throw new Error(`PDFium: could not load page ${index}`);
    const width = m.FPDF_GetPageWidthF(handle);
    const height = m.FPDF_GetPageHeightF(handle);
    const rotation = m.FPDFPage_GetRotation(handle);
    const page = new PdfPage(m, this, index, handle, width, height, rotation);
    this.pages.set(index, page);
    return page;
  }

  /** pdf.js-compatible page access: 1-based and async. */
  async getPage(oneBased: number): Promise<PdfPage> {
    return this.page(oneBased - 1);
  }

  /** Document outline (bookmarks) with resolved page indices. */
  getOutline(): OutlineNode[] {
    const m = this.mod;
    const walk = (parent: number): OutlineNode[] => {
      const out: OutlineNode[] = [];
      let bm = m.FPDFBookmark_GetFirstChild(this.handle, parent);
      while (bm) {
        const title = withUtf16Buffer(m, (p, cap) => m.FPDFBookmark_GetTitle(bm, p, cap));
        let pageIndex: number | null = null;
        let dest = m.FPDFBookmark_GetDest(this.handle, bm);
        if (!dest) {
          const action = m.FPDFBookmark_GetAction(bm);
          if (action && m.FPDFAction_GetType(action) === 1 /* GOTO */) {
            dest = m.FPDFAction_GetDest(this.handle, action);
          }
        }
        if (dest) {
          const idx = m.FPDFDest_GetDestPageIndex(this.handle, dest);
          if (idx >= 0) pageIndex = idx;
        }
        out.push({
          title: title || "Untitled",
          pageIndex,
          children: walk(bm),
        });
        bm = m.FPDFBookmark_GetNextSibling(this.handle, bm);
      }
      return out;
    };
    return walk(0);
  }

  /** pdf.js-compatible metadata: `{ info: { Title, Author, … } }`. */
  async getMetadata(): Promise<{ info: Record<string, string> }> {
    const m = this.mod;
    const info: Record<string, string> = {};
    for (const key of ["Title", "Author", "Subject", "Producer", "Creator", "CreationDate"]) {
      const v = withUtf16Buffer(m, (p, cap) => m.FPDF_GetMetaText(this.handle, key, p, cap));
      if (v) info[key] = v;
    }
    return { info };
  }

  /** pdf.js-compatible teardown (callers do `pdf.destroy().catch(...)`). */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const p of this.pages.values()) p.destroy();
    this.pages.clear();
    if (this.formHandle) {
      try {
        this.mod.FPDFDOC_ExitFormFillEnvironment(this.formHandle);
      } catch {
        /* best-effort */
      }
      this.formHandle = 0;
    }
    this.mod.FPDF_CloseDocument(this.handle);
    rt(this.mod).wasmExports.free(this.filePtr);
    if (this.formInfoPtr) {
      rt(this.mod).wasmExports.free(this.formInfoPtr);
      this.formInfoPtr = 0;
    }
  }
}

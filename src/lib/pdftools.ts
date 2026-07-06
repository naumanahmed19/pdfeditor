import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  StandardFonts,
  TextAlignment,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
} from "pdf-lib";
import type {
  Annotation,
  AnnotationMap,
  ExistingFieldOp,
  FormFieldAnnotation,
  NoteAnnotation,
  TextAnnotation,
} from "../types";
import type { OcrPage } from "./ocr";
import type { RedactRect } from "./pdfium";
import { hexToRgb01 } from "./utils";
import { getRuns, resolveRun, type ResolvedStyle } from "./richtext";

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of files) {
    const src = await load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

export async function extractPages(
  bytes: Uint8Array,
  pageIndexes: number[],
): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, pageIndexes);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/**
 * Build a print-ready PDF: keep only `pageIndexes` (in order) and optionally
 * scale each page's content. At scale 1 this is a faithful page subset
 * (rotation, annotations preserved via copyPages). At other scales each page
 * is re-emitted as a scaled XObject on a page of the scaled size, so a browser
 * printing "actual size" reproduces the chosen zoom.
 */
export async function buildPrintDoc(
  bytes: Uint8Array,
  pageIndexes: number[],
  scale = 1,
): Promise<Uint8Array> {
  if (scale === 1) return extractPages(bytes, pageIndexes);
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = pageIndexes.map((i) => src.getPage(i));
  const embedded = await out.embedPages(pages);
  embedded.forEach((emb, k) => {
    const { width, height } = pages[k].getSize();
    const page = out.addPage([width * scale, height * scale]);
    page.drawPage(emb, { xScale: scale, yScale: scale });
  });
  return out.save();
}

export async function deletePages(
  bytes: Uint8Array,
  pageIndexes: number[],
): Promise<Uint8Array> {
  const src = await load(bytes);
  const keep = src
    .getPageIndices()
    .filter((i) => !pageIndexes.includes(i));
  return extractPages(bytes, keep);
}

export async function rotatePage(
  bytes: Uint8Array,
  pageIndex: number,
  deltaDegrees: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const page = doc.getPage(pageIndex);
  const current = page.getRotation().angle;
  page.setRotation(degrees(((current + deltaDegrees) % 360 + 360) % 360));
  return doc.save();
}

export async function movePage(
  bytes: Uint8Array,
  from: number,
  to: number,
): Promise<Uint8Array> {
  const src = await load(bytes);
  const order = src.getPageIndices();
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return extractPages(bytes, order);
}

export async function insertBlankPage(
  bytes: Uint8Array,
  atIndex: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const ref = doc.getPage(Math.min(atIndex, doc.getPageCount() - 1));
  const { width, height } = ref.getSize();
  doc.insertPage(atIndex, [width, height]);
  return doc.save();
}

export async function duplicatePage(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const [copy] = await doc.copyPages(doc, [pageIndex]);
  doc.insertPage(pageIndex + 1, copy);
  return doc.save();
}

/** Insert all pages of another PDF at the given index. */
export async function insertPdfPages(
  bytes: Uint8Array,
  otherBytes: Uint8Array,
  atIndex: number,
): Promise<Uint8Array> {
  const dst = await load(bytes);
  const src = await load(otherBytes);
  const pages = await dst.copyPages(src, src.getPageIndices());
  pages.forEach((p, i) => dst.insertPage(atIndex + i, p));
  return dst.save();
}

/** Build a PDF from images (one full-size page per image). */
export async function imagesToPdfPages(
  doc: PDFDocument,
  image: { bytes: Uint8Array; type: string },
): Promise<void> {
  const embedded = image.type.includes("png")
    ? await doc.embedPng(image.bytes)
    : await doc.embedJpg(image.bytes);
  const page = doc.addPage([embedded.width, embedded.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: embedded.width,
    height: embedded.height,
  });
}

export interface MergeInput {
  bytes: Uint8Array;
  /** "pdf" or an image mime type. */
  kind: "pdf" | "image/png" | "image/jpeg";
}

/** Merge PDFs and images (each image becomes one page) into a single PDF. */
export async function mergeMixed(inputs: MergeInput[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const input of inputs) {
    if (input.kind === "pdf") {
      const src = await load(input.bytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else {
      await imagesToPdfPages(out, { bytes: input.bytes, type: input.kind });
    }
  }
  return out.save();
}

export async function addWatermark(
  bytes: Uint8Array,
  text: string,
  opts: { opacity: number; fontSize: number; color: string; diagonal: boolean },
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { r, g, b } = hexToRgb01(opts.color);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, opts.fontSize);
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2,
      size: opts.fontSize,
      font,
      color: rgb(r, g, b),
      opacity: opts.opacity,
      rotate: opts.diagonal ? degrees(45) : degrees(0),
    });
  }
  return doc.save();
}

/**
 * Crop pages: `rect` is the area to KEEP, in display points of the rotated
 * page as shown in the viewer (top-left origin, scale 1) — the same space
 * annotations use. Sets the CropBox (what viewers show); `permanent` also
 * rewrites the MediaBox so the cropped area is gone for every consumer.
 */
export async function cropPages(
  bytes: Uint8Array,
  pageIndexes: number[],
  rect: { x: number; y: number; w: number; h: number },
  permanent: boolean,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const idx of pageIndexes) {
    if (idx < 0 || idx >= doc.getPageCount()) continue;
    const page = doc.getPage(idx);
    // Displayed geometry is the CropBox (falls back to MediaBox), so the
    // selection maps relative to it — including its origin offset.
    const cb = page.getCropBox();
    const rotation = page.getRotation().angle;
    const r = toPdfRect(rect, cb.width, cb.height, rotation);
    const x = cb.x + r.x;
    const y = cb.y + r.y;
    page.setCropBox(x, y, r.w, r.h);
    if (permanent) page.setMediaBox(x, y, r.w, r.h);
  }
  return doc.save();
}

export interface BatesOptions {
  prefix: string;
  suffix: string;
  start: number;
  /** Zero-padded width of the number, e.g. 6 → 000001. */
  digits: number;
}

export interface HeaderFooterOptions {
  /** Text per slot; empty/undefined slots are skipped. Tokens: {page},
   *  {pages}, {date}, {bates}. */
  slots: {
    headerLeft?: string;
    headerCenter?: string;
    headerRight?: string;
    footerLeft?: string;
    footerCenter?: string;
    footerRight?: string;
  };
  fontSize: number;
  color: string;
  /** Distance from the top/bottom edge (points). */
  margin: number;
  /** Distance from the left/right edge (points). */
  sideMargin: number;
  /** 0-based pages to stamp; null/undefined = every page. */
  pageIndexes?: number[] | null;
  /** Bates numbering config — replaces the {bates} token; the counter
   *  advances on every stamped page. */
  bates?: BatesOptions;
}

/** Stamp custom headers/footers (3 header + 3 footer slots) with token
 *  substitution and optional Bates numbering. */
export async function addHeadersFooters(
  bytes: Uint8Array,
  opts: HeaderFooterOptions,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { r, g, b } = hexToRgb01(opts.color);
  const color = rgb(r, g, b);
  const pages = doc.getPages();
  const targets =
    opts.pageIndexes && opts.pageIndexes.length
      ? opts.pageIndexes.filter((i) => i >= 0 && i < pages.length)
      : pages.map((_, i) => i);
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  let bates = opts.bates ? opts.bates.start : 0;
  for (const idx of targets) {
    const page = pages[idx];
    const { width, height } = page.getSize();
    const batesStr = opts.bates
      ? `${opts.bates.prefix}${String(bates).padStart(opts.bates.digits, "0")}${opts.bates.suffix}`
      : "";
    // split/join instead of replaceAll — the build targets ES2020.
    const expand = (tpl: string) =>
      tpl
        .split("{page}").join(String(idx + 1))
        .split("{pages}").join(String(pages.length))
        .split("{date}").join(dateStr)
        .split("{bates}").join(batesStr);
    const draw = (
      tpl: string | undefined,
      slot: "left" | "center" | "right",
      top: boolean,
    ) => {
      const text = tpl && expand(tpl).trim();
      if (!text) return;
      const tw = font.widthOfTextAtSize(text, opts.fontSize);
      const x =
        slot === "left"
          ? opts.sideMargin
          : slot === "center"
            ? width / 2 - tw / 2
            : width - tw - opts.sideMargin;
      const y = top ? height - opts.margin - opts.fontSize : opts.margin;
      page.drawText(text, { x, y, size: opts.fontSize, font, color });
    };
    draw(opts.slots.headerLeft, "left", true);
    draw(opts.slots.headerCenter, "center", true);
    draw(opts.slots.headerRight, "right", true);
    draw(opts.slots.footerLeft, "left", false);
    draw(opts.slots.footerCenter, "center", false);
    draw(opts.slots.footerRight, "right", false);
    if (opts.bates) bates++;
  }
  return doc.save();
}

/** Editable outline node (what the sidebar's outline editor works with). */
export interface OutlineInput {
  title: string;
  /** 0-based target page; null = no destination. */
  pageIndex: number | null;
  children: OutlineInput[];
}

/**
 * Replace the document outline (bookmarks) with `nodes`. An empty list
 * removes the outline entirely. Entries with a pageIndex get a /Fit
 * destination to that page; all levels are written expanded.
 */
export async function setOutline(
  bytes: Uint8Array,
  nodes: OutlineInput[],
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const ctx = doc.context;
  doc.catalog.delete(PDFName.of("Outlines"));
  if (nodes.length) {
    const outlinesDict = ctx.obj({ Type: "Outlines" }) as PDFDict;
    const outlinesRef = ctx.register(outlinesDict);

    const build = (
      items: OutlineInput[],
      parentRef: ReturnType<typeof ctx.register>,
    ): { first: any; last: any; count: number } => {
      let first: any = null;
      let prevRef: any = null;
      let prevDict: PDFDict | null = null;
      let count = 0;
      for (const item of items) {
        const dict = ctx.obj({}) as PDFDict;
        const ref = ctx.register(dict);
        dict.set(PDFName.of("Title"), PDFHexString.fromText(item.title));
        dict.set(PDFName.of("Parent"), parentRef);
        if (
          item.pageIndex != null &&
          item.pageIndex >= 0 &&
          item.pageIndex < doc.getPageCount()
        ) {
          dict.set(
            PDFName.of("Dest"),
            ctx.obj([doc.getPage(item.pageIndex).ref, PDFName.of("Fit")]),
          );
        }
        if (prevRef && prevDict) {
          prevDict.set(PDFName.of("Next"), ref);
          dict.set(PDFName.of("Prev"), prevRef);
        }
        const kids = build(item.children ?? [], ref);
        if (kids.count) {
          dict.set(PDFName.of("First"), kids.first);
          dict.set(PDFName.of("Last"), kids.last);
          dict.set(PDFName.of("Count"), ctx.obj(kids.count)); // positive = open
        }
        if (!first) first = ref;
        prevRef = ref;
        prevDict = dict;
        count += 1 + kids.count;
      }
      return { first, last: prevRef, count };
    };

    const top = build(nodes, outlinesRef);
    outlinesDict.set(PDFName.of("First"), top.first);
    outlinesDict.set(PDFName.of("Last"), top.last);
    outlinesDict.set(PDFName.of("Count"), ctx.obj(top.count));
    doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  }
  return doc.save();
}

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: { fontSize: number; position: "bottom-center" | "bottom-right" },
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const label = `${i + 1} / ${pages.length}`;
    const textWidth = font.widthOfTextAtSize(label, opts.fontSize);
    const x =
      opts.position === "bottom-center"
        ? width / 2 - textWidth / 2
        : width - textWidth - 36;
    page.drawText(label, {
      x,
      y: 24,
      size: opts.fontSize,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  });
  return doc.save();
}

/**
 * Convert a rect from viewer space (origin top-left of the *rotated* page as
 * displayed, PDF points) into pdf-lib space (origin bottom-left of the
 * unrotated page). Handles 0/90/180/270 page rotation.
 */
function toPdfRect(
  a: { x: number; y: number; w: number; h: number },
  pw: number, // unrotated page width
  ph: number, // unrotated page height
  rotation: number,
): { x: number; y: number; w: number; h: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      // displayed width = ph, displayed height = pw
      return { x: a.y, y: a.x, w: a.h, h: a.w };
    case 180:
      return { x: pw - a.x - a.w, y: a.y, w: a.w, h: a.h };
    case 270:
      return { x: ph - a.y - a.h, y: pw - a.x - a.w, w: a.h, h: a.w };
    default:
      return { x: a.x, y: ph - a.y - a.h, w: a.w, h: a.h };
  }
}

/**
 * Destructively redact every pending "redact" box in `annotations`: the text
 * (and form content) under each box is removed from the page content stream via
 * PDFium and a black box is painted in its place — it can't be copied, searched
 * or recovered, unlike a whiteout cover. Returns the input unchanged when there
 * are no redaction boxes. Box coordinates are mapped through `toPdfRect`, so
 * rotated pages are handled identically to the rest of the baking pipeline.
 */
export async function applyRedactions(
  bytes: Uint8Array,
  annotations: AnnotationMap,
): Promise<Uint8Array> {
  // Collect boxes per page in PDFium page space (origin bottom-left).
  const doc = await load(bytes);
  const rects: RedactRect[] = [];
  for (const [pageIndexStr, list] of Object.entries(annotations)) {
    const pageIndex = Number(pageIndexStr);
    if (pageIndex < 0 || pageIndex >= doc.getPageCount() || !list.length) continue;
    const page = doc.getPage(pageIndex);
    const { width: pw, height: ph } = page.getSize();
    const rotation = page.getRotation().angle;
    for (const ann of list) {
      if (ann.kind !== "redact") continue;
      const r = toPdfRect(ann, pw, ph, rotation);
      rects.push({
        pageIndex,
        left: r.x,
        bottom: r.y,
        right: r.x + r.w,
        top: r.y + r.h,
      });
    }
  }
  if (!rects.length) return bytes;
  const { redactRegions } = await import("./pdfium");
  return redactRegions(bytes, rects, { drawBlackBoxes: true });
}

const FONT_VARIANTS: Record<string, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  // [regular, bold, italic, boldItalic]
  helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

// If a bundled font can't be loaded, fall back to the closest standard family.
const STANDARD_FALLBACK: Record<string, string> = {
  carlito: "helvetica",
  caladea: "times",
};

function fontVariantFor(ann: TextAnnotation): StandardFonts {
  const fam = ann.fontFamily ?? "helvetica";
  const variants =
    FONT_VARIANTS[fam] ?? FONT_VARIANTS[STANDARD_FALLBACK[fam] ?? "helvetica"];
  const idx = (ann.bold ? 1 : 0) + (ann.italic ? 2 : 0);
  return variants[idx];
}

/** Bundled metric-compatible fonts, embedded fully into the saved PDF. */
const BUNDLED_FONT_URLS: Record<string, [string, string, string, string]> = {
  // [regular, bold, italic, boldItalic]
  carlito: [
    "/fonts/Carlito-Regular.ttf",
    "/fonts/Carlito-Bold.ttf",
    "/fonts/Carlito-Italic.ttf",
    "/fonts/Carlito-BoldItalic.ttf",
  ],
  caladea: [
    "/fonts/Caladea-Regular.ttf",
    "/fonts/Caladea-Bold.ttf",
    "/fonts/Caladea-Italic.ttf",
    "/fonts/Caladea-BoldItalic.ttf",
  ],
};

const bundledFontBytes = new Map<string, Promise<ArrayBuffer>>();

function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  let p = bundledFontBytes.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Font fetch failed (${r.status})`);
      return r.arrayBuffer();
    });
    p.catch(() => bundledFontBytes.delete(url));
    bundledFontBytes.set(url, p);
  }
  return p;
}

/** Write user-entered AcroForm values into the document's form fields. */
function fillFormValues(doc: PDFDocument, formValues: Record<string, unknown>) {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const [name, value] of Object.entries(formValues)) {
    try {
      const field = form.getField(name);
      if (field instanceof PDFTextField) {
        field.setText(value == null ? "" : String(value));
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === "string" && value) field.select(value);
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (Array.isArray(value)) {
          const picks = value.filter((v): v is string => typeof v === "string" && !!v);
          if (picks.length) field.select(picks);
        } else if (typeof value === "string" && value) {
          field.select(value);
        }
      }
    } catch {
      /* field missing or incompatible — skip */
    }
  }
  try {
    form.updateFieldAppearances();
  } catch {
    /* appearance regeneration is best-effort */
  }
}

/**
 * Write a comment as a real PDF /Text (sticky note) annotation with an
 * attached /Popup, so Acrobat, Chrome & co. show it as a native comment
 * (clickable icon + popup text) instead of flattened pixels.
 */
function addNoteAnnotation(
  doc: PDFDocument,
  pageIndex: number,
  ann: NoteAnnotation,
  r: { x: number; y: number; w: number; h: number },
) {
  const page = doc.getPage(pageIndex);
  const ctx = doc.context;
  const c = hexToRgb01(ann.color);

  const noteDict = ctx.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [r.x, r.y, r.x + r.w, r.y + r.h],
    Contents: PDFHexString.fromText(ann.text),
    Name: "Comment", // speech-bubble icon
    C: [c.r, c.g, c.b],
    T: PDFHexString.fromText("PickPDF"),
    M: PDFString.fromDate(new Date()),
    // Print | NoZoom | NoRotate — the standard sticky-note flags.
    F: 4 + 8 + 16,
    Open: false,
  });
  const noteRef = ctx.register(noteDict);

  const popupDict = ctx.obj({
    Type: "Annot",
    Subtype: "Popup",
    Rect: [r.x + r.w + 6, r.y - 80, r.x + r.w + 186, r.y + r.h + 20],
    Parent: noteRef,
    Open: false,
  });
  const popupRef = ctx.register(popupDict);
  noteDict.set(PDFName.of("Popup"), popupRef);

  const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const annots = existing ?? ctx.obj([]);
  if (!existing) page.node.set(PDFName.of("Annots"), annots);
  annots.push(noteRef);
  annots.push(popupRef);
}

/** Bake overlay annotations permanently into the PDF. */
export async function bakeAnnotations(
  bytes: Uint8Array,
  annotations: AnnotationMap,
  formValues?: Record<string, unknown>,
  fieldOps?: Record<string, ExistingFieldOp>,
): Promise<Uint8Array> {
  // True redaction runs first (destructive, via PDFium) so that even if the
  // user saves without hitting "Apply redactions", the covered content is still
  // genuinely removed — never silently left behind under a cosmetic box.
  bytes = await applyRedactions(bytes, annotations);
  const doc = await load(bytes);
  const fontCache = new Map<StandardFonts, PDFFont>();
  const embeddedCache = new Map<string, PDFFont>();
  let fontkitRegistered = false;

  const getFont = async (variant: StandardFonts): Promise<PDFFont> => {
    let f = fontCache.get(variant);
    if (!f) {
      f = await doc.embedFont(variant);
      fontCache.set(variant, f);
    }
    return f;
  };

  const getStyledFont = async (
    family: TextAnnotation["fontFamily"],
    bold: boolean,
    italic: boolean,
  ): Promise<PDFFont> => {
    const urls = BUNDLED_FONT_URLS[family ?? ""];
    if (urls) {
      const url = urls[(bold ? 1 : 0) + (italic ? 2 : 0)];
      const cached = embeddedCache.get(url);
      if (cached) return cached;
      try {
        if (!fontkitRegistered) {
          // fontkit is large — load it only when a bundled font is baked.
          const fontkit = (await import("@pdf-lib/fontkit")).default;
          doc.registerFontkit(fontkit);
          fontkitRegistered = true;
        }
        const fontBytes = await fetchFontBytes(url);
        const f = await doc.embedFont(fontBytes, { subset: true });
        embeddedCache.set(url, f);
        return f;
      } catch {
        /* fall back to the closest standard font */
      }
    }
    const fam = family ?? "helvetica";
    const variants =
      FONT_VARIANTS[fam] ?? FONT_VARIANTS[STANDARD_FALLBACK[fam] ?? "helvetica"];
    return getFont(variants[(bold ? 1 : 0) + (italic ? 2 : 0)]);
  };
  const getTextFont = (ann: TextAnnotation): Promise<PDFFont> =>
    getStyledFont(ann.fontFamily, !!ann.bold, !!ann.italic);

  const newFields: PlacedField[] = [];

  for (const [pageIndexStr, list] of Object.entries(annotations)) {
    const pageIndex = Number(pageIndexStr);
    if (pageIndex < 0 || pageIndex >= doc.getPageCount() || !list.length) continue;
    const page = doc.getPage(pageIndex);
    const { width: pw, height: ph } = page.getSize();
    const rotation = page.getRotation().angle;

    for (const ann of list) {
      const r = toPdfRect(ann, pw, ph, rotation);
      if (ann.kind === "formfield") {
        newFields.push({ ann, r, pageIndex });
        continue;
      }
      if (ann.kind === "note") {
        // Skip empty notes; write real ones as native PDF comments.
        if (ann.text.trim()) addNoteAnnotation(doc, pageIndex, ann, r);
        continue;
      }
      // Redaction is applied destructively above (PDFium), not drawn as an
      // overlay — the black box is already baked into the page content.
      if (ann.kind === "redact") continue;

      // Free rotation: wrap the draw in a CTM that spins the coordinate
      // system about the box center, so every kind (text, shapes, images,
      // ink) bakes rotated without per-kind math. Screen-clockwise degrees
      // map to a negative (clockwise-on-page) angle in PDF space.
      const spin = ann.rotation ?? 0;
      if (spin) {
        const phi = (-spin * Math.PI) / 180;
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(
            cos,
            sin,
            -sin,
            cos,
            cx - cx * cos + cy * sin,
            cy - cx * sin - cy * cos,
          ),
        );
      }
      try {
        if (ann.kind === "text") {
          await drawRichText(page, ann, r, rotation, getStyledFont);
        } else {
          await drawAnnotation(doc, page, ann, r, await getFont(StandardFonts.Helvetica), rotation);
        }
      } finally {
        if (spin) page.pushOperators(popGraphicsState());
      }
    }
  }

  // Delete removed/promoted existing fields FIRST, so a promoted field can be
  // recreated with the same name (createFormFields dedupes against live names).
  if (fieldOps && Object.keys(fieldOps).length) applyFieldDeletions(doc, fieldOps);

  if (newFields.length) createFormFields(doc, newFields);

  // Fill values before renames so entered values land in their fields.
  if (formValues && Object.keys(formValues).length) {
    fillFormValues(doc, formValues);
  }

  if (fieldOps && Object.keys(fieldOps).length) applyFieldOps(doc, fieldOps);

  const out = await doc.save();

  // If we touched any form fields, regenerate their appearance streams with
  // PDFium so filled values render everywhere (pdf-lib's updateFieldAppearances
  // is best-effort and some viewers ignore /NeedAppearances). Lazy-loaded.
  const touchedForms =
    newFields.length > 0 ||
    (!!formValues && Object.keys(formValues).length > 0) ||
    (!!fieldOps && Object.keys(fieldOps).length > 0);
  if (touchedForms) {
    try {
      const { regenerateFormAppearances } = await import("./pdfium");
      return await regenerateFormAppearances(out);
    } catch {
      /* PDFium unavailable — fall back to the pdf-lib output */
    }
  }
  return out;
}

/** Apply move/rename/delete edits to existing AcroForm fields. */
/** Remove fields marked deleted — runs before createFormFields so a promoted
 *  field can reclaim the original's name. */
function applyFieldDeletions(doc: PDFDocument, fieldOps: Record<string, ExistingFieldOp>) {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const op of Object.values(fieldOps)) {
    if (!op.deleted) continue;
    try {
      form.removeField(form.getField(op.fieldName));
    } catch {
      /* already gone */
    }
  }
}

function applyFieldOps(
  doc: PDFDocument,
  fieldOps: Record<string, ExistingFieldOp>,
) {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }

  const renamed = new Set<string>();
  for (const op of Object.values(fieldOps)) {
    try {
      if (op.deleted) continue; // handled up front by applyFieldDeletions
      const field = form.getField(op.fieldName);
      if (op.newRect) {
        const page = doc.getPage(op.pageIndex);
        const { width: pw, height: ph } = page.getSize();
        const rotation = page.getRotation().angle;
        const orig = toPdfRect(op.origRect, pw, ph, rotation);
        const next = toPdfRect(op.newRect, pw, ph, rotation);
        // Multi-widget fields (radio groups): move the widget whose current
        // rect is closest to the original position.
        const widgets = (field as any).acroField.getWidgets();
        let best: any = null;
        let bestDist = Infinity;
        for (const w of widgets) {
          const r = w.getRectangle();
          const dist = Math.hypot(r.x - orig.x, r.y - orig.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = w;
          }
        }
        best?.setRectangle({ x: next.x, y: next.y, width: next.w, height: next.h });
      }
      if (op.newName && !renamed.has(op.fieldName)) {
        renamed.add(op.fieldName);
        (field as any).acroField.setPartialName(op.newName.trim().replace(/[.\s]+/g, "_"));
      }
    } catch {
      /* field vanished or op incompatible — skip */
    }
  }
  try {
    form.updateFieldAppearances();
  } catch {
    /* best-effort */
  }
}

interface PlacedField {
  ann: FormFieldAnnotation;
  r: { x: number; y: number; w: number; h: number };
  pageIndex: number;
}

/** Turn form-designer placeholders into real AcroForm fields. */
function createFormFields(doc: PDFDocument, placed: PlacedField[]) {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  const used = new Set(form.getFields().map((f) => f.getName()));
  const uniqueName = (raw: string): string => {
    let base = raw.trim().replace(/[.\s]+/g, "_") || "field";
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    return name;
  };

  const radioGroups = new Map<string, ReturnType<typeof form.createRadioGroup>>();
  const radioCounts = new Map<string, number>();

  // Per-field widget appearance (border/background), applied via addToPage.
  const appearanceOf = (ann: FormFieldAnnotation) => {
    const bc = hexToRgb01(ann.borderColor ?? "#9ca8c8");
    const bw = ann.borderWidth ?? 1;
    const opts: {
      borderColor: ReturnType<typeof rgb>;
      borderWidth: number;
      backgroundColor?: ReturnType<typeof rgb>;
    } = {
      borderColor: rgb(bc.r, bc.g, bc.b),
      borderWidth: bw,
    };
    if (ann.backgroundColor) {
      const b = hexToRgb01(ann.backgroundColor);
      opts.backgroundColor = rgb(b.r, b.g, b.b);
    }
    return opts;
  };

  const BORDER_STYLE_CHAR: Record<string, string> = {
    solid: "S",
    dashed: "D",
    beveled: "B",
    inset: "I",
    underline: "U",
  };

  // Low-level widget tweaks pdf-lib's addToPage doesn't cover: border style
  // (/BS), tooltip (/TU). Applied to every widget of the field.
  const styleWidgets = (field: { acroField: any }, ann: FormFieldAnnotation) => {
    const widgets = field.acroField.getWidgets?.() ?? [];
    for (const w of widgets) {
      const dict = w.dict as PDFDict;
      if (ann.borderStyle) {
        const bs = doc.context.obj({
          Type: "Border",
          W: ann.borderWidth ?? 1,
          S: PDFName.of(BORDER_STYLE_CHAR[ann.borderStyle] ?? "S"),
        }) as PDFDict;
        if (ann.borderStyle === "dashed") {
          bs.set(PDFName.of("D"), doc.context.obj([3, 2]));
        }
        dict.set(PDFName.of("BS"), bs);
      }
    }
    if (ann.tooltip) {
      field.acroField.dict.set(PDFName.of("TU"), PDFString.of(ann.tooltip));
    }
  };

  // Date fields are text fields with Acrobat's AFDate format/keystroke
  // actions attached (/AA), the same way Acrobat's own date fields work.
  const addDateActions = (field: { acroField: any }, format: string) => {
    const fmt = format.replace(/["\\]/g, "");
    field.acroField.dict.set(
      PDFName.of("AA"),
      doc.context.obj({
        F: {
          Type: "Action",
          S: "JavaScript",
          JS: PDFString.of(`AFDate_FormatEx("${fmt}");`),
        },
        K: {
          Type: "Action",
          S: "JavaScript",
          JS: PDFString.of(`AFDate_KeystrokeEx("${fmt}");`),
        },
      }),
    );
  };

  // Text-field format/validation presets, baked as Acrobat AF actions so they
  // format & validate in Acrobat / Chrome (our no-JS viewer shows plain text).
  const addFormatActions = (field: { acroField: any }, format: string) => {
    // AFSpecial psf: 0=ZIP, 2=Phone, 3=SSN. AFNumber currStyle "$" prepends.
    const F_K: Record<string, [string, string]> = {
      number: ["AFNumber_Format(2, 0, 0, 0, '', false);", "AFNumber_Keystroke(2, 0, 0, 0, '', false);"],
      currency: ["AFNumber_Format(2, 0, 0, 0, '$', true);", "AFNumber_Keystroke(2, 0, 0, 0, '$', true);"],
      percent: ["AFPercent_Format(2, 0);", "AFPercent_Keystroke(2, 0);"],
      zip: ["AFSpecial_Format(0);", "AFSpecial_Keystroke(0);"],
      phone: ["AFSpecial_Format(2);", "AFSpecial_Keystroke(2);"],
      ssn: ["AFSpecial_Format(3);", "AFSpecial_Keystroke(3);"],
    };
    let aa: Record<string, unknown> | null = null;
    if (format === "email") {
      aa = {
        V: {
          Type: "Action",
          S: "JavaScript",
          JS: PDFString.of(
            'if(event.value && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(event.value)){app.alert("Enter a valid email address.");event.rc=false;}',
          ),
        },
      };
    } else if (F_K[format]) {
      const [f, k] = F_K[format];
      aa = {
        F: { Type: "Action", S: "JavaScript", JS: PDFString.of(f) },
        K: { Type: "Action", S: "JavaScript", JS: PDFString.of(k) },
      };
    }
    if (aa) field.acroField.dict.set(PDFName.of("AA"), doc.context.obj(aa as never));
  };

  // pdf-lib hardcodes /Yes as a checkbox's on-state; a custom export value
  // means renaming that state in the appearance dicts, /AS and /V.
  const setCheckboxExport = (field: { acroField: any }, exportValue: string) => {
    const raw = exportValue.trim();
    if (!raw || raw === "Yes") return;
    const on = PDFName.of(raw);
    const yes = PDFName.of("Yes");
    for (const w of field.acroField.getWidgets?.() ?? []) {
      const dict = w.dict as PDFDict;
      const ap = dict.lookupMaybe(PDFName.of("AP"), PDFDict);
      for (const key of ["N", "D"]) {
        const sub = ap?.lookupMaybe(PDFName.of(key), PDFDict);
        const state = sub?.get(yes);
        if (sub && state) {
          sub.delete(yes);
          sub.set(on, state);
        }
      }
      if (dict.get(PDFName.of("AS")) === yes) dict.set(PDFName.of("AS"), on);
    }
    const fdict = field.acroField.dict as PDFDict;
    if (fdict.get(PDFName.of("V")) === yes) fdict.set(PDFName.of("V"), on);
    if (fdict.get(PDFName.of("DV")) === yes) fdict.set(PDFName.of("DV"), on);
  };

  // An UNSIGNED signature field is a plain /Sig widget with no value — any
  // conforming viewer (Acrobat, Foxit…) offers its own signing UI on click.
  // pdf-lib can't create these, so build the merged field+widget dict by hand.
  const addSignatureField = (
    page: ReturnType<PDFDocument["getPage"]>,
    name: string,
    ann: FormFieldAnnotation,
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    const flags = (ann.readOnly ? 1 : 0) | (ann.required ? 2 : 0);
    const dict = doc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFHexString.fromText(name),
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      F: 4, // Print
      Ff: flags,
      P: page.ref,
    }) as PDFDict;
    const ref = doc.context.register(dict);

    const fake = { acroField: { getWidgets: () => [{ dict }], dict } };
    applyWidgetAppearance(doc, fake, appearanceOf(ann));
    styleWidgets(fake, ann);

    const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    const annots = existing ?? (doc.context.obj([]) as PDFArray);
    if (!existing) page.node.set(PDFName.of("Annots"), annots);
    annots.push(ref);
    (form as any).acroForm.addField(ref);
  };

  for (const { ann, r, pageIndex } of placed) {
    const page = doc.getPage(pageIndex);
    const rect = { x: r.x, y: r.y, width: r.w, height: r.h };
    const appearance = appearanceOf(ann);
    try {
      switch (ann.fieldType) {
        case "text":
        case "date": {
          const f = form.createTextField(uniqueName(ann.fieldName));
          if (ann.fieldType === "text" && (ann.multiline ?? ann.h >= 45)) {
            f.enableMultiline();
          }
          if (ann.required) f.enableRequired();
          if (ann.readOnly) f.enableReadOnly();
          if (ann.maxLength && ann.maxLength > 0) f.setMaxLength(ann.maxLength);
          if (ann.fieldType === "text" && ann.comb && !ann.multiline && ann.maxLength) {
            f.enableCombing();
          }
          if (ann.fieldType === "text" && ann.password && !ann.multiline) {
            f.enablePassword();
          }
          if (ann.align) {
            f.setAlignment(
              ann.align === "center"
                ? TextAlignment.Center
                : ann.align === "right"
                  ? TextAlignment.Right
                  : TextAlignment.Left,
            );
          }
          if (ann.defaultValue) f.setText(ann.defaultValue);
          f.addToPage(page, rect);
          if (ann.fontSize && ann.fontSize > 0) f.setFontSize(ann.fontSize);
          if (ann.textColor) setFieldTextColor(f, ann.textColor);
          // Border/background go through the widget MK; addToPage set defaults,
          // so re-apply our colors explicitly then the style.
          applyWidgetAppearance(doc, f, appearance);
          styleWidgets(f, ann);
          if (ann.fieldType === "date") {
            addDateActions(f, ann.dateFormat || "mm/dd/yyyy");
          } else if (ann.format && ann.format !== "none") {
            addFormatActions(f, ann.format);
          }
          break;
        }
        case "checkbox": {
          const f = form.createCheckBox(uniqueName(ann.fieldName));
          if (ann.readOnly) f.enableReadOnly();
          if (ann.required) f.enableRequired();
          f.addToPage(page, rect);
          applyWidgetAppearance(doc, f, appearance);
          styleWidgets(f, ann);
          if (ann.defaultValue === "true" || ann.defaultValue === "on") f.check();
          if (ann.exportValue) setCheckboxExport(f, ann.exportValue);
          break;
        }
        case "dropdown": {
          // A choice field is a real list box (Ch, non-combo) when "Show as
          // list box" is set, otherwise a combo dropdown.
          const f = ann.listBox
            ? form.createOptionList(uniqueName(ann.fieldName))
            : form.createDropdown(uniqueName(ann.fieldName));
          f.setOptions((ann.options ?? []).map((o) => o.trim()).filter(Boolean));
          if (ann.readOnly) f.enableReadOnly();
          if (ann.required) f.enableRequired();
          if (f instanceof PDFDropdown && ann.editable) f.enableEditing();
          if (ann.listBox && ann.multiSelect) f.enableMultiselect();
          if (ann.defaultValue) {
            try {
              f.select(ann.defaultValue);
            } catch {
              /* value not an option */
            }
          }
          f.addToPage(page, rect);
          if (ann.fontSize && ann.fontSize > 0) f.setFontSize(ann.fontSize);
          if (ann.textColor) setFieldTextColor(f, ann.textColor);
          applyWidgetAppearance(doc, f, appearance);
          styleWidgets(f, ann);
          break;
        }
        case "signature": {
          addSignatureField(page, uniqueName(ann.fieldName), ann, rect);
          break;
        }
        case "button": {
          const f = form.createButton(uniqueName(ann.fieldName));
          f.addToPage(ann.buttonCaption ?? ann.fieldName, page, {
            ...rect,
            ...appearance,
          });
          if (ann.fontSize && ann.fontSize > 0) f.setFontSize(ann.fontSize);
          applyWidgetAppearance(doc, f, appearance);
          styleWidgets(f, ann);
          setButtonAction(doc, f, ann);
          break;
        }
        case "radio": {
          // Widgets sharing a field name become one radio group.
          let group = radioGroups.get(ann.fieldName);
          if (!group) {
            group = form.createRadioGroup(uniqueName(ann.fieldName));
            radioGroups.set(ann.fieldName, group);
          }
          const n = (radioCounts.get(ann.fieldName) ?? 0) + 1;
          radioCounts.set(ann.fieldName, n);
          group.addOptionToPage(ann.optionValue?.trim() || `option${n}`, page, rect);
          applyWidgetAppearance(doc, group, appearance);
          styleWidgets(group, ann);
          break;
        }
      }
    } catch {
      /* invalid field spec — skip */
    }
  }
}

/** Re-apply border/background color to every widget of a field via its MK dict. */
/** Set a field's value-text color by editing its /DA color operator in place
 *  (keeps the font/size pdf-lib already put there). Skips fields with no font
 *  context so we never produce a broken appearance. */
function setFieldTextColor(
  field: { acroField: { getDefaultAppearance(): string | undefined; setDefaultAppearance(da: string): void } },
  hex: string,
) {
  const da = field.acroField.getDefaultAppearance();
  if (!da || !/\bTf\b/.test(da)) return;
  const { r, g, b } = hexToRgb01(hex);
  const noColor = da
    .replace(/\s*[\d.]+\s+g\b/g, "")
    .replace(/\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+(rg|k)\b/g, "");
  field.acroField.setDefaultAppearance(
    `${noColor} ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`.trim(),
  );
}

/** Attach a Reset/Submit action (/A) to a push-button's widget(s), so it does
 *  something when clicked — in our viewer and in Acrobat/Chrome alike. */
function setButtonAction(
  doc: PDFDocument,
  field: { acroField: { getWidgets: () => Array<{ dict: PDFDict }> } },
  ann: FormFieldAnnotation,
) {
  let action: PDFDict | null = null;
  if (ann.buttonAction === "reset") {
    action = doc.context.obj({
      Type: PDFName.of("Action"),
      S: PDFName.of("ResetForm"),
    }) as PDFDict;
  } else if (ann.buttonAction === "submit" && ann.submitUrl) {
    action = doc.context.obj({
      Type: PDFName.of("Action"),
      S: PDFName.of("SubmitForm"),
      F: PDFString.of(ann.submitUrl),
      // ExportFormat (submit as URL-encoded HTML) + GetMethod.
      Flags: 12,
    }) as PDFDict;
  }
  if (!action) return;
  for (const w of field.acroField.getWidgets()) {
    w.dict.set(PDFName.of("A"), action);
  }
}

function applyWidgetAppearance(
  doc: PDFDocument,
  field: { acroField: any },
  appearance: {
    borderColor: ReturnType<typeof rgb>;
    borderWidth: number;
    backgroundColor?: ReturnType<typeof rgb>;
  },
) {
  const widgets = field.acroField.getWidgets?.() ?? [];
  for (const w of widgets) {
    const dict = w.dict as PDFDict;
    let mk = dict.lookupMaybe(PDFName.of("MK"), PDFDict);
    if (!mk) {
      mk = doc.context.obj({}) as PDFDict;
      dict.set(PDFName.of("MK"), mk);
    }
    const { borderColor: bc, backgroundColor: bg } = appearance;
    mk.set(PDFName.of("BC"), doc.context.obj([bc.red, bc.green, bc.blue]));
    if (bg) mk.set(PDFName.of("BG"), doc.context.obj([bg.red, bg.green, bg.blue]));
  }
}

/**
 * Draw a text annotation as styled runs (mixed color/size/font per span),
 * wrapping at the box width like the on-screen editor. `getStyledFont`
 * resolves + caches a pdf-lib font per run style.
 */
async function drawRichText(
  page: ReturnType<PDFDocument["getPage"]>,
  ann: TextAnnotation,
  r: { x: number; y: number; w: number; h: number },
  rotation: number,
  getStyledFont: (
    family: TextAnnotation["fontFamily"],
    bold: boolean,
    italic: boolean,
  ) => Promise<PDFFont>,
) {
  const runs = getRuns(ann);
  const key = (s: ResolvedStyle) => `${s.fontFamily}|${s.bold}|${s.italic}`;
  const fonts = new Map<string, PDFFont>();
  for (const run of runs) {
    const s = resolveRun(run, ann);
    if (!fonts.has(key(s))) fonts.set(key(s), await getStyledFont(s.fontFamily, s.bold, s.italic));
  }
  const widthOf = (font: PDFFont, text: string, size: number) => {
    try {
      return font.widthOfTextAtSize(text, size);
    } catch {
      return font.widthOfTextAtSize(sanitizeWinAnsi(text), size);
    }
  };

  interface Tok {
    text: string;
    nl: boolean;
    space: boolean;
    style: ResolvedStyle;
    font: PDFFont;
    width: number;
  }
  const toks: Tok[] = [];
  for (const run of runs) {
    const s = resolveRun(run, ann);
    const font = fonts.get(key(s))!;
    for (const piece of run.text.split(/(\n)/)) {
      if (piece === "") continue;
      if (piece === "\n") {
        toks.push({ text: "", nl: true, space: false, style: s, font, width: 0 });
        continue;
      }
      for (const w of piece.split(/(\s+)/)) {
        if (!w) continue;
        toks.push({
          text: w,
          nl: false,
          space: /^\s+$/.test(w),
          style: s,
          font,
          width: widthOf(font, w, s.fontSize),
        });
      }
    }
  }

  const maxWidth = Math.max(20, r.w - 4);
  const lines: Array<{ toks: Tok[]; maxSize: number; width: number }> = [];
  let cur: Tok[] = [];
  let curW = 0;
  let curMax = 0;
  const flush = () => {
    // Trailing spaces don't count toward visible width (matters for center/right align).
    let w = curW;
    for (let i = cur.length - 1; i >= 0 && cur[i].space; i--) w -= cur[i].width;
    lines.push({ toks: cur, maxSize: curMax || ann.fontSize, width: w });
    cur = [];
    curW = 0;
    curMax = 0;
  };
  for (const t of toks) {
    if (t.nl) {
      flush();
      continue;
    }
    if (curW > 0 && curW + t.width > maxWidth && !t.space) flush();
    if (curW === 0 && t.space) continue; // no leading space on a wrapped line
    cur.push(t);
    curW += t.width;
    curMax = Math.max(curMax, t.style.fontSize);
  }
  if (cur.length || lines.length === 0) flush();

  const align = ann.align ?? "left";
  let yTop = 0;
  for (const line of lines) {
    yTop += line.maxSize * 1.25;
    const baseline = r.y + r.h - yTop + line.maxSize * 0.25;
    const startX =
      r.x +
      2 +
      (align === "center"
        ? Math.max(0, (maxWidth - line.width) / 2)
        : align === "right"
          ? Math.max(0, maxWidth - line.width)
          : 0);
    let x = startX;
    // Positions recorded alongside each token so underline/strike segments
    // (drawn in a second pass, merging adjacent same-style tokens) know
    // exactly where to start/end.
    const positions: number[] = [];
    for (const t of line.toks) {
      positions.push(x);
      const c = hexToRgb01(t.style.color);
      const opts = {
        x,
        y: baseline,
        size: t.style.fontSize,
        font: t.font,
        color: rgb(c.r, c.g, c.b),
        rotate: degrees(rotation),
      };
      try {
        page.drawText(t.text, opts);
      } catch {
        page.drawText(sanitizeWinAnsi(t.text), opts);
      }
      x += t.width;
    }
    positions.push(x); // sentinel end position for the last token

    const drawSegments = (
      pick: (s: ResolvedStyle) => boolean,
      offsetFor: (fontSize: number) => number,
    ) => {
      let i = 0;
      while (i < line.toks.length) {
        const t = line.toks[i];
        if (!pick(t.style)) {
          i++;
          continue;
        }
        let j = i;
        while (
          j + 1 < line.toks.length &&
          pick(line.toks[j + 1].style) &&
          line.toks[j + 1].style.color === t.style.color &&
          line.toks[j + 1].style.fontSize === t.style.fontSize
        ) {
          j++;
        }
        const segStart = positions[i];
        const segEnd = positions[j + 1];
        const c = hexToRgb01(t.style.color);
        const y = baseline + offsetFor(t.style.fontSize);
        page.drawLine({
          start: { x: segStart, y },
          end: { x: segEnd, y },
          thickness: Math.max(0.5, t.style.fontSize * 0.06),
          color: rgb(c.r, c.g, c.b),
        });
        i = j + 1;
      }
    };
    drawSegments(
      (s) => s.underline,
      (size) => -size * 0.08,
    );
    drawSegments(
      (s) => s.strike,
      (size) => size * 0.3,
    );
  }
}

async function drawAnnotation(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["getPage"]>,
  ann: Annotation,
  r: { x: number; y: number; w: number; h: number },
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  rotation: number,
) {
  switch (ann.kind) {
    case "highlight": {
      const c = hexToRgb01(ann.color);
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        color: rgb(c.r, c.g, c.b),
        opacity: 0.35,
      });
      break;
    }
    case "markup": {
      // Underline / strikethrough / squiggly. Endpoints are computed in
      // display space and mapped point-by-point, so rotated pages come out
      // right without box-edge special cases.
      const c = hexToRgb01(ann.color);
      const color = rgb(c.r, c.g, c.b);
      const seg = (
        p1: { x: number; y: number },
        p2: { x: number; y: number },
        thickness: number,
      ) =>
        page.drawLine({
          start: displayPointToPdf(p1, page, rotation),
          end: displayPointToPdf(p2, page, rotation),
          color,
          thickness,
        });
      if (ann.style === "squiggly") {
        const yBase = ann.y + ann.h * 0.95;
        const amp = Math.max(1.2, ann.h * 0.14);
        const step = Math.max(2.4, ann.h * 0.22);
        const t = Math.max(0.75, ann.h * 0.06);
        let up = true;
        let prev = { x: ann.x, y: yBase };
        for (let x = step; x <= ann.w + step / 2; x += step) {
          const next = {
            x: ann.x + Math.min(x, ann.w),
            y: up ? yBase - amp : yBase,
          };
          seg(prev, next, t);
          prev = next;
          up = !up;
        }
      } else {
        const yLine =
          ann.y + ann.h * (ann.style === "underline" ? 0.92 : 0.55);
        seg(
          { x: ann.x, y: yLine },
          { x: ann.x + ann.w, y: yLine },
          ann.style === "underline"
            ? Math.max(0.75, ann.h * 0.06)
            : Math.max(1, ann.h * 0.08),
        );
      }
      break;
    }
    case "whiteout": {
      const c = hexToRgb01(ann.color ?? "#ffffff");
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        color: rgb(c.r, c.g, c.b),
      });
      break;
    }
    case "rect": {
      const c = hexToRgb01(ann.color);
      const f = ann.fill ? hexToRgb01(ann.fill) : null;
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        color: f ? rgb(f.r, f.g, f.b) : undefined,
        borderColor: ann.strokeWidth > 0 ? rgb(c.r, c.g, c.b) : undefined,
        borderWidth: ann.strokeWidth,
      });
      break;
    }
    case "ellipse": {
      const c = hexToRgb01(ann.color);
      const f = ann.fill ? hexToRgb01(ann.fill) : null;
      page.drawEllipse({
        x: r.x + r.w / 2,
        y: r.y + r.h / 2,
        xScale: r.w / 2,
        yScale: r.h / 2,
        color: f ? rgb(f.r, f.g, f.b) : undefined,
        borderColor: ann.strokeWidth > 0 ? rgb(c.r, c.g, c.b) : undefined,
        borderWidth: ann.strokeWidth,
      });
      break;
    }
    case "line": {
      const c = hexToRgb01(ann.color);
      // PDF y is up: display top-left = (r.x, r.y + r.h). `down` means the
      // line runs display top-left → bottom-right.
      page.drawLine({
        start: { x: r.x, y: ann.down ? r.y + r.h : r.y },
        end: { x: r.x + r.w, y: ann.down ? r.y : r.y + r.h },
        color: rgb(c.r, c.g, c.b),
        thickness: ann.strokeWidth,
      });
      break;
    }
    case "arrow": {
      const c = hexToRgb01(ann.color);
      const color = rgb(c.r, c.g, c.b);
      // Endpoints in display space (same math as the on-screen SVG), then
      // each point mapped through the page rotation.
      const tail = { x: ann.x + (ann.ax ?? 0) * ann.w, y: ann.y + (ann.ay ?? 0) * ann.h };
      const head = { x: ann.x + (ann.bx ?? 1) * ann.w, y: ann.y + (ann.by ?? 1) * ann.h };
      const angle = Math.atan2(head.y - tail.y, head.x - tail.x);
      const headLen = Math.max(6, ann.strokeWidth * 3.5);
      const spread = Math.PI / 7;
      const wing = (sign: 1 | -1) => ({
        x: head.x - headLen * Math.cos(angle + sign * spread),
        y: head.y - headLen * Math.sin(angle + sign * spread),
      });
      const line = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
        page.drawLine({
          start: displayPointToPdf(p1, page, rotation),
          end: displayPointToPdf(p2, page, rotation),
          color,
          thickness: ann.strokeWidth,
          lineCap: 1 as any,
        });
      line(tail, head);
      line(wing(1), head);
      line(wing(-1), head);
      break;
    }
    case "ink": {
      const c = hexToRgb01(ann.color);
      // Points are relative to the annotation box in display space; convert
      // each to absolute display coords, then to pdf space pairwise as lines.
      const pts = ann.points.map((p) => ({ x: ann.x + p.x, y: ann.y + p.y }));
      for (let i = 1; i < pts.length; i++) {
        const a = displayPointToPdf(pts[i - 1], page, rotation);
        const b = displayPointToPdf(pts[i], page, rotation);
        page.drawLine({
          start: a,
          end: b,
          color: rgb(c.r, c.g, c.b),
          thickness: ann.strokeWidth,
          lineCap: 1 as any,
        });
      }
      break;
    }
    case "text": {
      const c = hexToRgb01(ann.color);
      // Mirror the on-screen CSS wrapping: break lines that exceed the box
      // width, so the baked PDF matches what the user saw.
      const maxWidth = Math.max(20, r.w - 4);
      const lines = ann.text
        .split("\n")
        .flatMap((line) => wrapLine(line, font, ann.fontSize, maxWidth));
      const lineHeight = ann.fontSize * 1.25;
      lines.forEach((line, i) => {
        const yTopOffset = (i + 1) * lineHeight - ann.fontSize * 0.25;
        const opts = {
          x: r.x + 2,
          y: r.y + r.h - yTopOffset,
          size: ann.fontSize,
          font,
          color: rgb(c.r, c.g, c.b),
          rotate: degrees(rotation),
        };
        try {
          // Embedded unicode fonts can draw the raw text directly.
          page.drawText(line, opts);
        } catch {
          // WinAnsi standard fonts: replace unsupported glyphs.
          page.drawText(sanitizeWinAnsi(line), opts);
        }
      });
      break;
    }
    case "image": {
      const img = ann.dataUrl.startsWith("data:image/png")
        ? await doc.embedPng(ann.dataUrl)
        : await doc.embedJpg(ann.dataUrl);
      page.drawImage(img, {
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        rotate: degrees(rotation),
      });
      break;
    }
  }
}

function displayPointToPdf(
  p: { x: number; y: number },
  page: { getSize(): { width: number; height: number } },
  rotation: number,
): { x: number; y: number } {
  const { width: pw, height: ph } = page.getSize();
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: p.y, y: p.x };
    case 180:
      return { x: pw - p.x, y: p.y };
    case 270:
      return { x: ph - p.y, y: pw - p.x };
    default:
      return { x: p.x, y: ph - p.y };
  }
}

/**
 * Add an invisible (opacity 0) text layer to a PDF from OCR results, so the
 * document becomes searchable, selectable and AI-readable without changing how
 * it looks. Word positions come from the rasterized page and are mapped back to
 * PDF points.
 */
export async function addOcrTextLayer(
  bytes: Uint8Array,
  ocr: OcrPage[],
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageCount = doc.getPageCount();

  for (const p of ocr) {
    if (p.pageIndex < 0 || p.pageIndex >= pageCount || !p.words.length) continue;
    const page = doc.getPage(p.pageIndex);
    const { height: ph } = page.getSize();
    const s = p.renderScale;

    for (const w of p.words) {
      const text = sanitizeWinAnsi(w.text);
      if (!text.trim()) continue;
      const x = w.x0 / s;
      const boxH = (w.y1 - w.y0) / s;
      const size = Math.max(4, boxH * 0.92);
      // Baseline sits a little above the box bottom (top-left origin → flip Y).
      const y = ph - w.y1 / s + boxH * 0.18;
      const boxW = (w.x1 - w.x0) / s;
      // Horizontally squeeze the invisible text to roughly match the word width
      // so selection lines up with the image.
      let natural = 0;
      try {
        natural = font.widthOfTextAtSize(text, size);
      } catch {
        natural = 0;
      }
      const squeeze = natural > 0 ? Math.min(1, boxW / natural) : 1;
      try {
        page.drawText(text, {
          x,
          y,
          size: size * (squeeze < 0.6 ? squeeze : 1),
          font,
          opacity: 0,
        });
      } catch {
        /* skip glyphs the font can't encode */
      }
    }
  }
  return doc.save();
}

/** Word-wrap a single line to fit maxWidth at the given font/size. */
function wrapLine(
  line: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const width = (s: string): number => {
    try {
      return font.widthOfTextAtSize(s, fontSize);
    } catch {
      return font.widthOfTextAtSize(sanitizeWinAnsi(s), fontSize);
    }
  };
  if (!line || width(line) <= maxWidth) return [line];
  const words = line.split(/(\s+)/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current + word;
    if (current && width(candidate) > maxWidth) {
      out.push(current.trimEnd());
      current = word.trimStart();
      // A single word longer than the box: hard-break it.
      while (width(current) > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && width(current.slice(0, cut)) > maxWidth) cut--;
        out.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    } else {
      current = candidate;
    }
  }
  if (current.trimEnd()) out.push(current.trimEnd());
  return out.length ? out : [""];
}

/** Helvetica (WinAnsi) can't encode all unicode; replace what it can't. */
function sanitizeWinAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x00-\xFF–—‘’“”•€]/g, "?");
}

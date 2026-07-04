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
  degrees,
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
        if (typeof value === "string" && value) field.select(value);
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
      if (ann.kind === "text") {
        await drawRichText(page, ann, r, rotation, getStyledFont);
        continue;
      }
      await drawAnnotation(doc, page, ann, r, await getFont(StandardFonts.Helvetica), rotation);
    }
  }

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
      const field = form.getField(op.fieldName);
      if (op.deleted) {
        form.removeField(field);
        continue;
      }
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

  for (const { ann, r, pageIndex } of placed) {
    const page = doc.getPage(pageIndex);
    const rect = { x: r.x, y: r.y, width: r.w, height: r.h };
    const appearance = appearanceOf(ann);
    try {
      switch (ann.fieldType) {
        case "text": {
          const f = form.createTextField(uniqueName(ann.fieldName));
          if (ann.multiline ?? ann.h >= 45) f.enableMultiline();
          if (ann.required) f.enableRequired();
          if (ann.readOnly) f.enableReadOnly();
          if (ann.maxLength && ann.maxLength > 0) f.setMaxLength(ann.maxLength);
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
          // Border/background go through the widget MK; addToPage set defaults,
          // so re-apply our colors explicitly then the style.
          applyWidgetAppearance(doc, f, appearance);
          styleWidgets(f, ann);
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
          break;
        }
        case "dropdown": {
          const f = form.createDropdown(uniqueName(ann.fieldName));
          f.setOptions((ann.options ?? []).map((o) => o.trim()).filter(Boolean));
          if (ann.readOnly) f.enableReadOnly();
          if (ann.required) f.enableRequired();
          if (ann.defaultValue) {
            try {
              f.select(ann.defaultValue);
            } catch {
              /* value not an option */
            }
          }
          f.addToPage(page, rect);
          if (ann.fontSize && ann.fontSize > 0) f.setFontSize(ann.fontSize);
          applyWidgetAppearance(doc, f, appearance);
          styleWidgets(f, ann);
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

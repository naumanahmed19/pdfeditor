// Annotation import: read the standard markup annotations of an opened PDF
// (ours after a save, or Acrobat/Foxit-authored) into the editable overlay
// model, and strip the imported source dicts from the bytes so the page
// doesn't render them twice. Reading uses pdf-lib dict access rather than
// PDFium's FPDFAnnot_* getters — PDFium's color/geometry getters go blind on
// annotations that carry appearance streams, which real-world annotations
// always do.
//
// Imported subtypes: Highlight, Underline, StrikeOut, Squiggly (one overlay
// box per quad, grouped), Ink (one overlay stroke per path, grouped), Square,
// Circle, Line (incl. /LE arrows), Text (sticky note), FreeText (plain text
// box). Everything else (stamps, polygons, file attachments, widgets, links —
// links already have LinkLayer) stays in the file untouched.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "pdf-lib";
import type {
  Annotation,
  AnnotationMap,
  HighlightAnnotation,
  InkAnnotation,
  MarkupAnnotation,
  MarkupStyle,
  NoteAnnotation,
  ShapeAnnotation,
  TextAnnotation,
} from "../types";
import { pageGeometry, pdfPointToDisplay, pdfRectToDisplay, type PageGeometry } from "./coords";
import { uid } from "./utils";

/** Result of an import pass: the overlay annotations plus the bytes with the
 *  imported source dicts removed (so nothing renders twice). */
export interface AnnotationImport {
  annotations: AnnotationMap;
  cleanedBytes: Uint8Array;
  /** How many source annotations were absorbed into the overlay. */
  count: number;
}

const HIDDEN = 2;
const NO_VIEW = 32;

// --- small dict readers ----------------------------------------------------

const name = (dict: PDFDict, key: string): string | null => {
  const v = dict.lookupMaybe(PDFName.of(key), PDFName);
  return v ? v.toString().replace(/^\//, "") : null;
};

const num = (dict: PDFDict, key: string): number | null => {
  const v = dict.lookupMaybe(PDFName.of(key), PDFNumber);
  return v ? v.asNumber() : null;
};

const numArray = (dict: PDFDict, key: string): number[] | null => {
  const a = dict.lookupMaybe(PDFName.of(key), PDFArray);
  if (!a) return null;
  const out: number[] = [];
  for (let i = 0; i < a.size(); i++) {
    const v = a.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    out.push(v.asNumber());
  }
  return out;
};

const text = (dict: PDFDict, key: string): string => {
  const v = dict.lookup(PDFName.of(key));
  if (v instanceof PDFString || v instanceof PDFHexString) {
    try {
      return v.decodeText();
    } catch {
      return "";
    }
  }
  return "";
};

/** /C or /IC color array (gray / RGB / CMYK) → #rrggbb, null when absent. */
const colorHex = (dict: PDFDict, key: string): string | null => {
  const c = numArray(dict, key);
  if (!c || c.length === 0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  if (c.length === 1) r = g = b = c[0];
  else if (c.length === 3) [r, g, b] = c;
  else if (c.length === 4) {
    const [cy, m, ye, k] = c;
    r = (1 - cy) * (1 - k);
    g = (1 - m) * (1 - k);
    b = (1 - ye) * (1 - k);
  } else return null;
  const hx = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
};

/** Border stroke width: /BS.W, falling back to the legacy /Border triple. */
const strokeWidth = (dict: PDFDict): number => {
  const bs = dict.lookupMaybe(PDFName.of("BS"), PDFDict);
  const w = bs ? num(bs, "W") : null;
  if (w != null) return Math.max(0.5, w);
  const border = numArray(dict, "Border");
  if (border && border.length >= 3 && border[2] > 0) return border[2];
  return 2;
};

// --- geometry --------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** /Rect (any corner order) → display-space box. */
const rectToDisplay = (dict: PDFDict, g: PageGeometry): Box | null => {
  const r = numArray(dict, "Rect");
  if (!r || r.length !== 4) return null;
  const x = Math.min(r[0], r[2]);
  const y = Math.min(r[1], r[3]);
  return pdfRectToDisplay(
    { x, y, w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) },
    g,
  );
};

/** One quad (8 numbers, order unreliable across writers) → display box. */
const quadToDisplay = (q: number[], g: PageGeometry): Box => {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return pdfRectToDisplay(
    { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    g,
  );
};

// --- per-subtype mappers ---------------------------------------------------

const MARKUP_STYLES: Record<string, MarkupStyle> = {
  Underline: "underline",
  StrikeOut: "strikeout",
  Squiggly: "squiggly",
};

function mapQuadKind(
  dict: PDFDict,
  subtype: string,
  g: PageGeometry,
): Annotation[] {
  const quads = numArray(dict, "QuadPoints");
  const boxes: Box[] = [];
  if (quads && quads.length >= 8) {
    for (let i = 0; i + 8 <= quads.length; i += 8) {
      boxes.push(quadToDisplay(quads.slice(i, i + 8), g));
    }
  } else {
    const r = rectToDisplay(dict, g);
    if (r) boxes.push(r);
  }
  if (!boxes.length) return [];
  const groupId = boxes.length > 1 ? uid() : undefined;
  return boxes.map((b) => {
    if (subtype === "Highlight") {
      const ann: HighlightAnnotation = {
        id: uid(),
        kind: "highlight",
        color: colorHex(dict, "C") ?? "#ffe066",
        groupId,
        ...b,
      };
      return ann;
    }
    const ann: MarkupAnnotation = {
      id: uid(),
      kind: "markup",
      style: MARKUP_STYLES[subtype],
      color: colorHex(dict, "C") ?? "#e11d48",
      groupId,
      ...b,
    };
    return ann;
  });
}

function mapInk(dict: PDFDict, g: PageGeometry): Annotation[] {
  const listArr = dict.lookupMaybe(PDFName.of("InkList"), PDFArray);
  if (!listArr) return [];
  const color = colorHex(dict, "C") ?? "#1d4ed8";
  const width = strokeWidth(dict);
  const paths: Array<Array<{ x: number; y: number }>> = [];
  for (let i = 0; i < listArr.size(); i++) {
    const p = listArr.lookup(i);
    if (!(p instanceof PDFArray)) continue;
    const nums: number[] = [];
    for (let j = 0; j < p.size(); j++) {
      const v = p.lookup(j);
      if (v instanceof PDFNumber) nums.push(v.asNumber());
    }
    const pts: Array<{ x: number; y: number }> = [];
    for (let j = 0; j + 1 < nums.length; j += 2) {
      pts.push(pdfPointToDisplay({ x: nums[j], y: nums[j + 1] }, g));
    }
    if (pts.length >= 2) paths.push(pts);
  }
  if (!paths.length) return [];
  const groupId = paths.length > 1 ? uid() : undefined;
  return paths.map((pts) => {
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const ann: InkAnnotation = {
      id: uid(),
      kind: "ink",
      x: minX,
      y: minY,
      w: Math.max(1, Math.max(...pts.map((p) => p.x)) - minX),
      h: Math.max(1, Math.max(...pts.map((p) => p.y)) - minY),
      points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      color,
      strokeWidth: width,
      groupId,
    };
    return ann;
  });
}

function mapShape(dict: PDFDict, subtype: string, g: PageGeometry): Annotation[] {
  const color = colorHex(dict, "C") ?? "#e11d48";
  const width = strokeWidth(dict);

  if (subtype === "Line") {
    const l = numArray(dict, "L");
    if (!l || l.length !== 4) return [];
    const a = pdfPointToDisplay({ x: l[0], y: l[1] }, g);
    const b = pdfPointToDisplay({ x: l[2], y: l[3] }, g);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.max(1, Math.abs(a.x - b.x));
    const h = Math.max(1, Math.abs(a.y - b.y));
    // /LE with any non-None ending reads as an arrow; endpoints preserved as
    // box fractions (tail = L start). A bare line keeps only its diagonal.
    const le = dict.lookupMaybe(PDFName.of("LE"), PDFArray);
    const hasEnding =
      !!le &&
      Array.from({ length: le.size() }, (_, i) => le.lookup(i))
        .some((v) => v instanceof PDFName && v.toString() !== "/None");
    if (hasEnding) {
      const ann: ShapeAnnotation = {
        id: uid(),
        kind: "arrow",
        x,
        y,
        w,
        h,
        color,
        strokeWidth: width,
        ax: (a.x - x) / w,
        ay: (a.y - y) / h,
        bx: (b.x - x) / w,
        by: (b.y - y) / h,
      };
      return [ann];
    }
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const ann: ShapeAnnotation = {
      id: uid(),
      kind: "line",
      x,
      y,
      w,
      h,
      color,
      strokeWidth: width,
      down: left.y <= right.y,
    };
    return [ann];
  }

  // Square/Circle: /Rect may be padded beyond the shape (appearance clipping
  // headroom); /RD records the [left, top, right, bottom] excess. Inset in
  // page space BEFORE converting, so rotated pages permute the sides right.
  const r = numArray(dict, "Rect");
  if (!r || r.length !== 4) return [];
  let x = Math.min(r[0], r[2]);
  let y = Math.min(r[1], r[3]);
  let w = Math.abs(r[2] - r[0]);
  let h = Math.abs(r[3] - r[1]);
  const rd = numArray(dict, "RD");
  if (
    rd &&
    rd.length === 4 &&
    rd.every((v) => v >= 0) &&
    rd[0] + rd[2] < w &&
    rd[1] + rd[3] < h
  ) {
    x += rd[0];
    y += rd[3];
    w -= rd[0] + rd[2];
    h -= rd[1] + rd[3];
  }
  const box = pdfRectToDisplay({ x, y, w, h }, g);
  const ann: ShapeAnnotation = {
    id: uid(),
    kind: subtype === "Circle" ? "ellipse" : "rect",
    color,
    strokeWidth: width,
    fill: colorHex(dict, "IC") ?? undefined,
    ...box,
  };
  return [ann];
}

function mapNote(dict: PDFDict, g: PageGeometry): Annotation[] {
  const contents = text(dict, "Contents");
  if (!contents.trim()) return [];
  const box = rectToDisplay(dict, g);
  if (!box) return [];
  const author = text(dict, "T");
  const ann: NoteAnnotation = {
    id: uid(),
    kind: "note",
    text: contents,
    color: colorHex(dict, "C") ?? "#fbbf24",
    ...(author ? { author } : {}),
    ...box,
  };
  return [ann];
}

function mapFreeText(dict: PDFDict, g: PageGeometry): Annotation[] {
  const contents = text(dict, "Contents");
  if (!contents.trim()) return [];
  const box = rectToDisplay(dict, g);
  if (!box) return [];
  // Best-effort size/color from the default-appearance string.
  const da = text(dict, "DA");
  const size = /(\d+(?:\.\d+)?)\s+Tf/.exec(da);
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const hx = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  const ann: TextAnnotation = {
    id: uid(),
    kind: "text",
    text: contents,
    fontSize: size ? Math.max(6, parseFloat(size[1]) || 12) : 12,
    color: rg ? `#${hx(+rg[1])}${hx(+rg[2])}${hx(+rg[3])}` : "#111111",
    fontFamily: "helvetica",
    ...box,
  };
  return [ann];
}

// --- signature guard ---------------------------------------------------------

/** True when the document carries a SIGNED signature field — stripping
 *  annotation dicts would break the signature, so import must not touch it. */
function hasSignedSignature(doc: PDFDocument): boolean {
  try {
    const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    const fields = acro?.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (!fields) return false;
    const check = (arr: PDFArray, depth: number): boolean => {
      if (depth > 4) return false;
      for (let i = 0; i < arr.size(); i++) {
        const f = arr.lookup(i);
        if (!(f instanceof PDFDict)) continue;
        const ft = name(f, "FT");
        if (ft === "Sig" && f.has(PDFName.of("V"))) return true;
        const kids = f.lookupMaybe(PDFName.of("Kids"), PDFArray);
        if (kids && check(kids, depth + 1)) return true;
      }
      return false;
    };
    return check(fields, 0);
  } catch {
    return true; // unreadable form — err on the side of not touching the file
  }
}

// --- main entry --------------------------------------------------------------

const IMPORTABLE = new Set([
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
  "Ink",
  "Square",
  "Circle",
  "Line",
  "Text",
  "FreeText",
]);

/**
 * Read the importable annotations of `bytes` into overlay annotations and
 * return bytes with those source dicts (and their popups) removed. Returns
 * null when there is nothing to import — or when the document carries a
 * signed signature (removing dicts would break it, so it is left read-only
 * as before).
 */
export async function importAnnotations(
  bytes: Uint8Array,
): Promise<AnnotationImport | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return null;
  }
  if (doc.isEncrypted) return null; // reprotect flow owns encrypted docs
  if (hasSignedSignature(doc)) return null;

  const annotations: AnnotationMap = {};
  let count = 0;
  const pages = doc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const annotsArr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotsArr || annotsArr.size() === 0) continue;
    const g = pageGeometry(page);

    const removed = new Set<number>(); // indexes into annotsArr
    const removedRefs = new Set<string>(); // ref tags of removed dicts
    const imported: Annotation[] = [];

    for (let i = 0; i < annotsArr.size(); i++) {
      const dict = annotsArr.lookupMaybe(i, PDFDict);
      if (!dict) continue;
      const subtype = name(dict, "Subtype");
      if (!subtype || !IMPORTABLE.has(subtype)) continue;
      const flags = num(dict, "F") ?? 0;
      if (flags & (HIDDEN | NO_VIEW)) continue;

      let mapped: Annotation[] = [];
      try {
        if (subtype === "Highlight" || MARKUP_STYLES[subtype]) {
          mapped = mapQuadKind(dict, subtype, g);
        } else if (subtype === "Ink") {
          mapped = mapInk(dict, g);
        } else if (subtype === "Square" || subtype === "Circle" || subtype === "Line") {
          mapped = mapShape(dict, subtype, g);
        } else if (subtype === "Text") {
          mapped = mapNote(dict, g);
        } else if (subtype === "FreeText") {
          mapped = mapFreeText(dict, g);
        }
      } catch {
        mapped = []; // a malformed annot stays in the file untouched
      }
      if (!mapped.length) continue;

      imported.push(...mapped);
      count++;
      removed.add(i);
      const entry = annotsArr.get(i);
      if (entry instanceof PDFRef) removedRefs.add(entry.tag);
      const popup = dict.get(PDFName.of("Popup"));
      if (popup instanceof PDFRef) removedRefs.add(popup.tag);
    }

    if (!imported.length) continue;
    annotations[pageIndex] = imported;

    // Rebuild /Annots without the imported dicts and their popups.
    const kept = doc.context.obj([]);
    for (let i = 0; i < annotsArr.size(); i++) {
      if (removed.has(i)) continue;
      const entry = annotsArr.get(i);
      if (entry instanceof PDFRef && removedRefs.has(entry.tag)) continue;
      kept.push(entry);
    }
    page.node.set(PDFName.of("Annots"), kept);
  }

  if (!count) return null;
  const cleanedBytes = await doc.save();
  return { annotations, cleanedBytes, count };
}

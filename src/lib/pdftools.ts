import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
} from "pdf-lib";
import type { Annotation, AnnotationMap, TextAnnotation } from "../types";
import { hexToRgb01 } from "./utils";

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

/** Bake overlay annotations permanently into the PDF. */
export async function bakeAnnotations(
  bytes: Uint8Array,
  annotations: AnnotationMap,
): Promise<Uint8Array> {
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

  const getTextFont = async (ann: TextAnnotation): Promise<PDFFont> => {
    const urls = BUNDLED_FONT_URLS[ann.fontFamily ?? ""];
    if (urls) {
      const url = urls[(ann.bold ? 1 : 0) + (ann.italic ? 2 : 0)];
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
    return getFont(fontVariantFor(ann));
  };

  for (const [pageIndexStr, list] of Object.entries(annotations)) {
    const pageIndex = Number(pageIndexStr);
    if (pageIndex < 0 || pageIndex >= doc.getPageCount() || !list.length) continue;
    const page = doc.getPage(pageIndex);
    const { width: pw, height: ph } = page.getSize();
    const rotation = page.getRotation().angle;

    for (const ann of list) {
      const r = toPdfRect(ann, pw, ph, rotation);
      const font =
        ann.kind === "text"
          ? await getTextFont(ann)
          : await getFont(StandardFonts.Helvetica);
      await drawAnnotation(doc, page, ann, r, font, rotation);
    }
  }
  return doc.save();
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
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        color: rgb(1, 1, 1),
      });
      break;
    }
    case "rect": {
      const c = hexToRgb01(ann.color);
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        borderColor: rgb(c.r, c.g, c.b),
        borderWidth: ann.strokeWidth,
      });
      break;
    }
    case "ellipse": {
      const c = hexToRgb01(ann.color);
      page.drawEllipse({
        x: r.x + r.w / 2,
        y: r.y + r.h / 2,
        xScale: r.w / 2,
        yScale: r.h / 2,
        borderColor: rgb(c.r, c.g, c.b),
        borderWidth: ann.strokeWidth,
      });
      break;
    }
    case "line": {
      const c = hexToRgb01(ann.color);
      page.drawLine({
        start: { x: r.x, y: r.y + r.h },
        end: { x: r.x + r.w, y: r.y },
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

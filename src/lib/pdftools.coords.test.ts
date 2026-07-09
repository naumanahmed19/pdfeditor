// Fixture tests for the unified display→PDF coordinate handling: bake real
// annotations onto rotated / crop-offset pages with pdf-lib and assert the
// geometry that lands in the saved PDF. Link annotations are used for /Rect
// assertions because they write a plain annotation dictionary (no PDFium, no
// font fetches), so everything runs end-to-end in node.
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import { bakeAnnotations, cropPages, addOcrTextLayer } from "./pdftools";
import type { AnnotationMap, LinkAnnotation } from "../types";

/** 400×600 (portrait, deliberately non-square) page with optional /Rotate. */
async function basePdf(rotation: number, cropBox?: [number, number, number, number]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  if (rotation) page.setRotation(degrees(rotation));
  if (cropBox) page.setCropBox(...cropBox);
  return doc.save();
}

/** A link annotation box at display coords (10, 20) sized 100×50. */
function linkAnn(): AnnotationMap {
  const ann: LinkAnnotation = {
    id: "l1",
    kind: "link",
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    targetType: "url",
    value: "https://example.com",
  };
  return { 0: [ann] };
}

async function firstAnnotRect(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
  const dict = annots.lookup(0, PDFDict);
  expect(dict.lookup(PDFName.of("Subtype"))).toBe(PDFName.of("Link"));
  const rect = dict.lookup(PDFName.of("Rect"), PDFArray);
  return [0, 1, 2, 3].map((i) => rect.lookup(i, PDFNumber).asNumber());
}

const latin1 = (bytes: Uint8Array): string => {
  let s = "";
  // Chunked to keep the argument list small.
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
};

/** Decode every content stream in the saved PDF into one operator string. */
async function contentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      out += `${latin1(decodePDFRawStream(obj).decode())}\n`;
    } catch {
      /* non-flate stream (e.g. an image) — irrelevant here */
    }
  }
  return out;
}

describe("bakeAnnotations — rotated pages get correct /Rects", () => {
  it("0°: y-flip only", async () => {
    const out = await bakeAnnotations(await basePdf(0), linkAnn());
    expect(await firstAnnotRect(out)).toEqual([10, 600 - 20 - 50, 110, 600 - 20]);
  });

  it("90°: pure axis swap, no dimension offsets", async () => {
    const out = await bakeAnnotations(await basePdf(90), linkAnn());
    expect(await firstAnnotRect(out)).toEqual([20, 10, 70, 110]);
  });

  it("180°: mirrored in x", async () => {
    const out = await bakeAnnotations(await basePdf(180), linkAnn());
    expect(await firstAnnotRect(out)).toEqual([400 - 110, 20, 400 - 10, 70]);
  });

  it("270°: offsets use width for x and height for y (the old code swapped them)", async () => {
    const out = await bakeAnnotations(await basePdf(270), linkAnn());
    // Correct: x from page WIDTH (400), y from page HEIGHT (600).
    expect(await firstAnnotRect(out)).toEqual([330, 490, 380, 590]);
    // The old toPdfRect 270° branch produced x = 600-20-50 = 530 — past the
    // 400pt page width, i.e. the annotation landed entirely off the page.
  });

  it("offset CropBox: the crop origin is added (previously ignored)", async () => {
    // MediaBox 400×600, CropBox [50, 100, 300, 400]: the viewer shows the
    // crop box, so display (10, 20) is PDF (60, 100 + 400 - 20).
    const out = await bakeAnnotations(await basePdf(0, [50, 100, 300, 400]), linkAnn());
    expect(await firstAnnotRect(out)).toEqual([60, 430, 160, 480]);
  });
});

describe("bakeAnnotations — drawn content on rotated pages", () => {
  it("wraps draws in the display→page CTM and still saves a loadable PDF", async () => {
    const highlight: AnnotationMap = {
      0: [{ id: "h1", kind: "highlight", x: 10, y: 20, w: 100, h: 50, color: "#ffcc00" }],
    };
    const out = await bakeAnnotations(await basePdf(90), highlight);
    // 90° on a 400×600 box → display→page CTM [0 1 -1 0 400 0].
    expect(await contentText(out)).toContain("0 1 -1 0 400 0 cm");
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it("plain unrotated pages skip the CTM wrap entirely", async () => {
    const highlight: AnnotationMap = {
      0: [{ id: "h1", kind: "highlight", x: 10, y: 20, w: 100, h: 50, color: "#ffcc00" }],
    };
    const out = await bakeAnnotations(await basePdf(0), highlight);
    // pdf-lib's own draw helpers emit translate `cm`s; assert no rotation CTM.
    expect(await contentText(out)).not.toContain("0 1 -1 0");
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });
});

describe("cropPages — display-space selection on rotated pages", () => {
  it("90°: the kept area maps through the same converter as annotations", async () => {
    const out = await cropPages(await basePdf(90), [0], { x: 10, y: 20, w: 100, h: 50 }, false);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 20, y: 10, width: 50, height: 100 });
  });

  it("270°: non-square page stays inside the page bounds", async () => {
    const out = await cropPages(await basePdf(270), [0], { x: 10, y: 20, w: 100, h: 50 }, false);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 330, y: 490, width: 50, height: 100 });
  });

  it("re-cropping an offset CropBox stays relative to the displayed area", async () => {
    const out = await cropPages(
      await basePdf(0, [50, 100, 300, 400]),
      [0],
      { x: 10, y: 20, w: 100, h: 50 },
      false,
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 60, y: 430, width: 100, height: 50 });
  });
});

describe("addOcrTextLayer — rotated pages", () => {
  it("draws the invisible text under the display→page CTM", async () => {
    const out = await addOcrTextLayer(await basePdf(90), [
      {
        pageIndex: 0,
        width: 600,
        height: 400,
        renderScale: 2,
        words: [{ text: "Hello", x0: 40, y0: 80, x1: 240, y1: 120 }],
      },
    ]);
    expect(await contentText(out)).toContain("0 1 -1 0 400 0 cm");
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });
});

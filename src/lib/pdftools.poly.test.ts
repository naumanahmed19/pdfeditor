// Bake fixtures for polygon / polyline / cloud annotations: the path pdf-lib
// writes into the content stream must land in y-up page space exactly where
// the on-screen overlay showed it (drawSvgPath's origin is the box top-left,
// with path y running DOWN — the same convention as the display frame).
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { bakeAnnotations } from "./pdftools";
import { cloudArcCount, CLOUD_RADIUS } from "./poly";
import type { AnnotationMap } from "../types";
import type { PolyAnnotation } from "../types";

async function basePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  return doc.save();
}

const latin1 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
};

async function contentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      out += `${latin1(decodePDFRawStream(obj).decode())}\n`;
    } catch {
      /* non-flate stream — irrelevant here */
    }
  }
  return out;
}

/** Triangle in a 100×50 box at display (10, 20) on the 400×600 page. */
function polyAnn(patch: Partial<PolyAnnotation>): AnnotationMap {
  const ann: PolyAnnotation = {
    id: "p1",
    kind: "polygon",
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 50 },
    ],
    color: "#ff0000",
    strokeWidth: 2,
    ...patch,
  };
  return { 0: [ann] };
}

describe("bakeAnnotations — polygon / polyline paths", () => {
  it("polygon vertices land in y-up page space (origin = box top-left)", async () => {
    const out = await bakeAnnotations(await basePdf(), polyAnn({}));
    const text = await contentText(out);
    // pdf-lib translates to the origin then flips y itself: the origin cm
    // must be the box top-left in page space (display y 20 → 600-20 = 580),
    // followed by the y-down flip and the box-relative vertices.
    expect(text).toContain("1 0 0 1 10 580 cm");
    expect(text).toContain("1 0 0 -1 0 0 cm");
    expect(text).toContain("0 0 m");
    expect(text).toContain("100 0 l");
    expect(text).toContain("50 50 l");
    // Closed subpath, stroked (no fill requested).
    expect(text).toMatch(/50 50 l\s*h\s*S/);
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it("filled polygon fills AND strokes; stroke-less fill only fills", async () => {
    const filled = await contentText(
      await bakeAnnotations(await basePdf(), polyAnn({ fill: "#00ff00" })),
    );
    expect(filled).toMatch(/\bB\b/); // fill + stroke
    const fillOnly = await contentText(
      await bakeAnnotations(
        await basePdf(),
        polyAnn({ fill: "#00ff00", strokeWidth: 0 }),
      ),
    );
    expect(fillOnly).toMatch(/\bf\b/);
    expect(fillOnly).not.toMatch(/\bB\b/);
  });

  it("polyline strokes an OPEN path (no close operator on the subpath)", async () => {
    const out = await bakeAnnotations(
      await basePdf(),
      polyAnn({ kind: "polyline" }),
    );
    const text = await contentText(out);
    expect(text).toContain("1 0 0 1 10 580 cm");
    expect(text).toContain("50 50 l");
    expect(text).not.toMatch(/50 50 l\s*h/);
    expect(text).toMatch(/50 50 l\s*S/);
  });

  it("cloudy polygon bakes scalloped arcs as bezier curves", async () => {
    const plain = await contentText(
      await bakeAnnotations(await basePdf(), polyAnn({})),
    );
    const cloudyBytes = await bakeAnnotations(
      await basePdf(),
      polyAnn({ cloudy: true }),
    );
    const cloudy = await contentText(cloudyBytes);
    const curveOps = (s: string) => (s.match(/ c\n/g) ?? []).length;
    // Each scallop arc decomposes into ≥1 bezier; the straight bake has none.
    const minArcs =
      cloudArcCount(100, CLOUD_RADIUS) * 2 +
      cloudArcCount(Math.hypot(50, 50), CLOUD_RADIUS);
    expect(curveOps(cloudy)).toBeGreaterThanOrEqual(minArcs);
    expect(curveOps(plain)).toBe(0);
    // Starts at the same top-left origin and still closes.
    expect(cloudy).toContain("1 0 0 1 10 580 cm");
    expect(cloudy).toMatch(/\bh\b/);
    await expect(PDFDocument.load(cloudyBytes)).resolves.toBeTruthy();
  });
});

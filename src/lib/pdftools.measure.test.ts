// Bake fixtures for measurement annotations: geometry lands like the poly
// shapes, and the value LABEL — derived from points × scale, never stored —
// must end up as real text in the content stream so prints carry it.
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { bakeAnnotations } from "./pdftools";
import type { AnnotationMap, MeasureAnnotation } from "../types";

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

/** All strings shown via Tj, hex-decoded (standard fonts encode WinAnsi bytes
 *  as PDFHexString — the label never appears literally in the stream). */
function shownText(content: string): string[] {
  return [...content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) =>
    (m[1].match(/../g) ?? [])
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join(""),
  );
}

function measureAnn(patch: Partial<MeasureAnnotation>): AnnotationMap {
  const ann: MeasureAnnotation = {
    id: "m1",
    kind: "measure",
    mode: "distance",
    x: 10,
    y: 20,
    w: 100,
    h: 1,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    color: "#ff0000",
    strokeWidth: 2,
    scale: 0.5,
    unit: "cm",
    ...patch,
  };
  return { 0: [ann] };
}

describe("bakeAnnotations — measurement annotations", () => {
  it("distance: open path + end ticks + calibrated label text", async () => {
    const out = await bakeAnnotations(await basePdf(), measureAnn({}));
    const text = await contentText(out);
    // Geometry through drawSvgPath, origin at the box top-left in page space.
    expect(text).toContain("1 0 0 1 10 580 cm");
    expect(text).toContain("0 0 m");
    expect(text).toMatch(/100 0 l\s*S/); // open (no h before S)
    expect(text).not.toMatch(/100 0 l\s*h/);
    // Perpendicular end bars: vertical ticks ±4pt around each endpoint, drawn
    // in y-up page space (display y 20 → 580).
    expect(text).toContain("10 584 m");
    expect(text).toContain("10 576 l");
    expect(text).toContain("110 584 m");
    expect(text).toContain("110 576 l");
    // 100pt × 0.5 cm/pt = 50 cm, rendered as text on a white pill.
    expect(shownText(text)).toContain("50.00 cm");
    // White pill behind the label: white fill set, then filled(+stroked).
    // (pdf-lib emits rectangles as m/l/h paths, not the `re` operator.)
    expect(text).toMatch(/1 1 1 rg[\s\S]{0,400}?\b[fB]\b/);
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it("area: closed path and a squared-unit label at scale²", async () => {
    const out = await bakeAnnotations(
      await basePdf(),
      measureAnn({
        mode: "area",
        h: 100,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      }),
    );
    const text = await contentText(out);
    expect(text).toMatch(/0 100 l\s*h/); // closed ring
    // 100×100 pt² × 0.5² = 2500 cm²; ² is WinAnsi 0xB2 in the hex string.
    expect(shownText(text)).toContain("2500.00 cm²");
  });

  it("uncalibrated default labels in raw PDF points", async () => {
    const out = await bakeAnnotations(
      await basePdf(),
      measureAnn({ scale: 1, unit: "pt" }),
    );
    expect(shownText(await contentText(out))).toContain("100.00 pt");
  });
});

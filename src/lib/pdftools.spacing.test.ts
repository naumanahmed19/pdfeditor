// Regression coverage for the line-height / letter-spacing baking added to
// text annotations. A Helvetica box bakes through pure pdf-lib (no PDFium/WASM
// and no bundled-font fetch), so bakeAnnotations runs end-to-end in node.
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { bakeAnnotations } from "./pdftools";
import type { AnnotationMap, TextAnnotation, TextBlock } from "../types";

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  return doc.save();
}

function textBox(over: Partial<TextAnnotation>): AnnotationMap {
  const ann: TextAnnotation = {
    id: "t1",
    kind: "text",
    x: 40,
    y: 40,
    w: 220,
    h: 60,
    text: "Wide text\nSecond line",
    fontSize: 14,
    color: "#000000",
    fontFamily: "helvetica",
    align: "left",
    ...over,
  };
  return { 0: [ann] };
}

const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("bakeAnnotations — text spacing", () => {
  it("bakes a text box without throwing and yields a valid, larger PDF", async () => {
    const base = await blankPdf();
    const out = await bakeAnnotations(base, textBox({}));
    expect(out.byteLength).toBeGreaterThan(base.byteLength);
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it("letterSpacing flows into the drawn output (char-by-char advance)", async () => {
    const base = await blankPdf();
    const none = await bakeAnnotations(base, textBox({ letterSpacing: 0 }));
    const wide = await bakeAnnotations(base, textBox({ letterSpacing: 4 }));
    expect(bytesEqual(none, wide)).toBe(false);
    await expect(PDFDocument.load(wide)).resolves.toBeTruthy();
  });

  it("lineHeight flows into the drawn output (line y positions)", async () => {
    const base = await blankPdf();
    const tight = await bakeAnnotations(base, textBox({ lineHeight: 1 }));
    const loose = await bakeAnnotations(base, textBox({ lineHeight: 2 }));
    expect(bytesEqual(tight, loose)).toBe(false);
    await expect(PDFDocument.load(loose)).resolves.toBeTruthy();
  });

  it("defaults (unset lineHeight/letterSpacing) bake identically to explicit defaults", async () => {
    const base = await blankPdf();
    const implicit = await bakeAnnotations(base, textBox({}));
    const explicit = await bakeAnnotations(
      base,
      textBox({ lineHeight: 1.25, letterSpacing: 0 }),
    );
    expect(bytesEqual(implicit, explicit)).toBe(true);
  });
});

function blockBox(blocks: TextBlock[]): AnnotationMap {
  return { 0: [{ ...(textBox({})[0][0] as TextAnnotation), blocks, runs: undefined, text: "" }] };
}

describe("bakeAnnotations — heading & list blocks", () => {
  it("bakes headings + a bullet list without throwing", async () => {
    const base = await blankPdf();
    const out = await bakeAnnotations(
      base,
      blockBox([
        { kind: "h1", runs: [{ text: "Title" }] },
        { kind: "p", runs: [{ text: "Intro paragraph." }] },
        { kind: "li", list: "bullet", indent: 0, runs: [{ text: "First" }] },
        { kind: "li", list: "bullet", indent: 0, runs: [{ text: "Second" }] },
      ]),
    );
    expect(out.byteLength).toBeGreaterThan(base.byteLength);
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it("bakes a nested numbered list without throwing", async () => {
    const base = await blankPdf();
    const out = await bakeAnnotations(
      base,
      blockBox([
        { kind: "li", list: "numbered", indent: 0, runs: [{ text: "One" }] },
        { kind: "li", list: "numbered", indent: 1, runs: [{ text: "One-a" }] },
        { kind: "li", list: "numbered", indent: 1, runs: [{ text: "One-b" }] },
        { kind: "li", list: "numbered", indent: 0, runs: [{ text: "Two" }] },
      ]),
    );
    await expect(PDFDocument.load(out)).resolves.toBeTruthy();
  });

  it("heading blocks change the baked output vs the same text as plain paragraphs", async () => {
    const base = await blankPdf();
    const asHeading = await bakeAnnotations(base, blockBox([{ kind: "h1", runs: [{ text: "Big" }] }]));
    const asPlain = await bakeAnnotations(base, blockBox([{ kind: "p", runs: [{ text: "Big" }] }]));
    expect(bytesEqual(asHeading, asPlain)).toBe(false);
  });

  it("list nesting changes the baked output (indent affects positions)", async () => {
    const base = await blankPdf();
    const flat = await bakeAnnotations(
      base,
      blockBox([{ kind: "li", list: "bullet", indent: 0, runs: [{ text: "x" }] }]),
    );
    const nested = await bakeAnnotations(
      base,
      blockBox([{ kind: "li", list: "bullet", indent: 2, runs: [{ text: "x" }] }]),
    );
    expect(bytesEqual(flat, nested)).toBe(false);
  });
});

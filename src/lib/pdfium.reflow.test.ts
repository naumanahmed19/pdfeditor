// Paragraph reflow write-back, end to end against the real PDFium WASM:
// lines rewritten in place, grown lines created with the paragraph's font at
// the right baseline, shrunk lines removed — and the planReflow → spec →
// reflowTextLines pipeline exercised exactly the way the commit path runs it.
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getTextObjects, reflowTextLines, type ReflowSpec } from "./pdfium";
import { planReflow } from "../components/viewer/reflow";

beforeAll(() => {
  // pdfium.ts loads its wasm with fetch(assetUrl); node can't fetch a bare
  // asset path, so serve the binary straight from the installed package.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    if (typeof input === "string" && input.endsWith(".wasm")) {
      const wasm = await readFile(
        new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url),
      );
      return new Response(wasm, {
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return realFetch(input as RequestInfo, init);
  });
});

const LEFT = 72;
const TOP_Y = 700;
const SIZE = 12;
const LEADING = 16;

const PARA = ["the quick brown fox", "jumps over the lazy", "dog near the bridge"];

/** One page with a 3-line uniform-Helvetica paragraph, one object per line. */
async function paraPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  PARA.forEach((line, i) => {
    page.drawText(line, { x: LEFT, y: TOP_Y - i * LEADING, size: SIZE, font });
  });
  return doc.save();
}

/** The paragraph's lines as PDFium sees them, top→bottom. */
async function readLines(bytes: Uint8Array) {
  const objs = await getTextObjects(bytes, 0);
  return objs
    .filter((o) => o.text.trim())
    .sort((a, b) => b.originY - a.originY);
}

describe("reflowTextLines", () => {
  it("rewrites, grows and preserves the paragraph's font and baselines", async () => {
    const bytes = await paraPdf();
    const before = await readLines(bytes);
    expect(before.map((o) => o.text)).toEqual(PARA);

    const spec: ReflowSpec = {
      lines: [
        { objectIndexes: [before[0].index], text: null }, // untouched
        { objectIndexes: [before[1].index], text: "jumps right over the" },
        { objectIndexes: [before[2].index], text: "lazy dog near the" },
      ],
      extras: [
        { text: "old stone bridge", originX: LEFT, originY: TOP_Y - 3 * LEADING },
      ],
      templateIndex: before[2].index,
    };
    const out = await reflowTextLines(bytes, 0, spec);

    const after = await readLines(out);
    expect(after.map((o) => o.text)).toEqual([
      "the quick brown fox",
      "jumps right over the",
      "lazy dog near the",
      "old stone bridge",
    ]);
    // The grown line inherits the paragraph's face, size and column.
    const extra = after[3];
    expect(extra.fontName).toContain("Helvetica");
    expect(extra.fontSize).toBeCloseTo(SIZE, 1);
    expect(extra.originX).toBeCloseTo(LEFT, 1);
    expect(extra.originY).toBeCloseTo(TOP_Y - 3 * LEADING, 1);
    // The old strings are genuinely gone from the page text.
    expect(after.map((o) => o.text).join(" ")).not.toContain("jumps over the lazy");
  });

  it("removes lines when the paragraph shrinks", async () => {
    const bytes = await paraPdf();
    const before = await readLines(bytes);
    const out = await reflowTextLines(bytes, 0, {
      lines: [
        { objectIndexes: [before[0].index], text: null },
        { objectIndexes: [before[1].index], text: "jumps over the dog" },
        { objectIndexes: [before[2].index], text: "" }, // removed
      ],
      extras: [],
      templateIndex: before[0].index,
    });
    const after = await readLines(out);
    expect(after.map((o) => o.text)).toEqual([
      "the quick brown fox",
      "jumps over the dog",
    ]);
  });

  it("rejects font replacement without explicit per-line text", async () => {
    const bytes = await paraPdf();
    const before = await readLines(bytes);
    await expect(
      reflowTextLines(bytes, 0, {
        lines: [{ objectIndexes: [before[0].index], text: null }],
        extras: [],
        templateIndex: before[0].index,
        font: { standardName: "Helvetica" },
      }),
    ).rejects.toThrow(/explicit text/);
  });

  it("runs the full planReflow → spec pipeline like the commit path", async () => {
    const bytes = await paraPdf();
    const before = await readLines(bytes);
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const measure = (s: string) => helv.widthOfTextAtSize(s, SIZE);
    const width =
      Math.max(...before.map((o) => o.right)) -
      Math.min(...before.map((o) => o.left));

    // User inserts a phrase into line 2 — it must overflow and rewrap.
    const edited = [PARA[0], "jumps energetically over the lazy", PARA[2]];
    const plan = planReflow(PARA, edited, width, measure);
    expect(plan).not.toBeNull();
    expect(plan!.length).toBeGreaterThan(3);

    const spec: ReflowSpec = {
      lines: before.map((o, i) => ({
        objectIndexes: [o.index],
        text: plan![i] === PARA[i] ? null : (plan![i] ?? ""),
      })),
      extras: plan!.slice(3).map((t, k) => ({
        text: t,
        originX: LEFT,
        originY: TOP_Y - (3 + k) * LEADING,
      })),
      templateIndex: before[2].index,
    };
    const out = await reflowTextLines(bytes, 0, spec);
    const after = await readLines(out);
    expect(after.map((o) => o.text)).toEqual(plan);
    // Every content word survived, in reading order.
    expect(after.map((o) => o.text).join(" ")).toBe(
      "the quick brown fox jumps energetically over the lazy dog near the bridge",
    );
    // No rewrapped line exceeds the column (within the shared tolerance).
    for (const line of after) {
      expect(measure(line.text)).toBeLessThanOrEqual(width * 1.02);
    }
  });
});

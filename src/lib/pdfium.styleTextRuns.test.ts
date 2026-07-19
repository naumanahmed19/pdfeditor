import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getTextObjects, styleTextRuns } from "./pdfium";

beforeAll(() => {
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

describe("styleTextRuns font replacement", () => {
  it("fits a wider substitute before adjacent text", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([320, 140]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("REPORT", { x: 20, y: 60, size: 24, font });
    page.drawText("2025", { x: 140, y: 60, size: 24, font });
    const bytes = await source.save();

    const before = await getTextObjects(bytes, 0);
    const heading = before.find((object) => object.text.trim() === "REPORT")!;
    const output = await styleTextRuns(
      bytes,
      0,
      [{ objectIndex: heading.index, text: "REPORT Ding" }],
      { font: { standardName: "Helvetica" } },
    );

    const after = await getTextObjects(output, 0);
    const changed = after.find((object) => object.text.trim() === "REPORT Ding")!;
    const neighbor = after.find((object) => object.text.trim() === "2025")!;
    expect(changed.originX).toBeCloseTo(heading.originX, 1);
    expect(changed.fontSize).toBeCloseTo(heading.fontSize, 1);
    expect(changed.right).toBeLessThan(neighbor.left);
  });
});

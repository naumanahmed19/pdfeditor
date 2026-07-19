import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PdfDoc } from "./engine";

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

describe("live text-object extraction", () => {
  it("stops at the UTF-16 terminator instead of exposing adjacent heap text", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 120]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("REPORT", { x: 20, y: 60, size: 24, font });

    const pdf = await PdfDoc.load(await source.save());
    try {
      expect(pdf.getTextObjects(0).map((object) => object.text)).toEqual([
        "REPORT",
      ]);
      expect(
        pdf
          .getPageObjects(0)
          .filter((object) => object.kind === "text")
          .map((object) => object.text),
      ).toEqual(["REPORT"]);
    } finally {
      await pdf.destroy();
    }
  });
});

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { insertBlankPage } from "./pdftools";

async function sizedPdf(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  sizes.forEach((size) => doc.addPage(size));
  return doc.save();
}

async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [width, height];
  });
}

describe("page insertion", () => {
  it("inserts a blank page at the beginning using the first page size", async () => {
    const base = await sizedPdf([
      [300, 400],
      [500, 600],
    ]);

    await expect(pageSizes(await insertBlankPage(base, 0))).resolves.toEqual([
      [300, 400],
      [300, 400],
      [500, 600],
    ]);
  });

  it("inserts a blank page between pages using the previous page size", async () => {
    const base = await sizedPdf([
      [300, 400],
      [500, 600],
      [700, 800],
    ]);

    await expect(pageSizes(await insertBlankPage(base, 2))).resolves.toEqual([
      [300, 400],
      [500, 600],
      [500, 600],
      [700, 800],
    ]);
  });

  it("inserts a blank page at the end using the last page size", async () => {
    const base = await sizedPdf([
      [300, 400],
      [500, 600],
    ]);

    await expect(pageSizes(await insertBlankPage(base, 2))).resolves.toEqual([
      [300, 400],
      [500, 600],
      [500, 600],
    ]);
  });
});

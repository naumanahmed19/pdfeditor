import { describe, expect, it } from "vitest";
import type { PdfDoc } from "./engine";
import { extractTextContext } from "./pdf";

describe("extractTextContext", () => {
  it("stops reading a large document as soon as the context budget is full", () => {
    const pagesRead: number[] = [];
    const pdf = {
      numPages: 1_000,
      page(pageIndex: number) {
        pagesRead.push(pageIndex);
        return {
          getTextRuns: () => [{ text: `Page ${pageIndex + 1} ${"x".repeat(80)}` }],
          getText: () => "",
        };
      },
    } as unknown as PdfDoc;

    const context = extractTextContext(pdf, 499, 160);

    expect(context).toHaveLength(160);
    expect(pagesRead[0]).toBe(499);
    expect(pagesRead.length).toBeLessThan(4);
  });
});

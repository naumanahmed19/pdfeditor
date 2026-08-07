import { describe, expect, it, vi } from "vitest";
import type { TextRunEdit } from "./pdfium";
import { previewTextRuns } from "./textRunPreview";

describe("previewTextRuns", () => {
  it("removes empty runs instead of sending empty text to PDFium", () => {
    const calls: string[] = [];
    const pdf = {
      previewSetText: vi.fn((_page: number, index: number, text: string) => {
        calls.push(`text:${index}:${text}`);
      }),
      previewSetObjectStyle: vi.fn((_page: number, index: number) => {
        calls.push(`style:${index}`);
      }),
      previewRemoveObject: vi.fn((_page: number, index: number) => {
        calls.push(`remove:${index}`);
      }),
    };
    const runs: TextRunEdit[] = [
      { objectIndex: 3, text: "replacement" },
      { objectIndex: 4, text: "" },
      { objectIndex: 2 },
      { objectIndex: 7, text: "" },
    ];

    previewTextRuns(pdf, 0, runs, [1, 2, 3, 255]);

    expect(pdf.previewSetText).toHaveBeenCalledWith(0, 3, "replacement");
    expect(pdf.previewSetText).not.toHaveBeenCalledWith(0, expect.anything(), "");
    expect(calls).toEqual([
      "text:3:replacement",
      "style:3",
      "style:2",
      "remove:7",
      "remove:4",
    ]);
  });
});

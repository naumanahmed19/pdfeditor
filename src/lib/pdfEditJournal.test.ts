import { describe, expect, it } from "vitest";
import { appendPdfEdit } from "./pdfEditJournal";
import type { PdfEditOperation } from "./pdfEditTypes";

const move = (objectIndex: number, e: number, f: number): PdfEditOperation => ({
  type: "transformObject",
  pageIndex: 0,
  objectIndex,
  matrix: { a: 1, b: 0, c: 0, d: 1, e, f },
});

describe("PDF edit journal coalescing", () => {
  it("collapses adjacent translations of the same object", () => {
    const journal = appendPdfEdit([move(3, 5, -2)], move(3, 7, 4));
    expect(journal).toEqual([move(3, 12, 2)]);
  });

  it("does not cross another object operation", () => {
    const journal = [move(3, 5, 0), move(4, 1, 0)].reduce(
      appendPdfEdit,
      [] as PdfEditOperation[],
    );
    expect(appendPdfEdit(journal, move(3, 2, 0))).toHaveLength(3);
  });

  it("merges adjacent style patches and keeps the latest text", () => {
    let journal: PdfEditOperation[] = [];
    journal = appendPdfEdit(journal, {
      type: "setObjectStyle",
      pageIndex: 0,
      objectIndex: 1,
      style: { strokeWidth: 2 },
    });
    journal = appendPdfEdit(journal, {
      type: "setObjectStyle",
      pageIndex: 0,
      objectIndex: 1,
      style: { fill: [10, 20, 30, 255] },
    });
    expect(journal).toMatchObject([
      { style: { strokeWidth: 2, fill: [10, 20, 30, 255] } },
    ]);

    const text1: PdfEditOperation = {
      type: "editTextObject",
      pageIndex: 0,
      objectIndex: 7,
      newText: "first",
    };
    const text2 = { ...text1, newText: "latest" };
    expect(appendPdfEdit([text1], text2)).toEqual([text2]);
  });
});

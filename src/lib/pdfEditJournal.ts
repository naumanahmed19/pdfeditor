import type { Matrix } from "./pdfium";
import type { PdfEditOperation } from "./pdfEditTypes";

function sameTarget(a: PdfEditOperation, b: PdfEditOperation): boolean {
  return (
    "objectIndex" in a &&
    "objectIndex" in b &&
    a.pageIndex === b.pageIndex &&
    a.objectIndex === b.objectIndex
  );
}

function isTranslation(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
}

/** Append an edit while collapsing only adjacent operations whose semantics are
 * unambiguous. This keeps rapid drags and color changes to one worker rewrite. */
export function appendPdfEdit(
  journal: PdfEditOperation[],
  operation: PdfEditOperation,
): PdfEditOperation[] {
  const previous = journal[journal.length - 1];
  if (!previous || !sameTarget(previous, operation)) return [...journal, operation];

  if (
    previous.type === "transformObject" &&
    operation.type === "transformObject" &&
    isTranslation(previous.matrix) &&
    isTranslation(operation.matrix)
  ) {
    return [
      ...journal.slice(0, -1),
      {
        ...operation,
        matrix: {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: previous.matrix.e + operation.matrix.e,
          f: previous.matrix.f + operation.matrix.f,
        },
      },
    ];
  }
  if (previous.type === "setObjectStyle" && operation.type === "setObjectStyle") {
    return [
      ...journal.slice(0, -1),
      { ...operation, style: { ...previous.style, ...operation.style } },
    ];
  }
  if (previous.type === "editTextObject" && operation.type === "editTextObject") {
    return [...journal.slice(0, -1), operation];
  }
  return [...journal, operation];
}

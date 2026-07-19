import {
  editTextObject,
  editPageObjects,
  reflowTextLines,
  removeObject,
  setObjectStyle,
  styleTextRuns,
  transformObject,
} from "./pdfium";
import type { PdfEditOperation } from "./pdfEditTypes";

type ObjectEditOperation = Extract<
  PdfEditOperation,
  { type: "transformObject" | "removeObject" | "setObjectStyle" }
>;

function isObjectEdit(operation: PdfEditOperation): operation is ObjectEditOperation {
  return (
    operation.type === "transformObject" ||
    operation.type === "removeObject" ||
    operation.type === "setObjectStyle"
  );
}

/** Execute one byte-level PDF mutation. Kept separate so non-worker runtimes
 * can use the same implementation as a graceful fallback. */
export function executePdfEdit(
  bytes: Uint8Array,
  operation: PdfEditOperation,
): Promise<Uint8Array> {
  switch (operation.type) {
    case "editTextObject":
      return editTextObject(
        bytes,
        operation.pageIndex,
        operation.objectIndex,
        operation.newText,
      );
    case "styleTextRuns":
      return styleTextRuns(bytes, operation.pageIndex, operation.runs, operation.style);
    case "reflowTextLines":
      return reflowTextLines(bytes, operation.pageIndex, operation.spec);
    case "transformObject":
      return transformObject(
        bytes,
        operation.pageIndex,
        operation.objectIndex,
        operation.matrix,
      );
    case "removeObject":
      return removeObject(bytes, operation.pageIndex, operation.objectIndex);
    case "setObjectStyle":
      return setObjectStyle(
        bytes,
        operation.pageIndex,
        operation.objectIndex,
        operation.style,
      );
  }
}

/** Execute a journal of edits. Consecutive object mutations share one PDF open
 * and one content regeneration per touched page; complex text edits retain
 * their existing fail-closed implementations. */
export async function executePdfEdits(
  bytes: Uint8Array,
  operations: readonly PdfEditOperation[],
): Promise<Uint8Array> {
  let current = bytes;
  for (let i = 0; i < operations.length; ) {
    if (!isObjectEdit(operations[i])) {
      current = await executePdfEdit(current, operations[i]);
      i++;
      continue;
    }
    const batch: ObjectEditOperation[] = [];
    while (i < operations.length && isObjectEdit(operations[i])) {
      batch.push(operations[i] as ObjectEditOperation);
      i++;
    }
    current = await editPageObjects(current, batch);
  }
  return current;
}

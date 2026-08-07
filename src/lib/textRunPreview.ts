import type { PdfDoc } from "./pdf";
import type { TextRunEdit } from "./pdfium";

type PreviewPdf = Pick<
  PdfDoc,
  "previewRemoveObject" | "previewSetObjectStyle" | "previewSetText"
>;

/**
 * Mirror a text-run edit on the live PDFium document while the durable worker
 * rewrites the bytes. An empty run means "remove this object"; PDFium's text
 * setter rejects an empty string, so removals must use the object API.
 *
 * Apply text/style changes before removals, then delete from the highest
 * object index downward. Removing an object shifts later page-object indexes.
 */
export function previewTextRuns(
  pdf: PreviewPdf,
  pageIndex: number,
  runs: TextRunEdit[],
  fill?: [number, number, number, number],
): void {
  for (const run of runs) {
    if (run.text === "") continue;
    if (run.text != null) {
      pdf.previewSetText(pageIndex, run.objectIndex, run.text);
    }
    if (fill) {
      pdf.previewSetObjectStyle(pageIndex, run.objectIndex, { fill });
    }
  }

  const removals = runs
    .filter((run) => run.text === "")
    .sort((a, b) => b.objectIndex - a.objectIndex);
  for (const run of removals) {
    pdf.previewRemoveObject(pageIndex, run.objectIndex);
  }
}

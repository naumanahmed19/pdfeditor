// Experiment harness for the PDFium prototype (see pdfium.ts). Not shipped —
// exercised via the dev console on the `pdfium-experiment` branch:
//   const m = await import('/src/lib/pdfium_test.ts'); await m.testRedaction();
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  editTextObject,
  getTextObjects,
  redactRegions,
  renderPage,
  renderPageToCanvas,
} from "./pdfium";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

async function samplePage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 150]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("PUBLIC line", { x: 20, y: 110, size: 18, font });
  page.drawText("SECRET-12345", { x: 20, y: 60, size: 18, font });
  page.drawRectangle({
    x: 10,
    y: 10,
    width: 280,
    height: 130,
    borderColor: rgb(0.2, 0.4, 0.9),
    borderWidth: 2,
  });
  return doc.save();
}

async function extractText(bytes: Uint8Array): Promise<string> {
  GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out += tc.items.map((it: any) => it.str).join(" ") + "\n";
  }
  return out.trim();
}

/** Rasterization sanity check + timing. */
export async function testRender() {
  const bytes = await samplePage();
  const t0 = performance.now();
  const r = await renderPage(bytes, 0, 3);
  return { width: r.width, height: r.height, ms: Math.round(performance.now() - t0) };
}

/** Prove redaction is destructive: the secret is gone from the saved bytes. */
export async function testRedaction() {
  const bytes = await samplePage();
  const before = await extractText(bytes);
  const redacted = await redactRegions(bytes, [
    { pageIndex: 0, left: 15, bottom: 52, right: 200, top: 82 },
  ]);
  const after = await extractText(redacted);
  return {
    before,
    after,
    secretRemoved: !after.includes("SECRET"),
    publicKept: after.includes("PUBLIC"),
  };
}

/** Prove in-place text editing: the run's string changes, geometry preserved. */
export async function testEdit() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 120]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { x: 20, y: 60, size: 24, font });
  const bytes = await doc.save();

  const objs = await getTextObjects(bytes, 0);
  const target = objs.find((o) => o.text.includes("Hello"));
  if (!target) return { error: "no text object found", objs };

  const edited = await editTextObject(bytes, 0, target.index, "Howdy PDFium!");
  const after = await extractText(edited);
  const objsAfter = await getTextObjects(edited, 0);

  return {
    foundText: target.text,
    bounds: [target.left, target.bottom, target.right, target.top].map((n) =>
      Math.round(n),
    ),
    fontSize: target.fontSize,
    fontName: target.fontName,
    color: target.color,
    afterExtract: after,
    changed: after.includes("Howdy") && !after.includes("Hello"),
    newBounds: objsAfter[0]
      ? [objsAfter[0].left, objsAfter[0].bottom].map((n) => Math.round(n))
      : null,
  };
}

/** Edit then render, so we can screenshot the changed text in its place. */
export async function showEdit() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 120]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { x: 20, y: 60, size: 24, font });
  const bytes = await doc.save();
  const objs = await getTextObjects(bytes, 0);
  const t = objs.find((o) => o.text.includes("Hello"))!;
  const edited = await editTextObject(bytes, 0, t.index, "Howdy PDFium!");
  overlay(await renderPageToCanvas(edited, 0, 3));
}

function overlay(canvas: HTMLCanvasElement) {
  canvas.id = "pdfium-test-canvas";
  canvas.style.cssText =
    "position:fixed;top:20px;left:20px;z-index:99999;border:3px solid red;background:#fff";
  document.getElementById("pdfium-test-canvas")?.remove();
  document.body.appendChild(canvas);
}

/** Render the sample page with PDFium and overlay it for a screenshot. */
export async function showRender() {
  overlay(await renderPageToCanvas(await samplePage(), 0, 3));
}

/** Redact the secret line, then render the result (black box) for a screenshot. */
export async function showRedaction() {
  const redacted = await redactRegions(await samplePage(), [
    { pageIndex: 0, left: 15, bottom: 52, right: 200, top: 82 },
  ]);
  overlay(await renderPageToCanvas(redacted, 0, 3));
}

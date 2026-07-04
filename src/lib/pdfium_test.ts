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

/** A small multi-line text PDF, for exercising the in-place editor UI. */
export async function makeEditablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 260]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Invoice #1042", { x: 40, y: 200, size: 22, font });
  page.drawText("Billed to: Acme Corporation", { x: 40, y: 150, size: 14, font });
  page.drawText("Amount due: $250.00", { x: 40, y: 110, size: 14, font });
  return doc.save();
}

/** A multi-page text PDF so the viewer scrolls — for testing focus-jump. */
export async function makeMultiPagePdf(pages = 5): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([420, 600]);
    for (let i = 0; i < 12; i++) {
      page.drawText(`Page ${p + 1} line ${i + 1}: editable text here`, {
        x: 40,
        y: 560 - i * 40,
        size: 14,
        font,
      });
    }
  }
  return doc.save();
}

/** A PDF with a text run and an embedded image, for the object editor. */
export async function makeObjectPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Movable heading", { x: 40, y: 250, size: 20, font });
  // 1x1 red PNG, drawn as a 120x80 box.
  const png = await doc.embedPng(
    Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    ),
  );
  page.drawImage(png, { x: 40, y: 80, width: 120, height: 80 });
  return doc.save();
}

/** Fill a text field, regenerate its appearance via PDFium, confirm it renders. */
export async function testFormAppearance() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 120]);
  const form = doc.getForm();
  const tf = form.createTextField("fullName");
  tf.setText("Ada Lovelace");
  tf.addToPage(page, { x: 20, y: 60, width: 220, height: 24 });
  const bytes = await doc.save();

  const { regenerateFormAppearances } = await import("./pdfium");
  const fixed = await regenerateFormAppearances(bytes);

  // Render with pdf.js (which paints widget appearances) and count dark pixels
  // in the field region — confirms PDFium generated a real AP, not a blank one.
  GlobalWorkerOptions.workerSrc = workerUrl;
  const darkPixels = async (b: Uint8Array) => {
    const pdf = await getDocument({ data: b.slice() }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 110 && data[i + 1] < 110 && data[i + 2] < 110) n++;
    }
    return n;
  };
  return {
    afterDark: await darkPixels(fixed),
    bytesChanged: fixed.length !== bytes.length,
  };
}

/** Bake a fully-styled form field and confirm it opens with a real field. */
export async function testFieldBake() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 160]);
  const bytes = await doc.save();
  const { bakeAnnotations } = await import("./pdftools");
  const field: any = {
    id: "f1",
    kind: "formfield",
    fieldType: "text",
    fieldName: "email",
    x: 20,
    y: 40,
    w: 200,
    h: 24,
    required: true,
    readOnly: false,
    fontSize: 12,
    align: "center",
    maxLength: 40,
    tooltip: "Your email",
    defaultValue: "you@example.com",
    borderColor: "#2563eb",
    backgroundColor: "#eef2fb",
    borderWidth: 2,
    borderStyle: "dashed",
  };
  const baked = await bakeAnnotations(bytes, { 0: [field] });
  // Re-open with pdf-lib and inspect the field.
  const out = await PDFDocument.load(baked);
  const form = out.getForm();
  const f = form.getTextField("email");
  return {
    baked: baked.length,
    fieldNames: form.getFields().map((x) => x.getName()),
    text: f.getText(),
    maxLen: f.getMaxLength?.() ?? null,
    isRequired: f.isRequired(),
  };
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

// Redaction must fail closed and be verifiable. These tests run the real
// PDFium WASM under node (the wasm asset fetch is stubbed to read from
// node_modules) and prove that redacted content is gone from the saved bytes —
// and that failures throw instead of returning partially-redacted output.
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  getPageObjects,
  getPdfium,
  getTextObjects,
  redactRegions,
} from "./pdfium";

beforeAll(() => {
  // pdfium.ts loads its wasm with fetch(assetUrl); node can't fetch a bare
  // asset path, so serve the binary straight from the installed package.
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

// 1x1 red PNG (base64), embedded where an "image under the box" is needed.
const RED_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** One page, a public line, a secret line, and a border crossing the page. */
async function samplePdf(): Promise<Uint8Array> {
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

async function pageText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const objs = await getTextObjects(bytes, pageIndex);
  return objs.map((o) => o.text).join(" ");
}

// The secret line sits at y=60, size 18 — this rect covers it comfortably.
const SECRET_RECT = { pageIndex: 0, left: 15, bottom: 52, right: 200, top: 82 };

describe("redactRegions — removal and verification", () => {
  it("removes the covered text and keeps the rest", async () => {
    const out = await redactRegions(await samplePdf(), [SECRET_RECT]);
    const text = await pageText(out);
    expect(text).not.toContain("SECRET");
    expect(text).toContain("PUBLIC");
  });

  it("paints a black box over the redacted region", async () => {
    const out = await redactRegions(await samplePdf(), [SECRET_RECT]);
    const paths = (await getPageObjects(out, 0)).filter((o) => o.kind === "path");
    const box = paths.find(
      (p) =>
        p.left >= SECRET_RECT.left - 1 &&
        p.right <= SECRET_RECT.right + 1 &&
        p.bottom >= SECRET_RECT.bottom - 1 &&
        p.top <= SECRET_RECT.top + 1 &&
        p.fill?.[0] === 0 &&
        p.fill?.[1] === 0 &&
        p.fill?.[2] === 0,
    );
    expect(box).toBeDefined();
  });

  it("keeps vector paths that merely cross the box (page border survives)", async () => {
    const out = await redactRegions(await samplePdf(), [SECRET_RECT]);
    const paths = (await getPageObjects(out, 0)).filter((o) => o.kind === "path");
    // The blue border spans (10,10)-(290,140); the redact box only crosses it.
    const border = paths.find((p) => p.right - p.left > 250 && p.top - p.bottom > 100);
    expect(border).toBeDefined();
  });

  it("removes vector paths fully covered by the box", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 150]);
    // A small filled shape entirely inside the redact rect.
    page.drawRectangle({ x: 40, y: 58, width: 30, height: 12, color: rgb(1, 0, 0) });
    const out = await redactRegions(await doc.save(), [SECRET_RECT]);
    const paths = (await getPageObjects(out, 0)).filter((o) => o.kind === "path");
    // Only our black box (covering the whole rect) may remain — the small red
    // shape (~30x12) must be gone.
    const small = paths.find((p) => p.right - p.left < 100 && p.top - p.bottom < 25);
    expect(small).toBeUndefined();
  });

  it("removes an image that partially overlaps the box", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 150]);
    const png = await doc.embedPng(RED_PIXEL_PNG);
    // Image at (150..280, 40..120) — the secret rect (15..200, 52..82)
    // overlaps it only partially. Partial overlap must still remove it whole.
    page.drawImage(png, { x: 150, y: 40, width: 130, height: 80 });
    const out = await redactRegions(await doc.save(), [SECRET_RECT]);
    const images = (await getPageObjects(out, 0)).filter((o) => o.kind === "image");
    expect(images).toHaveLength(0);
  });

  it("keeps images that don't touch any box", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 150]);
    const png = await doc.embedPng(RED_PIXEL_PNG);
    page.drawImage(png, { x: 220, y: 100, width: 60, height: 40 }); // clear of the rect
    const out = await redactRegions(await doc.save(), [SECRET_RECT]);
    const images = (await getPageObjects(out, 0)).filter((o) => o.kind === "image");
    expect(images).toHaveLength(1);
  });

  it("redacts a region with no text at all (still paints the box)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 150]); // completely blank page
    const out = await redactRegions(await doc.save(), [SECRET_RECT]);
    const paths = (await getPageObjects(out, 0)).filter((o) => o.kind === "path");
    expect(paths.length).toBeGreaterThan(0);
  });

  it("handles rotated pages in the same page-space convention", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 150]);
    page.setRotation(degrees(90));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Rotated text runs up-page from (x, y), occupying a narrow x column.
    page.drawText("PUBLIC line", { x: 40, y: 20, size: 14, font, rotate: degrees(90) });
    page.drawText("SECRET-12345", { x: 100, y: 20, size: 14, font, rotate: degrees(90) });
    // Cover only the secret's column, in the same unrotated page space the
    // quads and char boxes share.
    const out = await redactRegions(await doc.save(), [
      { pageIndex: 0, left: 80, bottom: 10, right: 108, top: 145 },
    ]);
    const text = await pageText(out);
    expect(text).not.toContain("SECRET");
    expect(text).toContain("PUBLIC");
  });
});

describe("redactRegions — fail closed", () => {
  it("throws when a rect targets a page that can't be loaded", async () => {
    await expect(
      redactRegions(await samplePdf(), [{ ...SECRET_RECT, pageIndex: 5 }]),
    ).rejects.toThrow(/page 6/);
  });

  it("throws when the removal primitive reports failure over real text", async () => {
    const mod = await getPdfium();
    const original = mod.EPDFText_RedactInQuads;
    (mod as { EPDFText_RedactInQuads: unknown }).EPDFText_RedactInQuads = () => false;
    try {
      await expect(redactRegions(await samplePdf(), [SECRET_RECT])).rejects.toThrow(
        /could not remove the text on page 1/,
      );
    } finally {
      (mod as { EPDFText_RedactInQuads: unknown }).EPDFText_RedactInQuads = original;
    }
  });

  it("post-save verification catches text the primitive claimed to remove", async () => {
    const mod = await getPdfium();
    const original = mod.EPDFText_RedactInQuads;
    // Lie: claim success but remove nothing. Verification must reopen the
    // saved bytes, find the surviving text, and refuse to return them.
    (mod as { EPDFText_RedactInQuads: unknown }).EPDFText_RedactInQuads = () => true;
    try {
      await expect(redactRegions(await samplePdf(), [SECRET_RECT])).rejects.toThrow(
        /verification failed.*still extractable on page 1/i,
      );
    } finally {
      (mod as { EPDFText_RedactInQuads: unknown }).EPDFText_RedactInQuads = original;
    }
  });
});

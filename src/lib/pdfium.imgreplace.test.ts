// Replace-image-in-place against the real PDFium WASM: the object keeps its
// box (matrix untouched) while the pixels change, verified by rendering the
// page before and after. Non-image targets fail closed.
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getPageObjects, renderPage, replaceImageObject } from "./pdfium";

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

// --- minimal deterministic 1x1 PNG encoder (no canvas in node) --------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** A valid 1×1 RGB PNG of the given color. */
function onePixelPng(r: number, g: number, b: number): Uint8Array {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 1); // width
  dv.setUint32(4, 1); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const idat = new Uint8Array(deflateSync(Uint8Array.from([0, r, g, b])));
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

// Image drawn at a known box on a small page.
const BOX = { x: 40, y: 60, w: 120, h: 80 };

async function pdfWithImage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const img = await doc.embedPng(onePixelPng(255, 0, 0)); // red
  page.drawImage(img, { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h });
  return doc.save();
}

/** RGBA of the pixel at the image box center (render scale 1). */
async function centerPixel(bytes: Uint8Array): Promise<[number, number, number]> {
  const { rgba, width, height } = await renderPage(bytes, 0, 1);
  const px = Math.round(BOX.x + BOX.w / 2);
  // Page space is y-up; the rendered bitmap is y-down.
  const py = Math.round(height - (BOX.y + BOX.h / 2));
  const o = (py * width + px) * 4;
  return [rgba[o], rgba[o + 1], rgba[o + 2]];
}

describe("replaceImageObject", () => {
  it("swaps the pixels but keeps the object's box", async () => {
    const bytes = await pdfWithImage();
    const [r0, g0, b0] = await centerPixel(bytes);
    expect(r0).toBeGreaterThan(200); // red before
    expect(g0).toBeLessThan(60);

    const before = (await getPageObjects(bytes, 0)).filter((o) => o.kind === "image");
    expect(before).toHaveLength(1);

    const out = await replaceImageObject(
      bytes,
      0,
      before[0].index,
      onePixelPng(0, 0, 255), // blue
      true,
    );

    const [r1, g1, b1] = await centerPixel(out);
    expect(b1).toBeGreaterThan(200); // blue after
    expect(r1).toBeLessThan(60);
    void g1;
    void b0;

    // Same single image object, same bounds — only the bitmap changed.
    const after = (await getPageObjects(out, 0)).filter((o) => o.kind === "image");
    expect(after).toHaveLength(1);
    expect(Math.abs(after[0].left - before[0].left)).toBeLessThan(0.5);
    expect(Math.abs(after[0].bottom - before[0].bottom)).toBeLessThan(0.5);
    expect(Math.abs(after[0].right - before[0].right)).toBeLessThan(0.5);
    expect(Math.abs(after[0].top - before[0].top)).toBeLessThan(0.5);
  });

  it("fails closed on a non-image object", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont("Helvetica");
    page.drawText("not an image", { x: 40, y: 100, size: 14, font });
    const bytes = await doc.save();
    const text = (await getPageObjects(bytes, 0)).find((o) => o.kind === "text");
    await expect(
      replaceImageObject(bytes, 0, text!.index, onePixelPng(0, 0, 255), true),
    ).rejects.toThrow(/not an image/);
  });
});

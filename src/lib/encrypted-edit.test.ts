import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { extractAllText } from "./pdf";
import { PdfDoc } from "./engine";
import { decryptPdf, encryptPdf, PDF_PERMISSIONS } from "./pdfium";
import { rotatePage } from "./pdftools";

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    if (typeof input === "string" && input.endsWith(".wasm")) {
      const wasm = await readFile(
        new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url),
      );
      return new Response(wasm, { headers: { "Content-Type": "application/wasm" } });
    }
    return realFetch(input as RequestInfo, init);
  });
});

async function protectedFixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("encrypted edit fixture", { x: 30, y: 120, size: 18, font });
  const plain = await doc.save();
  return encryptPdf(plain, {
    userPassword: "reader-secret",
    ownerPassword: "owner-secret",
    permissions: PDF_PERMISSIONS.allowAll,
  });
}

describe("authenticated encrypted editing", () => {
  it("refuses to pass encrypted bytes through pdf-lib", async () => {
    await expect(rotatePage(await protectedFixture(), 0, 90)).rejects.toThrow(
      /encrypted/i,
    );
  });

  it("decrypts with owner rights, edits, re-encrypts, and reopens", async () => {
    const encrypted = await protectedFixture();
    const working = await decryptPdf(encrypted, "owner-secret");
    const edited = await rotatePage(working, 0, 90);
    const saved = await encryptPdf(edited, {
      userPassword: "reader-secret",
      ownerPassword: "owner-secret",
      permissions: PDF_PERMISSIONS.allowAll,
    });

    const asUser = await PdfDoc.load(saved, "reader-secret");
    const asOwner = await PdfDoc.load(saved, "owner-secret");
    try {
      expect(asUser.isEncrypted()).toBe(true);
      expect(asOwner.isEncrypted()).toBe(true);
      expect(asUser.page(0).rotation).toBe(1);
      expect(asOwner.page(0).rotation).toBe(1);
      expect((await extractAllText(asUser))[0].full).toContain(
        "encrypted edit fixture",
      );
    } finally {
      await asUser.destroy();
      await asOwner.destroy();
    }
  });
});

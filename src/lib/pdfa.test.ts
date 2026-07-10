import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { checkPdfA, type PdfaReport } from "./pdfa";

function get(report: PdfaReport, id: string) {
  const f = report.findings.find((x) => x.id === id);
  expect(f, `finding ${id} exists`).toBeTruthy();
  return f!;
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false });
}

describe("checkPdfA", () => {
  it("flags unembedded standard-14 fonts by name", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 200]);
    page.drawText("hello", { x: 20, y: 100, size: 12, font: helv });

    const report = await checkPdfA(await save(doc));
    const fonts = get(report, "fonts-embedded");
    expect(fonts.passed).toBe(false);
    expect(fonts.severity).toBe("error");
    expect(fonts.items?.some((n) => n.includes("Helvetica"))).toBe(true);
    expect(report.ready).toBe(false);
  });

  it("flags embedded file attachments as a 2b error", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    await doc.attach(new TextEncoder().encode("payload"), "note.txt", {
      mimeType: "text/plain",
    });

    const report = await checkPdfA(await save(doc));
    const attach = get(report, "no-embedded-files");
    expect(attach.passed).toBe(false);
    expect(attach.severity).toBe("error");
    expect(attach.detail).toMatch(/PDF\/A-3/);
  });

  it("reports opacity as an info-level transparency finding", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    page.drawRectangle({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      color: rgb(0.2, 0.4, 0.9),
      opacity: 0.5,
    });

    const report = await checkPdfA(await save(doc));
    const transparency = get(report, "transparency");
    expect(transparency.passed).toBe(false);
    expect(transparency.severity).toBe("info");
    expect(transparency.items?.some((i) => i.includes("page 1"))).toBe(true);
    // Info findings never gate readiness by themselves.
    expect(report.infos).toBeGreaterThan(0);
  });

  it("always flags missing XMP metadata and OutputIntent", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);

    const report = await checkPdfA(await save(doc));
    expect(get(report, "xmp-metadata").passed).toBe(false);
    expect(get(report, "output-intent").passed).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.verdict).toMatch(/Not PDF\/A-ready/);
  });

  it("passes font/transparency/attachment rules on a clean embedded-font doc", async () => {
    const fontBytes = fs.readFileSync(
      path.resolve(__dirname, "../../public/fonts/Roboto-Regular.ttf"),
    );
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const roboto = await doc.embedFont(new Uint8Array(fontBytes), { subset: true });
    const page = doc.addPage([300, 200]);
    page.drawText("archival text", { x: 20, y: 100, size: 12, font: roboto });

    const report = await checkPdfA(await save(doc));
    expect(get(report, "fonts-embedded").passed).toBe(true);
    expect(get(report, "transparency").passed).toBe(true);
    expect(get(report, "no-embedded-files").passed).toBe(true);
    expect(get(report, "no-javascript").passed).toBe(true);
    expect(get(report, "no-xfa").passed).toBe(true);
    expect(get(report, "encryption").passed).toBe(true);
    expect(get(report, "annotation-subtypes").passed).toBe(true);
    // Still not "ready": XMP + OutputIntent are structurally absent.
    expect(report.errors).toBe(2);
  });

  it("counts fewer errors for the clean doc than the standard-font doc", async () => {
    const fontBytes = fs.readFileSync(
      path.resolve(__dirname, "../../public/fonts/Roboto-Regular.ttf"),
    );
    const clean = await PDFDocument.create();
    clean.registerFontkit(fontkit);
    const roboto = await clean.embedFont(new Uint8Array(fontBytes), { subset: true });
    clean.addPage([300, 200]).drawText("a", { x: 10, y: 10, size: 10, font: roboto });

    const dirty = await PDFDocument.create();
    const helv = await dirty.embedFont(StandardFonts.Helvetica);
    dirty.addPage([300, 200]).drawText("a", { x: 10, y: 10, size: 10, font: helv });
    await dirty.attach(new TextEncoder().encode("x"), "x.bin");

    const [cleanReport, dirtyReport] = await Promise.all([
      checkPdfA(await save(clean)),
      checkPdfA(await save(dirty)),
    ]);
    expect(cleanReport.errors).toBeLessThan(dirtyReport.errors);
  });
});

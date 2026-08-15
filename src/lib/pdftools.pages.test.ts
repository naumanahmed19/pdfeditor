import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  decodePDFRawStream,
  degrees,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import {
  deletePages,
  extractPages,
  insertBlankPage,
  mergeMixed,
  mergePdfs,
  movePage,
  setOutline,
  splitPdfPages,
} from "./pdftools";

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

async function decodedStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const decoder = new TextDecoder("latin1");
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      out += decoder.decode(decodePDFRawStream(obj).decode());
    } catch {
      // Binary streams cannot contain the literal text fixture.
    }
  }
  return out;
}

async function sizedPdf(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  sizes.forEach((size) => doc.addPage(size));
  return doc.save();
}

async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [width, height];
  });
}

/**
 * 3-page fixture with catalog-level structure page operations must preserve:
 * info metadata, an interactive AcroForm field per page, and an outline.
 */
async function structuredPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Fixture Title");
  doc.setAuthor("Fixture Author");
  doc.setSubject("Fixture Subject");
  const p1 = doc.addPage([300, 400]);
  const p2 = doc.addPage([350, 450]);
  const p3 = doc.addPage([400, 500]);
  const form = doc.getForm();
  const name = form.createTextField("name_p1");
  name.setText("hello");
  name.addToPage(p1, { x: 10, y: 10, width: 120, height: 20 });
  const email = form.createTextField("email_p2");
  email.setText("user@example.com");
  email.addToPage(p2, { x: 10, y: 10, width: 120, height: 20 });
  const agree = form.createCheckBox("agree_p3");
  agree.addToPage(p3, { x: 10, y: 10, width: 16, height: 16 });
  agree.check();
  const bytes = await doc.save();
  return setOutline(bytes, [
    { title: "One", pageIndex: 0, children: [] },
    { title: "Three", pageIndex: 2, children: [] },
  ]);
}

async function reload(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes);
}

function fieldNames(doc: PDFDocument): string[] {
  return doc
    .getForm()
    .getFields()
    .map((f) => f.getName())
    .sort();
}

function hasOutline(doc: PDFDocument): boolean {
  return doc.catalog.get(PDFName.of("Outlines")) !== undefined;
}

describe("page insertion", () => {
  it("inserts a blank page at the beginning using the first page size", async () => {
    const base = await sizedPdf([
      [300, 400],
      [500, 600],
    ]);

    await expect(pageSizes(await insertBlankPage(base, 0))).resolves.toEqual([
      [300, 400],
      [300, 400],
      [500, 600],
    ]);
  });

  it("inserts a blank page between pages using the previous page size", async () => {
    const base = await sizedPdf([
      [300, 400],
      [500, 600],
      [700, 800],
    ]);

    await expect(pageSizes(await insertBlankPage(base, 2))).resolves.toEqual([
      [300, 400],
      [500, 600],
      [500, 600],
      [700, 800],
    ]);
  });

  it("inserts a blank page at the end using the last page size", async () => {
    const base = await sizedPdf([
      [300, 400],
      [500, 600],
    ]);

    await expect(pageSizes(await insertBlankPage(base, 2))).resolves.toEqual([
      [300, 400],
      [500, 600],
      [500, 600],
    ]);
  });
});

describe("deletePages (secure survivor rebuild)", () => {
  it("deletes a middle page and keeps forms and metadata intact", async () => {
    const out = await deletePages(await structuredPdf(), [1]);
    const doc = await reload(out);

    expect(await pageSizes(out)).toEqual([
      [300, 400],
      [400, 500],
    ]);
    // The deleted page's field is pruned; the survivors stay interactive.
    expect(fieldNames(doc)).toEqual(["agree_p3", "name_p1"]);
    expect(doc.getForm().getTextField("name_p1").getText()).toBe("hello");
    expect(doc.getForm().getCheckBox("agree_p3").isChecked()).toBe(true);
    expect(doc.getTitle()).toBe("Fixture Title");
    expect(doc.getAuthor()).toBe("Fixture Author");
    expect(hasOutline(doc)).toBe(false);
  });

  it("deletes the first and last pages (unsorted, duplicated indexes)", async () => {
    const out = await deletePages(await structuredPdf(), [2, 0, 2]);
    const doc = await reload(out);

    expect(await pageSizes(out)).toEqual([[350, 450]]);
    expect(fieldNames(doc)).toEqual(["email_p2"]);
    expect(doc.getForm().getTextField("email_p2").getText()).toBe(
      "user@example.com",
    );
    expect(doc.getTitle()).toBe("Fixture Title");
    // Outlines are omitted until their page references can be safely remapped.
    expect(hasOutline(doc)).toBe(false);
  });

  it("keeps a multi-widget field when at least one widget's page survives", async () => {
    const src = await PDFDocument.create();
    const p1 = src.addPage([300, 400]);
    const p2 = src.addPage([300, 400]);
    const field = src.getForm().createTextField("shared");
    field.addToPage(p1, { x: 10, y: 10, width: 100, height: 20 });
    field.addToPage(p2, { x: 10, y: 10, width: 100, height: 20 });

    const doc = await reload(await deletePages(await src.save(), [0]));
    expect(doc.getPageCount()).toBe(1);
    expect(fieldNames(doc)).toEqual(["shared"]);
  });

  it("does not invent an AcroForm on documents without one", async () => {
    const out = await deletePages(await sizedPdf([[300, 400], [500, 600]]), [0]);
    const doc = await reload(out);

    expect(await pageSizes(out)).toEqual([[500, 600]]);
    expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("survives a save→reload→save round trip", async () => {
    const out = await deletePages(await structuredPdf(), [0]);
    const doc = await reload(out);
    const again = await reload(await doc.save());
    expect(again.getPageCount()).toBe(2);
    expect(fieldNames(again)).toEqual(["agree_p3", "email_p2"]);
  });
  it("removes deleted-page text from every decoded indirect stream", async () => {
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    src.addPage([300, 200]).drawText("PUBLIC_SURVIVING_PAGE", {
      x: 20,
      y: 120,
      size: 16,
      font,
    });
    src.addPage([300, 200]).drawText("TOP_SECRET_REMOVED_PAGE_7F31", {
      x: 20,
      y: 120,
      size: 16,
      font,
    });

    const out = await deletePages(await src.save(), [1]);
    const streams = await decodedStreams(out);
    const hex = (s: string) =>
      Array.from(new TextEncoder().encode(s), (b) =>
        b.toString(16).padStart(2, "0"),
      )
        .join("")
        .toUpperCase();
    expect(streams).toContain(hex("PUBLIC_SURVIVING_PAGE"));
    expect(streams).not.toContain(hex("TOP_SECRET_REMOVED_PAGE_7F31"));
  });
});

describe("movePage (in-place, structure-preserving)", () => {
  it("moves the first page to the end", async () => {
    const out = await movePage(await structuredPdf(), 0, 2);
    const doc = await reload(out);

    expect(await pageSizes(out)).toEqual([
      [350, 450],
      [400, 500],
      [300, 400],
    ]);
    // Nothing is rebuilt, so every field survives with its value.
    expect(fieldNames(doc)).toEqual(["agree_p3", "email_p2", "name_p1"]);
    expect(doc.getForm().getTextField("name_p1").getText()).toBe("hello");
    expect(doc.getForm().getTextField("email_p2").getText()).toBe(
      "user@example.com",
    );
    expect(doc.getTitle()).toBe("Fixture Title");
    expect(doc.getSubject()).toBe("Fixture Subject");
    expect(hasOutline(doc)).toBe(true);
  });

  it("moves the last page to the front", async () => {
    const out = await movePage(await structuredPdf(), 2, 0);
    expect(await pageSizes(out)).toEqual([
      [400, 500],
      [300, 400],
      [350, 450],
    ]);
  });

  it("moves a middle page one step down", async () => {
    const out = await movePage(await structuredPdf(), 1, 2);
    expect(await pageSizes(out)).toEqual([
      [300, 400],
      [400, 500],
      [350, 450],
    ]);
  });

  it("is a no-op when from equals to", async () => {
    const out = await movePage(await structuredPdf(), 1, 1);
    const doc = await reload(out);
    expect(await pageSizes(out)).toEqual([
      [300, 400],
      [350, 450],
      [400, 500],
    ]);
    expect(fieldNames(doc)).toEqual(["agree_p3", "email_p2", "name_p1"]);
  });
});

describe("extractPages (metadata + interactive form fields)", () => {
  it("keeps the extracted page's field interactive and copies metadata", async () => {
    const out = await extractPages(await structuredPdf(), [1]);
    const doc = await reload(out);

    expect(await pageSizes(out)).toEqual([[350, 450]]);
    expect(fieldNames(doc)).toEqual(["email_p2"]);
    expect(doc.getForm().getTextField("email_p2").getText()).toBe(
      "user@example.com",
    );
    expect(doc.getTitle()).toBe("Fixture Title");
    expect(doc.getAuthor()).toBe("Fixture Author");
  });

  it("does not add an AcroForm when the extracted pages carry no widgets", async () => {
    const src = await PDFDocument.create();
    const withField = src.addPage([300, 400]);
    src.addPage([500, 600]);
    const field = src.getForm().createTextField("only_p1");
    field.addToPage(withField, { x: 10, y: 10, width: 100, height: 20 });

    const doc = await reload(await extractPages(await src.save(), [1]));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("preserves the requested page order and all touched fields", async () => {
    const out = await extractPages(await structuredPdf(), [2, 0]);
    const doc = await reload(out);

    expect(await pageSizes(out)).toEqual([
      [400, 500],
      [300, 400],
    ]);
    expect(fieldNames(doc)).toEqual(["agree_p3", "name_p1"]);
    expect(doc.getForm().getCheckBox("agree_p3").isChecked()).toBe(true);
  });
});

describe("large-document page processing", () => {
  it("splits every page from one source parse and reports progress", async () => {
    const outputs: Uint8Array[] = [];
    const progress: number[] = [];

    await splitPdfPages(
      await structuredPdf(),
      (bytes) => {
        outputs.push(bytes);
      },
      ({ completed }) => progress.push(completed),
    );

    expect(outputs).toHaveLength(3);
    expect(progress).toEqual([1, 2, 3]);
    expect(await Promise.all(outputs.map(pageSizes))).toEqual([
      [[300, 400]],
      [[350, 450]],
      [[400, 500]],
    ]);
    expect((await reload(outputs[0])).getTitle()).toBe("Fixture Title");
  });

  it("merges large PDFs in responsive page chunks", async () => {
    const source = await sizedPdf(
      Array.from({ length: 50 }, (_, index) => [300 + index, 400] as [number, number]),
    );
    const progress: number[] = [];

    const out = await mergeMixed([{ bytes: source, kind: "pdf" }], (next) => {
      progress.push(next.completedPages);
    });

    expect((await PDFDocument.load(out)).getPageCount()).toBe(50);
    expect(progress).toEqual([24, 48, 50]);
  });
});

describe("mergePdfs (metadata + interactive form fields)", () => {
  it("keeps fields from every source interactive and takes metadata from the first", async () => {
    const other = await PDFDocument.create();
    other.setTitle("Other Title");
    const page = other.addPage([200, 200]);
    const extra = other.getForm().createTextField("other_field");
    extra.setText("B");
    extra.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });

    const out = await mergePdfs([await structuredPdf(), await other.save()]);
    const doc = await reload(out);

    expect(doc.getPageCount()).toBe(4);
    expect(fieldNames(doc)).toEqual([
      "agree_p3",
      "email_p2",
      "name_p1",
      "other_field",
    ]);
    expect(doc.getForm().getTextField("name_p1").getText()).toBe("hello");
    expect(doc.getForm().getTextField("other_field").getText()).toBe("B");
    expect(doc.getTitle()).toBe("Fixture Title");
  });
});

describe("mergeMixed rotation", () => {
  const redPixelPng = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ),
    (char) => char.charCodeAt(0),
  );

  it("rotates every copied PDF page and an image page clockwise", async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]).setRotation(degrees(90));
    source.addPage([300, 400]);

    const out = await mergeMixed([
      { bytes: await source.save(), kind: "pdf", rotation: 90 },
      { bytes: redPixelPng, kind: "image/png", rotation: 270 },
    ]);
    const merged = await PDFDocument.load(out);

    expect(merged.getPages().map((page) => page.getRotation().angle)).toEqual([180, 90, 270]);
  });
});

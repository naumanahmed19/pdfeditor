// Annotation round-trip: overlay → bakeAnnotations (native annot dicts) →
// importAnnotations (back into overlay). Kinds, geometry and colors must
// survive a full save→reopen cycle; foreign (Acrobat-style) annotations must
// import too; unsupported subtypes and signed documents must be left alone.
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
} from "pdf-lib";
import type { Annotation, AnnotationMap, ShapeAnnotation } from "../types";
import { bakeAnnotations } from "./pdftools";
import { importAnnotations } from "./annotimport";

const PAGE_W = 612;
const PAGE_H = 792;

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  return doc.save();
}

/** All /Annots subtypes on page 0 of `bytes`. */
async function pageSubtypes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const arr = doc.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!arr) return [];
  const out: string[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const d = arr.lookupMaybe(i, PDFDict);
    const st = d?.lookupMaybe(PDFName.of("Subtype"), PDFName);
    if (st) out.push(st.toString().replace(/^\//, ""));
  }
  return out;
}

const near = (a: number, b: number, tol = 0.75) => Math.abs(a - b) <= tol;

describe("annotation round-trip (bake native → import)", () => {
  it("survives a save→reopen cycle for every markup kind", async () => {
    const overlay: Annotation[] = [
      { id: "h1", kind: "highlight", x: 50, y: 100, w: 120, h: 14, color: "#ffe066" },
      { id: "m1", kind: "markup", style: "underline", x: 50, y: 130, w: 100, h: 12, color: "#e11d48" },
      { id: "m2", kind: "markup", style: "strikeout", x: 50, y: 150, w: 100, h: 12, color: "#0f766e" },
      { id: "m3", kind: "markup", style: "squiggly", x: 50, y: 170, w: 100, h: 12, color: "#7c3aed" },
      { id: "i1", kind: "ink", x: 200, y: 100, w: 60, h: 40, color: "#1d4ed8", strokeWidth: 2,
        points: [{ x: 0, y: 0 }, { x: 30, y: 20 }, { x: 60, y: 40 }] },
      { id: "r1", kind: "rect", x: 300, y: 100, w: 80, h: 50, color: "#dc2626", strokeWidth: 3, fill: "#fecaca" },
      { id: "e1", kind: "ellipse", x: 300, y: 200, w: 90, h: 60, color: "#16a34a", strokeWidth: 2 },
      { id: "l1", kind: "line", x: 420, y: 100, w: 100, h: 40, color: "#111111", strokeWidth: 2, down: true },
      { id: "a1", kind: "arrow", x: 420, y: 200, w: 100, h: 50, color: "#f59e0b", strokeWidth: 2,
        ax: 0, ay: 1, bx: 1, by: 0 },
      { id: "n1", kind: "note", x: 560, y: 100, w: 22, h: 22, color: "#fbbf24", text: "hello note" },
    ];
    const map: AnnotationMap = { 0: overlay };
    const baked = await bakeAnnotations(await blankPdf(), map);

    // The baked file carries REAL annotation dicts, not just page content.
    const subtypes = await pageSubtypes(baked);
    for (const st of ["Highlight", "Underline", "StrikeOut", "Squiggly", "Ink", "Square", "Circle", "Text", "Popup"]) {
      expect(subtypes, `expected a /${st}`).toContain(st);
    }
    expect(subtypes.filter((s) => s === "Line")).toHaveLength(2); // line + arrow

    const imported = await importAnnotations(baked);
    expect(imported).not.toBeNull();
    const anns = imported!.annotations[0];
    expect(anns).toBeDefined();

    const byKind = (k: string) => anns.filter((a) => a.kind === k);
    expect(byKind("highlight")).toHaveLength(1);
    expect(byKind("markup")).toHaveLength(3);
    expect(byKind("ink")).toHaveLength(1);
    expect(byKind("rect")).toHaveLength(1);
    expect(byKind("ellipse")).toHaveLength(1);
    expect(byKind("line")).toHaveLength(1);
    expect(byKind("arrow")).toHaveLength(1);
    expect(byKind("note")).toHaveLength(1);

    // Geometry: quad-backed and RD-inset kinds return to their exact boxes.
    const h = byKind("highlight")[0];
    expect(near(h.x, 50) && near(h.y, 100) && near(h.w, 120) && near(h.h, 14)).toBe(true);
    const r = byKind("rect")[0];
    expect(near(r.x, 300) && near(r.y, 100) && near(r.w, 80) && near(r.h, 50)).toBe(true);
    const e = byKind("ellipse")[0];
    expect(near(e.x, 300) && near(e.y, 200) && near(e.w, 90) && near(e.h, 60)).toBe(true);

    // Colors and styles survive.
    expect(h.kind === "highlight" && h.color.toLowerCase()).toBe("#ffe066");
    const strikes = byKind("markup") as Array<Extract<Annotation, { kind: "markup" }>>;
    expect(new Set(strikes.map((m) => m.style))).toEqual(
      new Set(["underline", "strikeout", "squiggly"]),
    );
    const rect = r as ShapeAnnotation;
    expect(rect.fill?.toLowerCase()).toBe("#fecaca");
    expect(rect.strokeWidth).toBe(3);

    // Ink path shape survives (endpoints within tolerance).
    const ink = byKind("ink")[0] as Extract<Annotation, { kind: "ink" }>;
    expect(ink.points).toHaveLength(3);
    expect(near(ink.points[2].x, 60) && near(ink.points[2].y, 40)).toBe(true);

    // Arrow keeps its endpoints (tail bottom-left, head top-right).
    const arrow = byKind("arrow")[0] as ShapeAnnotation;
    expect(near(arrow.x + (arrow.ax ?? 0) * arrow.w, 420, 1.5)).toBe(true);
    expect(near(arrow.y + (arrow.ay ?? 0) * arrow.h, 250, 1.5)).toBe(true);

    // The note text and author round-trip; sources are gone from the bytes.
    const note = byKind("note")[0] as Extract<Annotation, { kind: "note" }>;
    expect(note.text).toBe("hello note");
    expect(note.author).toBe("PickPDF");
    const remaining = await pageSubtypes(imported!.cleanedBytes);
    expect(remaining).toEqual([]); // popups removed with their notes
  });

  it("second cycle is stable (no geometry drift, no duplication)", async () => {
    const map: AnnotationMap = {
      0: [
        { id: "r", kind: "rect", x: 100, y: 100, w: 80, h: 50, color: "#dc2626", strokeWidth: 3 },
      ],
    };
    const once = await importAnnotations(await bakeAnnotations(await blankPdf(), map));
    const againBaked = await bakeAnnotations(once!.cleanedBytes, once!.annotations);
    const twice = await importAnnotations(againBaked);
    expect(twice!.annotations[0]).toHaveLength(1);
    const r = twice!.annotations[0][0];
    expect(near(r.x, 100) && near(r.y, 100) && near(r.w, 80) && near(r.h, 50)).toBe(true);
  });

  it("imports foreign (Acrobat-style) annotations and leaves stamps alone", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx = doc.context;
    const push = (dict: Record<string, unknown>) => {
      const ref = ctx.register(ctx.obj(dict as never));
      const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      const annots = existing ?? ctx.obj([]);
      if (!existing) page.node.set(PDFName.of("Annots"), annots);
      (annots as PDFArray).push(ref as PDFRef);
    };
    // A highlight the way Acrobat writes it (QuadPoints TL TR BL BR).
    push({
      Type: "Annot", Subtype: "Highlight",
      Rect: [100, 700, 220, 716],
      QuadPoints: [100, 716, 220, 716, 100, 700, 220, 700],
      C: [1, 0.9, 0.4], CA: 0.4, F: 4,
      Contents: PDFHexString.fromText("why highlighted"),
      T: PDFHexString.fromText("Alice"),
    });
    // A stamp — unsupported, must remain untouched in the file.
    push({
      Type: "Annot", Subtype: "Stamp",
      Rect: [300, 700, 400, 740], Name: "Approved", F: 4,
    });
    const bytes = await doc.save();

    const imported = await importAnnotations(bytes);
    expect(imported).not.toBeNull();
    expect(imported!.count).toBe(1);
    const [h] = imported!.annotations[0];
    expect(h.kind).toBe("highlight");
    // Display space: y = pageH − topY = 792 − 716 = 76.
    expect(near(h.x, 100) && near(h.y, 76) && near(h.w, 120) && near(h.h, 16)).toBe(true);
    expect(await pageSubtypes(imported!.cleanedBytes)).toEqual(["Stamp"]);
  });

  it("refuses to touch a signed document", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx = doc.context;
    // Minimal SIGNED signature field + a highlight that would otherwise import.
    const sigValue = ctx.register(ctx.obj({ Type: "Sig", Filter: "Adobe.PPKLite" }));
    const sigField = ctx.register(
      ctx.obj({ FT: "Sig", T: PDFHexString.fromText("Signature1"), V: sigValue }),
    );
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [sigField] }));
    const annots = ctx.obj([]);
    page.node.set(PDFName.of("Annots"), annots);
    annots.push(
      ctx.register(
        ctx.obj({
          Type: "Annot", Subtype: "Highlight",
          Rect: [100, 700, 220, 716],
          QuadPoints: [100, 716, 220, 716, 100, 700, 220, 700],
          C: [1, 0.9, 0.4],
        }),
      ),
    );
    expect(await importAnnotations(await doc.save())).toBeNull();
  });

  it("returns null when there is nothing to import", async () => {
    expect(await importAnnotations(await blankPdf())).toBeNull();
  });
});

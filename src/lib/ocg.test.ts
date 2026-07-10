import { describe, expect, it } from "vitest";
import { PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { listLayers, setLayerVisibility } from "./ocg";

/**
 * One-page fixture with hand-built /OCProperties: "Dimensions" at the top
 * level of /Order with "Notes" nested under it, plus an optional third OCG
 * ("Orphan") listed in /OCGs but absent from /Order. Content-stream BDC/EMC
 * marking is out of scope — rendering against the config is PDFium's job.
 */
async function ocgPdf(opts?: { orphan?: boolean; baseStateOff?: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const ctx = doc.context;

  const dims = ctx.register(
    ctx.obj({ Type: "OCG", Name: PDFHexString.fromText("Dimensions") }),
  );
  const notes = ctx.register(
    ctx.obj({ Type: "OCG", Name: PDFHexString.fromText("Notes") }),
  );
  const ocgs: PDFRef[] = [dims, notes];
  if (opts?.orphan) {
    ocgs.push(ctx.register(ctx.obj({ Type: "OCG", Name: PDFHexString.fromText("Orphan") })));
  }

  const d = ctx.obj({
    Name: PDFHexString.fromText("Default"),
    Order: [dims, ctx.obj([notes])],
  });
  if (opts?.baseStateOff) d.set(PDFName.of("BaseState"), PDFName.of("OFF"));

  doc.catalog.set(PDFName.of("OCProperties"), ctx.obj({ OCGs: ocgs, D: d }));
  return doc.save();
}

describe("listLayers", () => {
  it("returns [] for a document without /OCProperties", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    expect(await listLayers(await doc.save())).toEqual([]);
  });

  it("reads names, /Order nesting depth, and BaseState-ON default visibility", async () => {
    const layers = await listLayers(await ocgPdf());
    expect(layers.map((l) => l.name)).toEqual(["Dimensions", "Notes"]);
    expect(layers.map((l) => l.depth)).toEqual([0, 1]);
    // No /ON or /OFF entries: BaseState defaults to ON.
    expect(layers.map((l) => l.visible)).toEqual([true, true]);
  });

  it("honors /BaseState /OFF when a layer is in neither /ON nor /OFF", async () => {
    const layers = await listLayers(await ocgPdf({ baseStateOff: true }));
    expect(layers.map((l) => l.visible)).toEqual([false, false]);
  });

  it("appends OCGs missing from /Order at depth 0", async () => {
    const layers = await listLayers(await ocgPdf({ orphan: true }));
    expect(layers.map((l) => l.name)).toEqual(["Dimensions", "Notes", "Orphan"]);
    expect(layers[2].depth).toBe(0);
  });
});

describe("setLayerVisibility", () => {
  it("hides only the targeted layer and survives a re-list round trip", async () => {
    const bytes = await ocgPdf();
    const before = await listLayers(bytes);
    const notes = before.find((l) => l.name === "Notes")!;

    const hidden = await setLayerVisibility(bytes, [notes.id], false);
    const after = await listLayers(hidden);
    expect(after.map((l) => [l.name, l.visible])).toEqual([
      ["Dimensions", true],
      ["Notes", false],
    ]);

    // Toggle back on: /OFF membership must not stick.
    const shown = await setLayerVisibility(hidden, [notes.id], true);
    expect((await listLayers(shown)).map((l) => l.visible)).toEqual([true, true]);
  });

  it("keeps untargeted layers' state and preserves other /D entries", async () => {
    const bytes = await ocgPdf();
    const before = await listLayers(bytes);
    const oneOff = await setLayerVisibility(bytes, [before[0].id], false);
    const bothOff = await setLayerVisibility(oneOff, [before[1].id], false);
    expect((await listLayers(bothOff)).map((l) => l.visible)).toEqual([false, false]);

    const doc = await PDFDocument.load(bothOff);
    const d = doc.catalog
      .lookup(PDFName.of("OCProperties"))!
      // @ts-expect-error PDFObject → PDFDict narrowing not modeled
      .lookup(PDFName.of("D"));
    expect(d.lookup(PDFName.of("Name")).decodeText()).toBe("Default");
    expect(d.lookup(PDFName.of("Order"))).toBeDefined();
  });

  it("show-all turns every layer on in one op, even under BaseState OFF", async () => {
    const bytes = await ocgPdf({ orphan: true, baseStateOff: true });
    const layers = await listLayers(bytes);
    const shown = await setLayerVisibility(bytes, layers.map((l) => l.id), true);
    expect((await listLayers(shown)).map((l) => l.visible)).toEqual([true, true, true]);
  });
});

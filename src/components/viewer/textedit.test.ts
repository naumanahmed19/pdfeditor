import { describe, it, expect } from "vitest";
import {
  styleKey,
  familyRoot,
  detectFontFromName,
  collectLine,
  mapLineEditToRuns,
  resolveTextFont,
  type InlineEdit,
  type InlineEditRun,
} from "./textedit";
import type { TextObject } from "../../lib/pdfium";

// --- fixtures ---------------------------------------------------------------

/** Build a TextObject with sensible defaults; override the fields a test cares about. */
function obj(p: Partial<TextObject>): TextObject {
  return {
    index: 0,
    text: "x",
    left: 0,
    bottom: 0,
    right: 10,
    top: 10,
    fontSize: 10,
    color: [0, 0, 0, 255],
    fontName: "Helvetica",
    originX: 0,
    originY: 0,
    ...p,
  };
}

function run(p: Partial<InlineEditRun>): InlineEditRun {
  return { objectIndex: 0, text: "", start: 0, sep: "", originX: 0, originY: 0, fontName: "F", ...p };
}

/** Minimal InlineEdit — mapLineEditToRuns only reads `original` and `runs`. */
function edit(original: string, runs: InlineEditRun[]): InlineEdit {
  return { original, runs } as InlineEdit;
}

// --- styleKey ---------------------------------------------------------------

describe("styleKey", () => {
  it("encodes each bold/italic combination", () => {
    expect(styleKey(false, false)).toBe("r");
    expect(styleKey(true, false)).toBe("b");
    expect(styleKey(false, true)).toBe("i");
    expect(styleKey(true, true)).toBe("bi");
  });
});

// --- familyRoot -------------------------------------------------------------

describe("familyRoot", () => {
  it("strips the 6-char subset prefix", () => {
    expect(familyRoot("ABCDEF+Arial")).toBe("arial");
  });
  it("strips weight/slant tokens", () => {
    expect(familyRoot("Helvetica-BoldOblique")).toBe("helvetica");
    expect(familyRoot("Georgia-Italic")).toBe("georgia");
  });
  it("strips a trailing foundry suffix", () => {
    expect(familyRoot("ArialMT")).toBe("arial");
  });
});

// --- detectFontFromName -----------------------------------------------------

describe("detectFontFromName", () => {
  it("maps Calibri/Cambria to their bundled metric-compatible families", () => {
    expect(detectFontFromName("ABCDEF+Calibri-Bold")).toEqual({
      family: "carlito",
      bold: true,
      italic: false,
    });
    expect(detectFontFromName("Cambria")).toMatchObject({ family: "caladea" });
  });
  it("recognizes courier and times", () => {
    expect(detectFontFromName("CourierNewPSMT")).toMatchObject({ family: "courier" });
    expect(detectFontFromName("Times-Italic")).toEqual({
      family: "times",
      bold: false,
      italic: true,
    });
  });
  it("does not treat a sans face as times", () => {
    expect(detectFontFromName("PTSans-Roman").family).toBe("helvetica");
  });
  it("defaults unknown faces to helvetica", () => {
    expect(detectFontFromName("SomeUnknownFace")).toEqual({
      family: "helvetica",
      bold: false,
      italic: false,
    });
  });
});

// --- collectLine ------------------------------------------------------------

describe("collectLine", () => {
  it("returns the contiguous run cluster on the hit's baseline, ordered left→right", () => {
    const a = obj({ index: 1, text: "The", left: 0, right: 20, bottom: 100, top: 112, fontSize: 12 });
    const b = obj({ index: 2, text: "quick", left: 24, right: 60, bottom: 100, top: 112, fontSize: 12 });
    const c = obj({ index: 3, text: "fox", left: 64, right: 90, bottom: 100, top: 112, fontSize: 12 });
    // A run on a different line — must be excluded.
    const other = obj({ index: 4, text: "next", left: 0, right: 30, bottom: 60, top: 72, fontSize: 12 });
    const line = collectLine([other, c, a, b], b);
    expect(line.map((o) => o.text)).toEqual(["The", "quick", "fox"]);
  });

  it("stops at a wide horizontal gap (a separate column)", () => {
    const a = obj({ index: 1, text: "left", left: 0, right: 30, bottom: 100, top: 112, fontSize: 12 });
    const far = obj({ index: 2, text: "col2", left: 400, right: 430, bottom: 100, top: 112, fontSize: 12 });
    expect(collectLine([a, far], a).map((o) => o.text)).toEqual(["left"]);
  });
});

// --- mapLineEditToRuns ------------------------------------------------------

describe("mapLineEditToRuns", () => {
  const twoRuns = () =>
    edit("hello world", [
      run({ objectIndex: 0, text: "hello", start: 0, sep: " " }),
      run({ objectIndex: 1, text: "world", start: 6, sep: "" }),
    ]);

  it("returns index-only edits when nothing changed (preserves every run)", () => {
    expect(mapLineEditToRuns(twoRuns(), "hello world")).toEqual([
      { objectIndex: 0 },
      { objectIndex: 1 },
    ]);
  });

  it("routes an in-run edit to only that run", () => {
    expect(mapLineEditToRuns(twoRuns(), "hello WORLD")).toEqual([
      { objectIndex: 0 },
      { objectIndex: 1, text: "WORLD" },
    ]);
  });

  it("collapses a cross-run edit into the first run and blanks the rest", () => {
    const out = mapLineEditToRuns(twoRuns(), "hey");
    expect(out[0]).toEqual({ objectIndex: 0, text: "hey" });
    expect(out[1]).toEqual({ objectIndex: 1, text: "" });
  });
});

// --- resolveTextFont --------------------------------------------------------

describe("resolveTextFont", () => {
  it("resolves standard-14 families to their PDF name without fetching", async () => {
    expect(await resolveTextFont("helvetica", false, false)).toEqual({ standardName: "Helvetica" });
    expect(await resolveTextFont("helvetica", true, false)).toEqual({ standardName: "Helvetica-Bold" });
    expect(await resolveTextFont("times", true, true)).toEqual({ standardName: "Times-BoldItalic" });
  });

  it("substitutes an unknown family with a metric-compatible standard face", async () => {
    expect(await resolveTextFont("nonesuch", false, false)).toEqual({ standardName: "Helvetica" });
  });
});

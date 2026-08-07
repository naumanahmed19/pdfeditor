import { describe, it, expect } from "vitest";
import {
  styleKey,
  familyRoot,
  typefaceRoot,
  faceStyleDistance,
  detectFontFromName,
  collectLine,
  columnAwareTextWidth,
  mapLineEditToRuns,
  resolveTextFont,
  trustedStandardFont,
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
  return {
    objectIndex: 0,
    text: "",
    start: 0,
    sep: "",
    originX: 0,
    originY: 0,
    fontName: "F",
    fontSize: 10,
    color: [0, 0, 0, 255],
    ...p,
  };
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

// --- typefaceRoot -----------------------------------------------------------

describe("typefaceRoot", () => {
  it("unifies every width/weight cut of one typeface", () => {
    expect(typefaceRoot("HQMWAZ+UniversLTStd-LightUltraCn")).toBe("univers");
    expect(typefaceRoot("UniversLTStd-Cn")).toBe("univers");
    expect(typefaceRoot("Univers67CondensedBold")).toBe("univers");
    expect(typefaceRoot("ASJHEU+UniversLTStd-LightCnObl")).toBe("univers");
  });
  it("keeps distinct typefaces apart", () => {
    expect(typefaceRoot("Helvetica-Bold")).not.toBe(typefaceRoot("Arial-Bold"));
    expect(typefaceRoot("OpenSans-Italic")).toBe("opensans");
  });
  it("refuses names that are nothing but style tokens", () => {
    expect(typefaceRoot("Bold")).toBe("");
    expect(typefaceRoot("")).toBe("");
  });
});

// --- faceStyleDistance -------------------------------------------------------

describe("faceStyleDistance", () => {
  const target = "UniversLTStd-LightUltraCn"; // light, condensed, upright
  it("prefers the same-width upright cut over bold or oblique ones", () => {
    const cn = faceStyleDistance("UniversLTStd-Cn", target, false, false);
    const bold = faceStyleDistance("Univers67CondensedBold", target, false, false);
    const obl = faceStyleDistance("UniversLTStd-LightCnObl", target, false, false);
    expect(cn).toBeLessThan(bold);
    expect(cn).toBeLessThan(obl);
  });
  it("prefers a real bold cut when bold is wanted", () => {
    const bold = faceStyleDistance("Univers67CondensedBold", target, true, false);
    const light = faceStyleDistance("UniversLTStd-Cn", target, true, false);
    expect(bold).toBeLessThan(light);
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

  it("does not join a narrow publication gutter at the same baseline", () => {
    const left = obj({
      index: 1,
      text: "In addition to economic effects, climate change will",
      left: 72,
      right: 302,
      bottom: 100,
      top: 110.2,
      fontSize: 10.2,
    });
    const rightA = obj({
      index: 2,
      text: "the",
      left: 317,
      right: 332,
      bottom: 100,
      top: 110.2,
      fontSize: 10.2,
    });
    const rightB = obj({
      index: 3,
      text: "cold. Overall mortality is projected to increase",
      left: 336,
      right: 548,
      bottom: 100,
      top: 110.2,
      fontSize: 10.2,
    });

    expect(collectLine([left, rightA, rightB], left).map((o) => o.text)).toEqual([
      left.text,
    ]);
    expect(collectLine([left, rightA, rightB], rightA).map((o) => o.text)).toEqual([
      rightA.text,
      rightB.text,
    ]);
  });
});

describe("columnAwareTextWidth", () => {
  const selected = { left: 100, top: 100, right: 260, bottom: 120 };

  it("stops at the nearest text obstacle in the same row", () => {
    expect(
      columnAwareTextWidth(selected, 800, [
        { left: 300, top: 100, right: 450, bottom: 120 },
      ]),
    ).toBe(196);
  });

  it("ignores text above and below the selected row", () => {
    expect(
      columnAwareTextWidth(selected, 800, [
        { left: 300, top: 40, right: 450, bottom: 60 },
        { left: 280, top: 150, right: 430, bottom: 170 },
      ]),
    ).toBe(696);
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

  it("removes stale fragments while preserving contiguous style groups", () => {
    const runs = Array.from("Bajarunaite").map((text, i) =>
      run({
        objectIndex: i,
        text,
        start: i,
        fontName: i < 3 ? "Arial-BoldMT" : "ArialMT",
      }),
    );
    const fragmented = edit("Bajarunaite", runs);

    expect(mapLineEditToRuns(fragmented, "B tenant")).toEqual([
      { objectIndex: 0, text: "B " },
      { objectIndex: 1, text: "" },
      { objectIndex: 2, text: "" },
      { objectIndex: 3, text: "tenant" },
      ...runs.slice(4).map((r) => ({ objectIndex: r.objectIndex, text: "" })),
    ]);
  });

  it("still collapses a uniformly styled fragmented line into one object", () => {
    const runs = Array.from("fragmented").map((text, i) =>
      run({ objectIndex: i, text, start: i, fontName: "ArialMT" }),
    );
    expect(mapLineEditToRuns(edit("fragmented", runs), "replacement")).toEqual(
      runs.map((r, i) => ({
        objectIndex: r.objectIndex,
        text: i === 0 ? "replacement" : "",
      })),
    );
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

describe("trustedStandardFont", () => {
  it("trusts non-subset standard faces with Latin text", () => {
    expect(trustedStandardFont("Helvetica", ["x", "Z", "é"])).toBe(true);
    expect(trustedStandardFont("Helvetica-Bold", ["q"])).toBe(true);
    expect(trustedStandardFont("Times New Roman", ["x"])).toBe(true);
    expect(trustedStandardFont("Courier-Oblique", ["#"])).toBe(true);
    expect(trustedStandardFont("Arial,Bold", ["w"])).toBe(true);
  });

  it("never trusts subset fonts, even standard-named ones", () => {
    expect(trustedStandardFont("ABCDEF+Helvetica", ["x"])).toBe(false);
  });

  it("does not trust unknown or symbol faces", () => {
    expect(trustedStandardFont("Lato-Regular", ["x"])).toBe(false);
    expect(trustedStandardFont("Symbol", ["x"])).toBe(false);
  });

  it("does not vouch for characters outside Latin coverage", () => {
    expect(trustedStandardFont("Helvetica", ["日"])).toBe(false);
    expect(trustedStandardFont("Helvetica", ["x", "→"])).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildLines,
  domPosition,
  fixDegenerateBoxes,
  lineRangeAt,
  resolveCaret,
  segmentChars,
  wordRangeAt,
  type CharBox,
  type LayerRun,
  type SegChar,
} from "./textselect";

// --- helpers -----------------------------------------------------------------

/** Chars laid out left→right on one baseline: 8pt wide, 10pt tall at (x0, y). */
function rowChars(text: string, x0: number, y: number, cw = 8, h = 10): SegChar[] {
  return Array.from(text).map((s, i) => ({ s, x: x0 + i * cw, y, w: cw, h }));
}

/** Evenly split char boxes for a fabricated layer run. */
function evenChars(text: string, x: number, y: number, w: number, h: number): CharBox[] {
  const cw = w / Math.max(1, text.length);
  return Array.from(text).map((_, i) => ({ x: x + i * cw, y, w: cw, h }));
}

function layerRun(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  block = 0,
): LayerRun {
  return {
    span: document.createElement("span"),
    text,
    chars: evenChars(text, x, y, w, h),
    rect: { x, y, w, h },
    block,
  };
}

// --- segmentation ------------------------------------------------------------

describe("segmentChars", () => {
  it("keeps a line together and splits on PDFium line markers", () => {
    const a = rowChars("Hello", 0, 100);
    const b = rowChars("world", 0, 86);
    b[0].br = true; // \r\n marker preceded this char
    const runs = segmentChars([...a, ...b]);
    expect(runs.map((r) => r.map((c) => c.s).join(""))).toEqual(["Hello", "world"]);
  });

  it("splits on a vertical band change even without a marker", () => {
    const runs = segmentChars([...rowChars("abc", 0, 100), ...rowChars("def", 0, 80)]);
    expect(runs).toHaveLength(2);
  });

  it("splits on a column-sized horizontal gap but not on word spacing", () => {
    // Word gap of 4pt (half a char) stays; 30pt gap (3× height) breaks.
    const line = [...rowChars("ab", 0, 100), ...rowChars("cd", 20, 100), ...rowChars("ef", 70, 100)];
    const runs = segmentChars(line);
    expect(runs.map((r) => r.map((c) => c.s).join(""))).toEqual(["abcd", "ef"]);
  });

  it("keeps RTL progression (descending x) in one run", () => {
    const rtl: SegChar[] = Array.from("שלום").map((s, i) => ({
      s,
      x: 100 - i * 8,
      y: 50,
      w: 8,
      h: 10,
    }));
    expect(segmentChars(rtl)).toHaveLength(1);
  });

  it("keeps floating quote marks with their line via the center-in-band rescue", () => {
    // x-height glyphs span y 100..105; the apostrophe's tight box floats above
    // them (y 106..110) but its center is inside the accumulated band once a
    // taller ascender (y 100..112) has widened it.
    const chars: SegChar[] = [
      { s: "d", x: 0, y: 100, w: 8, h: 12 },
      { s: "o", x: 8, y: 100, w: 8, h: 5 },
      { s: "n", x: 16, y: 100, w: 8, h: 5 },
      { s: "'", x: 24, y: 106, w: 3, h: 4 },
      { s: "t", x: 27, y: 100, w: 8, h: 10 },
    ];
    expect(segmentChars(chars)).toHaveLength(1);
  });
});

describe("fixDegenerateBoxes", () => {
  it("stretches a generated space across the word gap", () => {
    const chars: SegChar[] = [
      { s: "a", x: 0, y: 0, w: 8, h: 10 },
      { s: " ", x: 0, y: 0, w: 0, h: 0 }, // PDFium generated space: no box
      { s: "b", x: 12, y: 0, w: 8, h: 10 },
    ];
    fixDegenerateBoxes(chars);
    expect(chars[1]).toMatchObject({ x: 8, w: 4, y: 0, h: 10 });
  });

  it("gives a trailing degenerate char a nominal box after its neighbor", () => {
    const chars: SegChar[] = [
      { s: "a", x: 0, y: 0, w: 8, h: 10 },
      { s: " ", x: 0, y: 0, w: 0, h: 0 },
    ];
    fixDegenerateBoxes(chars);
    expect(chars[1].x).toBe(8);
    expect(chars[1].w).toBeGreaterThan(0);
    expect(chars[1].h).toBe(10);
  });
});

// --- line grouping -----------------------------------------------------------

describe("buildLines", () => {
  it("merges same-band runs and keeps bands apart", () => {
    const lines = buildLines([
      layerRun("Hello", 0, 100, 40, 10),
      layerRun("world", 50, 100, 40, 10),
      layerRun("below", 0, 120, 40, 10),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].runs.map((r) => r.text)).toEqual(["Hello", "world"]);
  });

  it("never merges runs across XY-cut blocks (columns)", () => {
    const lines = buildLines([
      layerRun("left", 0, 100, 40, 10, 0),
      layerRun("right", 200, 100, 40, 10, 1),
    ]);
    expect(lines).toHaveLength(2);
  });
});

// --- caret resolution ----------------------------------------------------------

/** Two-column page: each column two lines of 10 chars, 80px wide.
 *  Left col x 0..80, right col x 140..220; lines at y 100 and y 114. */
function twoColumns() {
  return buildLines([
    layerRun("aaaaaaaaaa", 0, 100, 80, 10, 0),
    layerRun("bbbbbbbbbb", 0, 114, 80, 10, 0),
    layerRun("cccccccccc", 140, 100, 80, 10, 1),
    layerRun("dddddddddd", 140, 114, 80, 10, 1),
  ]);
}

describe("resolveCaret", () => {
  it("snaps a slightly-high cursor back onto the line under it", () => {
    const lines = twoColumns();
    // 4px above line 0, mid-column: must stay on line 0, not drift anywhere.
    const c = resolveCaret(lines, 40, 96)!;
    expect(c.line).toBe(0);
  });

  it("stays between two lines on the nearer one", () => {
    const lines = twoColumns();
    // Lines end at y=110 and start at y=114; y=113 is nearer line 1.
    expect(resolveCaret(lines, 40, 113)!.line).toBe(1);
    expect(resolveCaret(lines, 40, 111)!.line).toBe(0);
  });

  it("does not jump to same-row text in the next column", () => {
    const lines = twoColumns();
    // Slightly below line 0 of the LEFT column; same-row right-column line
    // has dy 0 but is 60px away horizontally — left column must win.
    const c = resolveCaret(lines, 40, 112)!;
    expect(lines[c.line].runs[0].text[0]).not.toBe("c");
  });

  it("picks the right column once the cursor is in its gutter half", () => {
    const lines = twoColumns();
    const c = resolveCaret(lines, 138, 105)!;
    expect(lines[c.line].runs[0].text[0]).toBe("c");
  });

  it("clamps beyond the line ends to first/last boundary", () => {
    const lines = twoColumns();
    expect(resolveCaret(lines, -50, 105)!.offset).toBe(0);
    // Past the left line's end but still nearer to it than to the right
    // column (which starts at x=140).
    const end = resolveCaret(lines, 100, 105)!;
    expect(lines[end.line].runs[end.run].text[0]).toBe("a");
    expect(end.offset).toBe(10);
  });

  it("picks the nearest character boundary inside a run", () => {
    const lines = twoColumns(); // 8px per char
    expect(resolveCaret(lines, 17, 105)!.offset).toBe(2); // past center of char 2
    expect(resolveCaret(lines, 19, 105)!.offset).toBe(2);
    expect(resolveCaret(lines, 21, 105)!.offset).toBe(3);
  });

  it("returns null for an empty layer", () => {
    expect(resolveCaret([], 10, 10)).toBeNull();
  });
});

// --- word / line ranges --------------------------------------------------------

describe("wordRangeAt / lineRangeAt", () => {
  it("expands a word across run boundaries within the line", () => {
    // "hel" + "lo world" split across two runs of the same line.
    const lines = buildLines([
      layerRun("hel", 0, 100, 24, 10),
      layerRun("lo world", 24, 100, 64, 10),
    ]);
    const range = wordRangeAt(lines, { line: 0, run: 1, offset: 1 });
    expect(range.start).toEqual({ line: 0, run: 0, offset: 0 });
    expect(range.end).toEqual({ line: 0, run: 1, offset: 2 });
  });

  it("selects a whitespace stretch when double-clicking between words", () => {
    const lines = buildLines([layerRun("a  b", 0, 100, 32, 10)]);
    const range = wordRangeAt(lines, { line: 0, run: 0, offset: 2 });
    expect(range.start.offset).toBe(1);
    expect(range.end.offset).toBe(3);
  });

  it("lineRangeAt covers the whole visual line", () => {
    const lines = buildLines([
      layerRun("left", 0, 100, 32, 10),
      layerRun("right", 40, 100, 40, 10),
    ]);
    const range = lineRangeAt(lines, 0);
    expect(range.start).toEqual({ line: 0, run: 0, offset: 0 });
    expect(range.end).toEqual({ line: 0, run: 1, offset: 5 });
  });
});

// --- DOM position mapping ------------------------------------------------------

describe("domPosition", () => {
  it("maps offsets through search-mark sub-spans", () => {
    const span = document.createElement("span");
    // Simulates the search-highlight rewrite: "he<mark>llo</mark> world"
    span.appendChild(document.createTextNode("he"));
    const mark = document.createElement("span");
    mark.className = "search-mark";
    mark.textContent = "llo";
    span.appendChild(mark);
    span.appendChild(document.createTextNode(" world"));

    const p1 = domPosition(span, 1);
    expect((p1.node as Text).data).toBe("he");
    expect(p1.offset).toBe(1);

    const p2 = domPosition(span, 4); // inside the mark
    expect((p2.node as Text).data).toBe("llo");
    expect(p2.offset).toBe(2);

    const p3 = domPosition(span, 11); // very end
    expect((p3.node as Text).data).toBe(" world");
    expect(p3.offset).toBe(6);
  });

  it("falls back to the span itself when empty", () => {
    const span = document.createElement("span");
    expect(domPosition(span, 0)).toEqual({ node: span, offset: 0 });
  });
});

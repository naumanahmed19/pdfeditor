import { describe, expect, it } from "vitest";
import {
  joinSoftBreaks,
  planReflow,
  reflowWouldOverlap,
  wrapText,
} from "./reflow";

// Character-count measure: 10pt per character, spaces included — predictable
// break points without real font metrics.
const measure = (s: string) => s.length * 10;

describe("joinSoftBreaks", () => {
  it("joins lines with single spaces", () => {
    expect(joinSoftBreaks(["one two", "three"])).toBe("one two three");
  });

  it("keeps an end-of-line hyphen but adds no space after it", () => {
    expect(joinSoftBreaks(["under-", "stand me"])).toBe("under-stand me");
  });

  it("trims edge whitespace and drops blank lines", () => {
    expect(joinSoftBreaks(["  one ", "", "  two"])).toBe("one two");
  });

  it("preserves interior double spaces", () => {
    expect(joinSoftBreaks(["a  b", "c"])).toBe("a  b c");
  });
});

describe("wrapText", () => {
  it("packs words greedily to the width", () => {
    // 20 chars max → "aaa bbb" (7) + " ccc" = 11… fits; adding "ddd" = 15 fits.
    expect(wrapText("aaa bbb ccc ddd", 150, measure)).toEqual(["aaa bbb ccc ddd"]);
    expect(wrapText("aaa bbb ccc ddd", 70, measure)).toEqual(["aaa bbb", "ccc ddd"]);
  });

  it("hard-wraps an oversized unspaced token to the available width", () => {
    const lines = wrapText("hi incomprehensibilities yo", 100, measure);
    expect(lines).toEqual(["hi", "incomprehe", "nsibilitie", "s yo"]);
    expect(lines.every((line) => measure(line) <= 100 * 1.015)).toBe(true);
  });

  it("preserves every character while wrapping a long URL", () => {
    const url = "https://example.com/a/very/long/unbroken/path";
    const lines = wrapText(url, 90, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(url);
    expect(lines.every((line) => measure(line) <= 90 * 1.015)).toBe(true);
  });

  it("returns no lines for whitespace-only text", () => {
    expect(wrapText("   ", 100, measure)).toEqual([]);
  });

  it("tolerates a hair of overflow (metric drift)", () => {
    // "aaaa bbbb" = 9 chars = 90pt; width 89 is within the 1.5% tolerance of 90.
    expect(wrapText("aaaa bbbb", 89, measure)).toEqual(["aaaa bbbb"]);
  });
});

describe("reflowWouldOverlap", () => {
  const lines = [{ text: "wrapped line", originX: 10, originY: 80 }];

  it("detects page text intersecting a newly added line", () => {
    expect(
      reflowWouldOverlap(lines, 10, measure, [
        { left: 20, right: 70, bottom: 78, top: 86 },
      ]),
    ).toBe(true);
  });

  it("detects overlap on a rewritten existing line, not only appended lines", () => {
    expect(
      reflowWouldOverlap(
        [{ text: "expanded existing row", originX: 10, originY: 80 }],
        10,
        measure,
        [{ left: 130, right: 210, bottom: 78, top: 86 }],
      ),
    ).toBe(true);
  });

  it("ignores content outside the line's horizontal or vertical bounds", () => {
    expect(
      reflowWouldOverlap(lines, 10, measure, [
        { left: 140, right: 180, bottom: 78, top: 86 },
        { left: 20, right: 70, bottom: 55, top: 65 },
      ]),
    ).toBe(false);
  });
});

describe("planReflow", () => {
  const oldLines = ["the quick brown", "fox jumps over", "the lazy dog"];
  const width = 150; // 15 chars per line under the char measure

  it("returns null when nothing structural changed and no line overflows", () => {
    const edited = ["the quick brown", "fox jumps over", "the lazy cat"];
    expect(planReflow(oldLines, edited, width, measure)).toBeNull();
  });

  it("ignores UNCHANGED lines that measure wide (document's own layout)", () => {
    // Original lines measure exactly at width; shrink width so they'd all
    // "overflow" — untouched lines must not trigger a rewrap.
    expect(planReflow(oldLines, [...oldLines], 100, measure)).toBeNull();
  });

  it("rewraps unchanged text when the user explicitly resizes its column", () => {
    expect(planReflow(oldLines, [...oldLines], 100, measure, true)).toEqual([
      "the quick",
      "brown fox",
      "jumps over",
      "the lazy",
      "dog",
    ]);
  });

  it("rewraps from the first changed line when an insert overflows", () => {
    const edited = ["the quick brown", "fox jumps right over", "the lazy dog"];
    expect(planReflow(oldLines, edited, width, measure)).toEqual([
      "the quick brown",
      "fox jumps right",
      "over the lazy",
      "dog",
    ]);
  });

  it("keeps lines above the change verbatim", () => {
    const edited = ["the quick brown", "fox jumps over", "the lazy dog and cat"];
    const plan = planReflow(oldLines, edited, width, measure);
    expect(plan?.slice(0, 2)).toEqual(["the quick brown", "fox jumps over"]);
    expect(plan?.length).toBeGreaterThan(3);
  });

  it("shrinks the paragraph when text is deleted across lines", () => {
    const edited = ["the quick brown", "fox", "dog"];
    expect(planReflow(oldLines, edited, width, measure)).toEqual([
      "the quick brown",
      "fox dog",
    ]);
  });

  it("rewraps a Shift+Enter combined with new text", () => {
    const edited = ["the quick brown", "fox jumps swiftly", "over", "the lazy dog"];
    expect(planReflow(oldLines, edited, width, measure)).toEqual([
      "the quick brown",
      "fox jumps",
      "swiftly over",
      "the lazy dog",
    ]);
  });

  it("returns null for a bare Shift+Enter (soft break, no content change)", () => {
    // Splitting a line without typing anything: the wrap re-joins the words
    // and settles back into the document's own layout — nothing to write.
    const edited = ["the quick", "brown", "fox jumps over", "the lazy dog"];
    expect(planReflow(oldLines, edited, width, measure)).toBeNull();
  });

  it("pulls text up when a deletion leaves room for the next word", () => {
    const edited = ["the quick brown", "fox jumps over", "the dog"];
    // "the dog" is the LAST line — short final lines are normal, no reflow.
    expect(planReflow(oldLines, edited, width, measure)).toBeNull();
  });

  it("handles a single-line paragraph growing to several lines", () => {
    const plan = planReflow(
      ["short line"],
      ["short line with much much more text"],
      width,
      measure,
    );
    expect(plan).toEqual(["short line with", "much much more", "text"]);
  });

  it("re-joins a hyphenated soft break without a space", () => {
    const plan = planReflow(
      ["some under-", "stand text here"],
      ["some x under-", "stand text here"],
      120,
      measure,
    );
    expect(plan?.join(" ")).toContain("under-stand");
  });
});

// Pure parts of the Create-PDF pipeline: text→blocks parsing, run
// normalization, WinAnsi sanitizing, greedy line wrap and pagination math.
// All measurement goes through a fake monospace MeasureFn so no fonts (or
// DOM) are needed — the jsdom-dependent HTML parser is tested separately.
import { describe, expect, it } from "vitest";
import {
  BLOCK_STYLES,
  LIST_INDENT,
  layoutBlocks,
  normalizeRuns,
  sanitizeWinAnsi,
  textToBlocks,
  wrapRuns,
  type Block,
  type MeasureFn,
} from "./createpdf";

/** 10 units per character, regardless of style or size. */
const mono10: MeasureFn = (text) => text.length * 10;

describe("textToBlocks", () => {
  it("turns each non-blank line into a paragraph", () => {
    expect(textToBlocks("one\ntwo")).toEqual([
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "paragraph", runs: [{ text: "two" }] },
    ]);
  });

  it("collapses blank lines into a single spacer block", () => {
    const blocks = textToBlocks("one\n\n\n\ntwo");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocks[1].runs).toEqual([]);
  });

  it("ignores leading and trailing blank lines", () => {
    const blocks = textToBlocks("\n\nonly\n\n");
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "only" }] }]);
  });

  it("recognizes markdown-ish headings up to level 3", () => {
    expect(textToBlocks("# A\n## B\n### C").map((b) => b.kind)).toEqual(["h1", "h2", "h3"]);
    // #### is not a supported heading — stays a paragraph verbatim.
    expect(textToBlocks("#### D")[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "#### D" }],
    });
  });

  it("recognizes bullets and ordered items", () => {
    expect(textToBlocks("- a\n* b\n2. c\n3) d")).toEqual([
      { kind: "li", runs: [{ text: "a" }] },
      { kind: "li", runs: [{ text: "b" }] },
      { kind: "li", runs: [{ text: "c" }], ordinal: 2 },
      { kind: "li", runs: [{ text: "d" }], ordinal: 3 },
    ]);
  });

  it("handles CRLF and lone CR line endings", () => {
    expect(textToBlocks("a\r\nb\rc").length).toBe(3);
  });
});

describe("normalizeRuns", () => {
  it("collapses whitespace and trims the block edges", () => {
    expect(normalizeRuns([{ text: "  hello \n  world  " }])).toEqual([
      { text: "hello world" },
    ]);
  });

  it("merges adjacent same-style runs and keeps style boundaries", () => {
    expect(
      normalizeRuns([
        { text: "a " },
        { text: "b", bold: true },
        { text: " c", bold: true },
        { text: " d" },
      ]),
    ).toEqual([{ text: "a " }, { text: "b c", bold: true }, { text: " d" }]);
  });

  it("drops runs that collapse to nothing", () => {
    expect(normalizeRuns([{ text: "" }, { text: "   " }, { text: "x" }])).toEqual([
      { text: "x" },
    ]);
    expect(normalizeRuns([{ text: "  " }, { text: " \n " }])).toEqual([]);
  });
});

describe("sanitizeWinAnsi", () => {
  it("keeps Latin-1 and CP1252 typographic characters", () => {
    const text = "héllo — “quoted” • …";
    expect(sanitizeWinAnsi(text)).toBe(text);
  });

  it("replaces unencodable characters with question marks", () => {
    expect(sanitizeWinAnsi("a→b")).toBe("a?b");
    // Astral chars are surrogate pairs — both halves get replaced.
    expect(sanitizeWinAnsi("😀")).toBe("??");
  });

  it("expands tabs to spaces", () => {
    expect(sanitizeWinAnsi("a\tb")).toBe("a  b");
  });
});

describe("wrapRuns", () => {
  it("wraps greedily at the max width", () => {
    // words 30 wide, space 10: "aaa bbb" = 70 fits in 75, "ccc" wraps.
    const lines = wrapRuns([{ text: "aaa bbb ccc" }], 75, 12, mono10);
    expect(lines).toEqual([[{ text: "aaa bbb" }], [{ text: "ccc" }]]);
  });

  it("keeps style boundaries as separate runs with a joining space", () => {
    const lines = wrapRuns([{ text: "plain " }, { text: "bold", bold: true }], 1000, 12, mono10);
    expect(lines).toEqual([[{ text: "plain" }, { text: " bold", bold: true }]]);
  });

  it("does not insert a space when a style change splits a word", () => {
    const lines = wrapRuns([{ text: "foo" }, { text: "bar", bold: true }], 1000, 12, mono10);
    expect(lines).toEqual([[{ text: "foo" }, { text: "bar", bold: true }]]);
  });

  it("character-splits words wider than the line", () => {
    const lines = wrapRuns([{ text: "abcdefghij" }], 35, 12, mono10);
    expect(lines).toEqual([
      [{ text: "abc" }],
      [{ text: "def" }],
      [{ text: "ghi" }],
      [{ text: "j" }],
    ]);
  });

  it("returns no lines for whitespace-only input", () => {
    expect(wrapRuns([{ text: "   " }], 100, 12, mono10)).toEqual([]);
  });
});

describe("layoutBlocks", () => {
  // Tiny page: content box is 180 wide, baselines must stay at or above 90.
  const opts = { pageWidth: 200, pageHeight: 100, margin: 10 };
  const para = (text: string): Block => ({ kind: "paragraph", runs: [{ text }] });

  it("flows paragraphs down the page and breaks at the bottom margin", () => {
    // paragraph: lineHeight 16, spaceAfter 8 → baselines 26, 50, 74, then 98
    // would cross maxY 90 → new page at 26.
    const placed = layoutBlocks([para("a"), para("b"), para("c"), para("d")], opts, mono10);
    expect(placed.map((l) => [l.page, l.y])).toEqual([
      [0, 26],
      [0, 50],
      [0, 74],
      [1, 26],
    ]);
  });

  it("wraps within a block and paginates mid-block", () => {
    // Each 17-char word is 170 wide (line box is 180), so every word gets its
    // own line. Baselines 26..90 — five lines fit exactly (a baseline ON the
    // bottom margin is allowed), the sixth breaks to page 1.
    const word = "a".repeat(17);
    const placed = layoutBlocks([para(Array(6).fill(word).join(" "))], opts, mono10);
    expect(placed.map((l) => [l.page, l.y])).toEqual([
      [0, 26],
      [0, 42],
      [0, 58],
      [0, 74],
      [0, 90],
      [1, 26],
    ]);
  });

  it("applies heading spacing and bakes heading boldness into runs", () => {
    const placed = layoutBlocks(
      [
        { kind: "h1", runs: [{ text: "Title" }] },
        para("body"),
      ],
      { pageWidth: 400, pageHeight: 400, margin: 10 },
      mono10,
    );
    // h1 at top of page: no spaceBefore, baseline = 10 + 30.
    expect(placed[0].y).toBe(10 + BLOCK_STYLES.h1.lineHeight);
    expect(placed[0].runs).toEqual([{ text: "Title", bold: true }]);
    expect(placed[0].size).toBe(24);
    // body follows after h1's spaceAfter.
    expect(placed[1].y).toBe(placed[0].y + BLOCK_STYLES.h1.spaceAfter + BLOCK_STYLES.paragraph.lineHeight);
    expect(placed[1].runs).toEqual([{ text: "body" }]);
  });

  it("emits a marker line for list items at the same baseline", () => {
    const placed = layoutBlocks(
      [
        { kind: "li", runs: [{ text: "first" }] },
        { kind: "li", runs: [{ text: "second" }], ordinal: 2 },
      ],
      { pageWidth: 400, pageHeight: 400, margin: 10 },
      mono10,
    );
    expect(placed).toHaveLength(4);
    const [m1, t1, m2, t2] = placed;
    expect(m1.runs).toEqual([{ text: "•" }]);
    expect(m1.x).toBe(10);
    expect(t1.x).toBe(10 + LIST_INDENT);
    expect(m1.y).toBe(t1.y);
    expect(m2.runs).toEqual([{ text: "2." }]);
    expect(m2.y).toBe(t2.y);
  });

  it("renders blank spacer blocks as vertical space, not lines", () => {
    const spaced = layoutBlocks([para("a"), { kind: "paragraph", runs: [] }, para("b")], opts, mono10);
    const tight = layoutBlocks([para("a"), para("b")], opts, mono10);
    expect(spaced).toHaveLength(2);
    expect(spaced[1].y - tight[1].y).toBe(BLOCK_STYLES.paragraph.lineHeight);
  });

  it("skips spacer blocks at the top of the document", () => {
    const placed = layoutBlocks([{ kind: "paragraph", runs: [] }, para("a")], opts, mono10);
    expect(placed[0].y).toBe(26);
  });
});

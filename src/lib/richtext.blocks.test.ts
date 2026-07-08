// @vitest-environment jsdom
// Verifies the block conversion pipeline: run→block derivation, parsing the
// editor's semantic HTML into blocks, the blocks→HTML→blocks round-trip, and
// nested list numbering. These are the pieces that turn on-screen structure
// into the model the PDF bake consumes.
import { describe, expect, it } from "vitest";
import {
  applyBlockOp,
  blocksToSemanticHtml,
  computeMarkers,
  getBlocks,
  parseEditorBlocks,
  runsText,
} from "./richtext";
import type { TextAnnotation, TextBlock } from "../types";

const ann: TextAnnotation = {
  id: "t",
  kind: "text",
  x: 0,
  y: 0,
  w: 200,
  h: 50,
  text: "",
  fontSize: 14,
  color: "#000000",
};

const summary = (blocks: TextBlock[]) =>
  blocks.map((b) => ({ kind: b.kind, list: b.list, indent: b.indent ?? 0, text: runsText(b.runs) }));

const parse = (html: string): TextBlock[] => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return parseEditorBlocks(div, ann);
};

describe("block conversion", () => {
  it("derives plain paragraphs from flat runs (splitting on newlines)", () => {
    const blocks = getBlocks({ ...ann, text: "one\ntwo", runs: [{ text: "one\ntwo" }] });
    expect(summary(blocks)).toEqual([
      { kind: "p", list: undefined, indent: 0, text: "one" },
      { kind: "p", list: undefined, indent: 0, text: "two" },
    ]);
  });

  it("parses headings and a flat bullet list from semantic HTML", () => {
    const blocks = parse("<h1>Title</h1><p>Intro</p><ul><li>A</li><li>B</li></ul>");
    expect(summary(blocks)).toEqual([
      { kind: "h1", list: undefined, indent: 0, text: "Title" },
      { kind: "p", list: undefined, indent: 0, text: "Intro" },
      { kind: "li", list: "bullet", indent: 0, text: "A" },
      { kind: "li", list: "bullet", indent: 0, text: "B" },
    ]);
  });

  it("parses nested lists with the right indent levels", () => {
    const blocks = parse(
      "<ol><li>One<ul><li>One-a</li><li>One-b</li></ul></li><li>Two</li></ol>",
    );
    expect(summary(blocks)).toEqual([
      { kind: "li", list: "numbered", indent: 0, text: "One" },
      { kind: "li", list: "bullet", indent: 1, text: "One-a" },
      { kind: "li", list: "bullet", indent: 1, text: "One-b" },
      { kind: "li", list: "numbered", indent: 0, text: "Two" },
    ]);
  });

  it("round-trips blocks → semantic HTML → blocks unchanged", () => {
    const blocks: TextBlock[] = [
      { kind: "h2", runs: [{ text: "Heading" }] },
      { kind: "li", list: "numbered", indent: 0, runs: [{ text: "First" }] },
      { kind: "li", list: "numbered", indent: 1, runs: [{ text: "Nested" }] },
      { kind: "li", list: "bullet", indent: 0, runs: [{ text: "Bullet" }] },
      { kind: "p", runs: [{ text: "Tail" }] },
    ];
    const round = parse(blocksToSemanticHtml(blocks, ann, 1));
    expect(summary(round)).toEqual(summary(blocks));
  });

  it("converts the selected paragraphs to a bullet list WITHOUT losing text", () => {
    const blocks: TextBlock[] = [
      { kind: "p", runs: [{ text: "Line one" }] },
      { kind: "p", runs: [{ text: "Line two" }] },
    ];
    const out = applyBlockOp(blocks, 0, 1, { type: "list", list: "bullet" });
    expect(summary(out)).toEqual([
      { kind: "li", list: "bullet", indent: 0, text: "Line one" },
      { kind: "li", list: "bullet", indent: 0, text: "Line two" },
    ]);
  });

  it("toggles a bullet list back to paragraphs when re-pressed", () => {
    const blocks: TextBlock[] = [
      { kind: "li", list: "bullet", indent: 0, runs: [{ text: "A" }] },
      { kind: "li", list: "bullet", indent: 0, runs: [{ text: "B" }] },
    ];
    const out = applyBlockOp(blocks, 0, 1, { type: "list", list: "bullet" });
    expect(summary(out)).toEqual([
      { kind: "p", list: undefined, indent: 0, text: "A" },
      { kind: "p", list: undefined, indent: 0, text: "B" },
    ]);
  });

  it("only converts blocks inside the selected range", () => {
    const blocks: TextBlock[] = [
      { kind: "p", runs: [{ text: "One" }] },
      { kind: "p", runs: [{ text: "Two" }] },
      { kind: "p", runs: [{ text: "Three" }] },
    ];
    const out = applyBlockOp(blocks, 1, 2, { type: "list", list: "numbered" });
    expect(summary(out)).toEqual([
      { kind: "p", list: undefined, indent: 0, text: "One" },
      { kind: "li", list: "numbered", indent: 0, text: "Two" },
      { kind: "li", list: "numbered", indent: 0, text: "Three" },
    ]);
  });

  it("indents and out-dents list items (out-dent past 0 → paragraph)", () => {
    const li: TextBlock[] = [{ kind: "li", list: "bullet", indent: 0, runs: [{ text: "x" }] }];
    const indented = applyBlockOp(li, 0, 0, { type: "indent", delta: 1 });
    expect(indented[0].indent).toBe(1);
    const back = applyBlockOp(indented, 0, 0, { type: "indent", delta: -1 });
    expect(back[0].indent).toBe(0);
    const toPara = applyBlockOp(back, 0, 0, { type: "indent", delta: -1 });
    expect(toPara[0].kind).toBe("p");
  });

  it("sets and clears headings, preserving runs", () => {
    const blocks: TextBlock[] = [{ kind: "p", runs: [{ text: "Title", bold: true }] }];
    const h = applyBlockOp(blocks, 0, 0, { type: "kind", kind: "h1" });
    expect(h[0].kind).toBe("h1");
    expect(runsText(h[0].runs)).toBe("Title");
    const p = applyBlockOp(h, 0, 0, { type: "kind", kind: "p" });
    expect(p[0].kind).toBe("p");
  });

  it("numbers nested ordered lists, restarting per sublist", () => {
    const markers = computeMarkers([
      { kind: "li", list: "numbered", indent: 0, runs: [{ text: "a" }] },
      { kind: "li", list: "numbered", indent: 1, runs: [{ text: "b" }] },
      { kind: "li", list: "numbered", indent: 1, runs: [{ text: "c" }] },
      { kind: "li", list: "numbered", indent: 0, runs: [{ text: "d" }] },
      { kind: "li", list: "bullet", indent: 0, runs: [{ text: "e" }] },
    ]);
    expect(markers).toEqual(["1.", "1.", "2.", "2.", "•"]);
  });
});

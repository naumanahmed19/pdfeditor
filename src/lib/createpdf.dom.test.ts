// @vitest-environment jsdom
// The DOM half of the Create-PDF pipeline: parsing mammoth-style HTML into
// the block model. Structure and inline styling only — the layout math is
// covered by the node-env suite in createpdf.test.ts.
import { describe, expect, it } from "vitest";
import { htmlToBlocks } from "./createpdf";

describe("htmlToBlocks", () => {
  it("maps headings and paragraphs with inline bold/italic", () => {
    const blocks = htmlToBlocks(
      "<h1>Title</h1><p>Hello <strong>bold</strong> and <em>italic</em>.</p>",
    );
    expect(blocks).toEqual([
      { kind: "h1", runs: [{ text: "Title" }] },
      {
        kind: "paragraph",
        runs: [
          { text: "Hello " },
          { text: "bold", bold: true },
          { text: " and " },
          { text: "italic", italic: true },
          { text: "." },
        ],
      },
    ]);
  });

  it("supports nested styles and b/i synonyms", () => {
    const blocks = htmlToBlocks("<p><b>bold <i>both</i></b></p>");
    expect(blocks[0].runs).toEqual([
      { text: "bold ", bold: true },
      { text: "both", bold: true, italic: true },
    ]);
  });

  it("clamps h4–h6 to h3", () => {
    expect(htmlToBlocks("<h4>x</h4><h6>y</h6>").map((b) => b.kind)).toEqual(["h3", "h3"]);
  });

  it("numbers ordered list items but not bullets", () => {
    const blocks = htmlToBlocks("<ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>");
    expect(blocks).toEqual([
      { kind: "li", runs: [{ text: "a" }] },
      { kind: "li", runs: [{ text: "b" }] },
      { kind: "li", runs: [{ text: "x" }], ordinal: 1 },
      { kind: "li", runs: [{ text: "y" }], ordinal: 2 },
    ]);
  });

  it("flattens nested lists after their parent item", () => {
    const blocks = htmlToBlocks("<ul><li>outer<ol><li>inner</li></ol></li></ul>");
    expect(blocks).toEqual([
      { kind: "li", runs: [{ text: "outer" }] },
      { kind: "li", runs: [{ text: "inner" }], ordinal: 1 },
    ]);
  });

  it("flattens tables to one paragraph per row", () => {
    const blocks = htmlToBlocks(
      "<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apples</td><td>3</td></tr></table>",
    );
    expect(blocks.map((b) => b.runs[0].text)).toEqual(["Name   Qty", "Apples   3"]);
  });

  it("recurses through container elements and collects loose text", () => {
    const blocks = htmlToBlocks("<div><p>inside</p></div>loose <b>text</b>");
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "inside" }] },
      { kind: "paragraph", runs: [{ text: "loose " }, { text: "text", bold: true }] },
    ]);
  });

  it("collapses whitespace and drops empty blocks, images and scripts", () => {
    const blocks = htmlToBlocks(
      "<p>  a\n   b  </p><p>   </p><p><img src='x.png'></p><script>evil()</script>",
    );
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "a b" }] }]);
  });

  it("treats <br> as a space within a paragraph", () => {
    expect(htmlToBlocks("<p>a<br>b</p>")[0].runs).toEqual([{ text: "a b" }]);
  });
});

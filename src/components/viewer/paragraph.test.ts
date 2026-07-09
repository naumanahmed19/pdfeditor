import { describe, expect, it } from "vitest";
import { buildPageLines, collectParagraph } from "./paragraph";
import type { TextObject } from "../../lib/pdfium";

// --- fixtures ------------------------------------------------------------
// Page space: origin bottom-left, y grows upward. A "line" fixture puts one
// run at baseline y with a box `size` tall.

let seq = 0;
function run(
  text: string,
  left: number,
  right: number,
  top: number,
  fontSize = 10,
): TextObject {
  return {
    index: seq++,
    text,
    left,
    right,
    top,
    bottom: top - fontSize,
    fontSize,
    color: [0, 0, 0, 255],
    fontName: "Helvetica",
    originX: left,
    originY: top - fontSize,
  };
}

/** Column of lines with consistent 14pt leading starting at `topY`. */
function para(
  topY: number,
  count: number,
  left = 72,
  right = 300,
  opts: { shortLast?: boolean; indentFirst?: boolean; size?: number } = {},
): TextObject[] {
  const out: TextObject[] = [];
  for (let i = 0; i < count; i++) {
    const first = i === 0 && opts.indentFirst;
    const last = i === count - 1 && opts.shortLast;
    out.push(
      run(
        `line-${topY}-${i}`,
        first ? left + 15 : left,
        last ? left + (right - left) * 0.55 : right,
        topY - i * 14,
        opts.size ?? 10,
      ),
    );
  }
  return out;
}

const texts = (lines: TextObject[][]) => lines.map((l) => l.map((o) => o.text).join(" "));

describe("buildPageLines", () => {
  it("clusters runs into lines and splits columns within a band", () => {
    const objs = [
      run("left-a", 72, 200, 700),
      run("left-b", 205, 300, 700), // small gap — same line
      run("right", 360, 500, 700), // wide gap — other column
      run("below", 72, 300, 686),
    ];
    const lines = buildPageLines(objs);
    expect(lines).toHaveLength(3);
    expect(lines[0].objs.map((o) => o.text)).toEqual(["left-a", "left-b"]);
    expect(lines[1].objs.map((o) => o.text)).toEqual(["right"]);
    expect(lines[2].objs.map((o) => o.text)).toEqual(["below"]);
  });
});

describe("collectParagraph", () => {
  it("collects the full paragraph when clicking a middle line", () => {
    const p = para(700, 4, 72, 300, { shortLast: true });
    const got = collectParagraph(p, p[1]);
    expect(texts(got)).toEqual(p.map((o) => o.text).map((t) => t));
  });

  it("degrades to a single line when nothing around matches", () => {
    const p = para(700, 1);
    expect(collectParagraph(p, p[0])).toHaveLength(1);
  });

  it("does not swallow a heading above the paragraph", () => {
    const heading = run("Heading", 72, 250, 730, 18);
    const p = para(700, 3);
    const got = collectParagraph([heading, ...p], p[0]);
    expect(texts(got)).not.toContain("Heading");
    expect(got).toHaveLength(3);
  });

  it("stops at a paragraph gap (leading jump)", () => {
    const above = para(760, 2, 72, 300, { shortLast: true }); // ends at y 746
    const p = para(700, 3); // 32pt gap — more than 1.35× the 14pt leading
    const got = collectParagraph([...above, ...p], p[1]);
    expect(got).toHaveLength(3);
    expect(texts(got)[0]).toBe(p[0].text);
  });

  it("stops above at the previous paragraph's short final line", () => {
    const above = para(742, 2, 72, 300, { shortLast: true }); // normal leading into p
    const p = para(714, 3);
    const got = collectParagraph([...above, ...p], p[1]);
    expect(texts(got)).not.toContain(above[1].text);
    expect(got).toHaveLength(3);
  });

  it("stops below when the current paragraph's last line is short", () => {
    const p = para(700, 3, 72, 300, { shortLast: true });
    const next = para(658, 2); // normal-ish leading continues
    const got = collectParagraph([...p, ...next], p[0]);
    expect(got).toHaveLength(3);
    expect(texts(got)[2]).toBe(p[2].text);
  });

  it("stops at an indented first line of the next paragraph", () => {
    const p = para(700, 3);
    const next = para(700 - 3 * 14, 2, 72, 300, { indentFirst: true });
    const got = collectParagraph([...p, ...next], p[1]);
    expect(got).toHaveLength(3);
  });

  it("does not extend upward past its own indented first line", () => {
    const above = para(742, 2); // previous paragraph, full-width lines
    const p = para(714, 3, 72, 300, { indentFirst: true });
    const got = collectParagraph([...above, ...p], p[1]);
    expect(got).toHaveLength(3);
    expect(texts(got)[0]).toBe(p[0].text);
  });

  it("never merges across columns", () => {
    const left = para(700, 3, 72, 280);
    const right = para(700, 3, 340, 540);
    const got = collectParagraph([...left, ...right], left[1]);
    expect(got).toHaveLength(3);
    const rightIdx = new Set(right.map((o) => o.index));
    for (const line of got) {
      for (const o of line) expect(rightIdx.has(o.index)).toBe(false);
    }
  });

  it("ignores same-band table cells when walking lines", () => {
    // A two-cell row: clicking the left cell must not pull in the right cell,
    // and with no compatible line above/below it stays a one-line paragraph.
    const cells = [run("cell-a", 72, 150, 700), run("cell-b", 300, 380, 700)];
    const got = collectParagraph(cells, cells[0]);
    expect(texts(got)).toEqual(["cell-a"]);
  });
});

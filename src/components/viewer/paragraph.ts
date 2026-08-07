// Paragraph detection over a page's text objects (PDF page space, origin
// bottom-left, y grows upward). Pure geometry, no DOM — unit-tested.
//
// The edit-text tool historically edited one visual LINE at a time. This
// module finds the whole paragraph around a clicked run so the inline editor
// can show it as one editable block, while commits still map back per line
// (see PageView) — no reflow yet, so detection errs on the conservative
// side: when a rule is unsure it stops extending, and the result degrades
// toward today's single-line behavior.

import type { TextObject } from "../../lib/pdfium";

/** One visual line: a horizontally-contiguous cluster of runs in a band. */
export interface PageLine {
  objs: TextObject[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Dominant (largest) font size on the line. */
  size: number;
}

const width = (l: { left: number; right: number }) => l.right - l.left;

function toLine(objs: TextObject[]): PageLine {
  return {
    objs,
    left: Math.min(...objs.map((o) => o.left)),
    right: Math.max(...objs.map((o) => o.right)),
    top: Math.max(...objs.map((o) => o.top)),
    bottom: Math.min(...objs.map((o) => o.bottom)),
    size: Math.max(...objs.map((o) => o.fontSize)),
  };
}

/**
 * Group a page's runs into visual lines: cluster by vertical band (like
 * collectLine's overlap rule, applied page-wide), then split each band on
 * wide horizontal gaps — a gap is a column gutter or table-cell boundary,
 * so each contiguous cluster is its own line unit. Lines come back sorted
 * top of page → bottom, runs within a line left → right.
 */
export function buildPageLines(objs: TextObject[]): PageLine[] {
  const items = objs
    .filter((o) => o.text.trim())
    .sort((a, b) => b.top - a.top);
  if (!items.length) return [];

  // Vertical bands: a run joins the current band when it overlaps it by more
  // than half the smaller height.
  const bands: TextObject[][] = [];
  let band: TextObject[] = [];
  let b0 = 0; // band bottom
  let b1 = 0; // band top
  for (const o of items) {
    if (band.length) {
      const overlap = Math.min(b1, o.top) - Math.max(b0, o.bottom);
      const minH = Math.min(b1 - b0, o.top - o.bottom);
      if (overlap <= 0.5 * minH) {
        bands.push(band);
        band = [];
      }
    }
    if (!band.length) {
      b0 = o.bottom;
      b1 = o.top;
    } else {
      b0 = Math.min(b0, o.bottom);
      b1 = Math.max(b1, o.top);
    }
    band.push(o);
  }
  if (band.length) bands.push(band);

  // Split bands into contiguous clusters (columns / table cells apart).
  const lines: PageLine[] = [];
  for (const bandObjs of bands) {
    bandObjs.sort((a, b) => a.left - b.left);
    // Match collectLine's conservative run spacing. A 1.5em threshold can
    // merge narrow publication gutters before paragraph column checks ever
    // see separate line units.
    const maxGap = 1.25 * Math.max(...bandObjs.map((o) => o.fontSize), 6);
    let cluster: TextObject[] = [];
    for (const o of bandObjs) {
      if (cluster.length && o.left - cluster[cluster.length - 1].right > maxGap) {
        lines.push(toLine(cluster));
        cluster = [];
      }
      cluster.push(o);
    }
    if (cluster.length) lines.push(toLine(cluster));
  }
  // Bands are top→bottom already; clusters of one band keep that order too.
  return lines;
}

/** Safety cap — a runaway merge should never swallow a whole dense page. */
const MAX_PARA_LINES = 40;

/**
 * The paragraph around `hit`: the clicked visual line plus the lines above
 * and below that read as the same paragraph. Rules per candidate step:
 *  - column: the candidate must overlap the edge line horizontally;
 *  - leading: top-to-top distance must be consistent (first step ≤ ~2× the
 *    font size, later steps within ±35% of the established leading);
 *  - size: dominant font size within 0.8–1.25× of the clicked line's
 *    (headings and footnotes break);
 *  - boundaries: a line that ends visibly short of the column's right edge
 *    is a paragraph's final line; a line starting right of the column's left
 *    edge is an indented first line — both stop the walk.
 * "block" scope collects the whole contiguous text block instead: the
 * boundary signals are ignored and the leading budget is wide enough to
 * cross paragraph spacing — only column, size and genuine gaps still stop it.
 * Returns lines top→bottom, each line's runs left→right.
 */
export function collectParagraph(
  objs: TextObject[],
  hit: TextObject,
  scope: "paragraph" | "block" = "paragraph",
): TextObject[][] {
  const lines = buildPageLines(objs);
  const start = lines.findIndex((l) => l.objs.some((o) => o.index === hit.index));
  if (start < 0) return [[hit]];

  const size = lines[start].size || hit.fontSize || 10;
  const accepted: number[] = [start];
  let leading = 0; // established by the first accepted step

  const extend = (dir: -1 | 1) => {
    for (;;) {
      if (accepted.length >= MAX_PARA_LINES) return;
      const edgeIdx = dir < 0 ? accepted[0] : accepted[accepted.length - 1];
      const edge = lines[edgeIdx];

      // Nearest line in `dir` that shares the column. Same-band clusters
      // (table cells, bullets, the other column at Δ≈0) are skipped; anything
      // vertically farther than the leading budget ends the search.
      let cand: PageLine | null = null;
      let candIdx = -1;
      const maxStep =
        scope === "block"
          ? leading
            ? leading * 2.6
            : size * 3.2
          : leading
            ? leading * 1.35
            : size * 2.1;
      for (let i = edgeIdx + dir; i >= 0 && i < lines.length; i += dir) {
        const l = lines[i];
        const dv = Math.abs(edge.top - l.top);
        if (dv < 0.4 * size) continue; // same band — not a next/prev line
        if (dv > maxStep) break; // gap, heading spacing, or end of column
        const xo = Math.min(edge.right, l.right) - Math.max(edge.left, l.left);
        if (xo < 0.5 * Math.min(width(edge), width(l))) continue; // other column
        cand = l;
        candIdx = i;
        break;
      }
      if (!cand) return;

      // Similar body size (headings/footnotes break the paragraph).
      if (cand.size < 0.8 * size || cand.size > 1.25 * size) return;

      // Paragraph-boundary signals, measured against the column extents the
      // paragraph would have with the candidate included. Block scope reads
      // straight through them.
      if (scope === "paragraph") {
        const colLeft = Math.min(cand.left, ...accepted.map((i) => lines[i].left));
        const colRight = Math.max(cand.right, ...accepted.map((i) => lines[i].right));
        const colW = colRight - colLeft;
        const indent = Math.max(size * 0.9, colW * 0.04);
        const short = (l: PageLine) => colW > size * 8 && l.right < colRight - 0.22 * colW;
        if (dir > 0) {
          // Going down: the current last line being short means the paragraph
          // already ended; an indented candidate starts the next one.
          if (short(edge)) return;
          if (cand.left - colLeft > indent) return;
        } else {
          // Going up: a short candidate is the previous paragraph's final line;
          // an indented current-first-line is this paragraph's own start.
          if (short(cand)) return;
          if (edge.left - colLeft > indent) return;
        }
      }

      if (dir < 0) accepted.unshift(candIdx);
      else accepted.push(candIdx);
      if (!leading) leading = Math.abs(edge.top - cand.top);
    }
  };

  extend(-1);
  extend(1);
  return accepted.map((i) => lines[i].objs);
}

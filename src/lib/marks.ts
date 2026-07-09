/** Vector geometry for check / cross marks, shared by the on-screen SVG
 *  overlay (annotations.tsx) and the PDF baker (pdftools.ts) so both draw the
 *  identical glyph. Endpoints are fractions of the mark's box (0–1, top-left
 *  origin, y increasing downward). */

import type { MarkSymbol } from "../types";

/** Stroke thickness as a fraction of the mark box's smaller side. */
export const MARK_STROKE_FRAC = 0.16;

/** Line segments making up a symbol, as [start, end] fractional-coordinate
 *  pairs. A check is two connected strokes; a cross is two crossing strokes. */
export function markSegments(
  symbol: MarkSymbol,
): Array<[[number, number], [number, number]]> {
  if (symbol === "cross") {
    return [
      [[0.22, 0.22], [0.78, 0.78]],
      [[0.78, 0.22], [0.22, 0.78]],
    ];
  }
  return [
    [[0.16, 0.55], [0.4, 0.8]],
    [[0.4, 0.8], [0.86, 0.2]],
  ];
}

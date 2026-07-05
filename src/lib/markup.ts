import type { MarkupStyle } from "../types";

/** Default ink per markup style (Acrobat-like: green underline, red others). */
export const MARKUP_COLORS: Record<MarkupStyle, string> = {
  underline: "#16a34a",
  strikeout: "#dc2626",
  squiggly: "#dc2626",
};

export const MARKUP_LABEL: Record<MarkupStyle, string> = {
  underline: "Underline",
  strikeout: "Strikethrough",
  squiggly: "Squiggly",
};

/** Zigzag path (SVG `d`) along a horizontal band, used by the squiggly style. */
export function squigglyPath(
  w: number,
  y: number,
  amplitude: number,
  step: number,
): string {
  let d = `M 0 ${y}`;
  let up = true;
  for (let x = step; x <= w + step / 2; x += step) {
    d += ` L ${Math.min(x, w)} ${up ? y - amplitude : y}`;
    up = !up;
  }
  return d;
}

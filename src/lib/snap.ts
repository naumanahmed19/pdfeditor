/**
 * Pure geometry for element snapping (drag/resize alignment guides) and
 * multi-selection align / distribute. Shared by the form builder and the
 * general annotation layer — keep it free of store/react imports.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapOptions {
  /** Snap to other elements' edges/centers and the page center. */
  snap: boolean;
  /** Snap to the grid. */
  grid: boolean;
  gridSize: number;
  /** Max distance (in PDF points) at which a guide attracts. */
  threshold: number;
}

export interface SnapMove {
  x: number;
  y: number;
  /** Vertical guide x-positions to draw (page points). */
  v: number[];
  /** Horizontal guide y-positions to draw (page points). */
  h: number[];
}

/** The closest candidate guide within `threshold` of any of `values`. */
export function nearestGuide(
  values: number[],
  candidates: number[],
  threshold: number,
): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null;
  for (const v of values) {
    for (const c of candidates) {
      const d = c - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, guide: c };
      }
    }
  }
  return best;
}

/**
 * Snap a rect being MOVED. Guide candidates are the other elements' edges and
 * centers plus the page's center; the grid (when on) is a fallback that
 * doesn't draw guides. Returns the adjusted position and guides to render.
 */
export function snapMovingRect(
  rect: Rect,
  others: Rect[],
  page: { w: number; h: number },
  opts: SnapOptions,
): SnapMove {
  let { x, y } = rect;
  const v: number[] = [];
  const h: number[] = [];

  if (opts.snap) {
    const candX: number[] = [page.w / 2];
    const candY: number[] = [page.h / 2];
    for (const o of others) {
      candX.push(o.x, o.x + o.w / 2, o.x + o.w);
      candY.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    const sx = nearestGuide([x, x + rect.w / 2, x + rect.w], candX, opts.threshold);
    if (sx) {
      x += sx.delta;
      v.push(sx.guide);
    }
    const sy = nearestGuide([y, y + rect.h / 2, y + rect.h], candY, opts.threshold);
    if (sy) {
      y += sy.delta;
      h.push(sy.guide);
    }
  }
  if (opts.grid) {
    const g = opts.gridSize;
    if (!v.length) x = Math.round(x / g) * g;
    if (!h.length) y = Math.round(y / g) * g;
  }
  return { x, y, v, h };
}

/** Snap the bottom-right corner while RESIZING (right + bottom edges only). */
export function snapResizingRect(
  rect: Rect,
  others: Rect[],
  page: { w: number; h: number },
  opts: SnapOptions,
): { w: number; h: number; v: number[]; h2: number[] } {
  let { w, h } = rect;
  const v: number[] = [];
  const hg: number[] = [];

  if (opts.snap) {
    const candX: number[] = [page.w / 2];
    const candY: number[] = [page.h / 2];
    for (const o of others) {
      candX.push(o.x, o.x + o.w, o.x + o.w / 2);
      candY.push(o.y, o.y + o.h, o.y + o.h / 2);
    }
    const sx = nearestGuide([rect.x + w], candX, opts.threshold);
    if (sx) {
      w += sx.delta;
      v.push(sx.guide);
    }
    const sy = nearestGuide([rect.y + h], candY, opts.threshold);
    if (sy) {
      h += sy.delta;
      hg.push(sy.guide);
    }
  }
  if (opts.grid) {
    const g = opts.gridSize;
    if (!v.length) w = Math.max(g, Math.round((rect.x + w) / g) * g - rect.x);
    if (!hg.length) h = Math.max(g, Math.round((rect.y + h) / g) * g - rect.y);
  }
  return { w: Math.max(8, w), h: Math.max(8, h), v, h2: hg };
}

/* ------------------------------------------------------------------ */
/* Align / distribute (multi-selection)                                */
/* ------------------------------------------------------------------ */

export type AlignMode =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "center-v"
  | "bottom";

/**
 * New positions aligning `rects` within their common bounding box.
 * Returns one partial position per rect, in input order — only the moved
 * axis is present, so results can be spread over the original objects.
 */
export function alignRects(
  rects: Rect[],
  mode: AlignMode,
): Array<{ x?: number; y?: number }> {
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return rects.map((r) => {
    switch (mode) {
      case "left":
        return { x: minX };
      case "center-h":
        return { x: (minX + maxX) / 2 - r.w / 2 };
      case "right":
        return { x: maxX - r.w };
      case "top":
        return { y: minY };
      case "center-v":
        return { y: (minY + maxY) / 2 - r.h / 2 };
      case "bottom":
        return { y: maxY - r.h };
    }
  });
}

/**
 * Distribute `rects` along `axis` with equal gaps between neighbors; the
 * outermost edges of the selection stay put. Returns one partial position per
 * rect, in input order. Fewer than 3 rects distribute to their own positions.
 */
export function distributeRects(
  rects: Rect[],
  axis: "x" | "y",
): Array<{ x?: number; y?: number }> {
  const pos = (r: Rect) => (axis === "x" ? r.x : r.y);
  const size = (r: Rect) => (axis === "x" ? r.w : r.h);
  if (rects.length < 3) {
    return rects.map((r) => (axis === "x" ? { x: r.x } : { y: r.y }));
  }
  const min = Math.min(...rects.map(pos));
  const max = Math.max(...rects.map((r) => pos(r) + size(r)));
  const total = rects.reduce((n, r) => n + size(r), 0);
  const gap = (max - min - total) / (rects.length - 1);
  const order = rects
    .map((_, i) => i)
    .sort((a, b) => pos(rects[a]) - pos(rects[b]));
  const out: Array<{ x?: number; y?: number }> = new Array(rects.length);
  let cursor = min;
  for (const i of order) {
    out[i] = axis === "x" ? { x: cursor } : { y: cursor };
    cursor += size(rects[i]) + gap;
  }
  return out;
}

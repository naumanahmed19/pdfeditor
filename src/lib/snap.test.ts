// Pure-math proofs for the shared snap / align / distribute helpers
// (consumed by both the form builder and the general annotation layer).
import { describe, expect, it } from "vitest";
import {
  alignRects,
  distributeRects,
  nearestGuide,
  snapMovingRect,
  snapResizingRect,
  type Rect,
} from "./snap";

const PAGE = { w: 600, h: 800 };
const OPTS = { snap: true, grid: false, gridSize: 12, threshold: 6 };

describe("nearestGuide", () => {
  it("returns the closest candidate within the threshold", () => {
    const hit = nearestGuide([100], [90, 104, 110], 6);
    expect(hit).toEqual({ delta: 4, guide: 104 });
  });

  it("prefers the smallest absolute delta across all value/candidate pairs", () => {
    const hit = nearestGuide([100, 150], [95, 148], 6);
    expect(hit).toEqual({ delta: -2, guide: 148 });
  });

  it("returns null when every candidate is beyond the threshold", () => {
    expect(nearestGuide([100], [80, 120], 6)).toBeNull();
  });

  it("treats a candidate exactly at the threshold as a hit", () => {
    expect(nearestGuide([100], [106], 6)).toEqual({ delta: 6, guide: 106 });
  });
});

describe("snapMovingRect", () => {
  const other: Rect = { x: 200, y: 300, w: 100, h: 40 };

  it("snaps the left edge to a neighbor's left edge and reports the guide", () => {
    const s = snapMovingRect({ x: 204, y: 500, w: 50, h: 20 }, [other], PAGE, OPTS);
    expect(s.x).toBe(200);
    expect(s.v).toEqual([200]);
    expect(s.h).toEqual([]); // y far from any candidate
    expect(s.y).toBe(500);
  });

  it("snaps centers to the page center lines", () => {
    // Page center x = 300; rect center at 297 → shift +3.
    const s = snapMovingRect({ x: 272, y: 10, w: 50, h: 20 }, [], PAGE, OPTS);
    expect(s.x).toBe(275);
    expect(s.v).toEqual([300]);
  });

  it("snaps the right edge to a neighbor's right edge", () => {
    // Right edge at 297 → neighbor's right edge 300 → shift +3 (closer than
    // the left edge's 246 → 250 center candidate at distance 4).
    const s = snapMovingRect({ x: 246, y: 700, w: 51, h: 20 }, [other], PAGE, OPTS);
    expect(s.x).toBe(249);
    expect(s.v).toEqual([300]);
  });

  it("does nothing when snapping is off", () => {
    const s = snapMovingRect({ x: 204, y: 302, w: 50, h: 20 }, [other], PAGE, {
      ...OPTS,
      snap: false,
    });
    expect(s).toEqual({ x: 204, y: 302, v: [], h: [] });
  });

  it("falls back to the grid without drawing guides", () => {
    const s = snapMovingRect({ x: 130, y: 131, w: 50, h: 20 }, [], PAGE, {
      snap: false,
      grid: true,
      gridSize: 12,
      threshold: 6,
    });
    expect(s.x).toBe(132);
    expect(s.y).toBe(132);
    expect(s.v).toEqual([]);
    expect(s.h).toEqual([]);
  });
});

describe("snapResizingRect", () => {
  it("snaps the bottom-right corner to a neighbor's edges", () => {
    const other: Rect = { x: 0, y: 0, w: 154, h: 83 };
    const s = snapResizingRect({ x: 50, y: 20, w: 100, h: 60 }, [other], PAGE, OPTS);
    expect(s.w).toBe(104); // right edge 150 → 154
    expect(s.h).toBe(63); // bottom edge 80 → 83
    expect(s.v).toEqual([154]);
    expect(s.h2).toEqual([83]);
  });

  it("never collapses below the minimum size", () => {
    const s = snapResizingRect({ x: 0, y: 0, w: 5, h: 5 }, [], PAGE, {
      ...OPTS,
      snap: false,
    });
    expect(s.w).toBe(8);
    expect(s.h).toBe(8);
  });
});

describe("alignRects", () => {
  const rects: Rect[] = [
    { x: 10, y: 20, w: 30, h: 10 },
    { x: 50, y: 40, w: 20, h: 30 },
    { x: 80, y: 90, w: 40, h: 20 },
  ];
  // Selection bounds: x 10..120, y 20..110.

  it("aligns left edges to the leftmost edge", () => {
    expect(alignRects(rects, "left")).toEqual([{ x: 10 }, { x: 10 }, { x: 10 }]);
  });

  it("aligns right edges to the rightmost edge", () => {
    expect(alignRects(rects, "right")).toEqual([{ x: 90 }, { x: 100 }, { x: 80 }]);
  });

  it("aligns horizontal centers to the selection's center", () => {
    // Center x = (10 + 120) / 2 = 65.
    expect(alignRects(rects, "center-h")).toEqual([{ x: 50 }, { x: 55 }, { x: 45 }]);
  });

  it("aligns top edges to the topmost edge", () => {
    expect(alignRects(rects, "top")).toEqual([{ y: 20 }, { y: 20 }, { y: 20 }]);
  });

  it("aligns bottom edges to the bottommost edge", () => {
    expect(alignRects(rects, "bottom")).toEqual([{ y: 100 }, { y: 80 }, { y: 90 }]);
  });

  it("aligns vertical centers to the selection's center", () => {
    // Center y = (20 + 110) / 2 = 65.
    expect(alignRects(rects, "center-v")).toEqual([{ y: 60 }, { y: 50 }, { y: 55 }]);
  });

  it("only moves along the aligned axis (no x/y cross-talk)", () => {
    for (const p of alignRects(rects, "left")) expect(p).not.toHaveProperty("y");
    for (const p of alignRects(rects, "top")) expect(p).not.toHaveProperty("x");
  });
});

describe("distributeRects", () => {
  it("spaces three rects with equal gaps, outer edges pinned", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 12, y: 0, w: 20, h: 10 },
      { x: 90, y: 0, w: 10, h: 10 },
    ];
    // Span 0..100, total width 40 → gap = (100 - 40) / 2 = 30.
    expect(distributeRects(rects, "x")).toEqual([{ x: 0 }, { x: 40 }, { x: 90 }]);
  });

  it("keeps results in input order even when input isn't sorted", () => {
    const rects: Rect[] = [
      { x: 0, y: 90, w: 10, h: 10 }, // bottom
      { x: 0, y: 0, w: 10, h: 10 }, // top
      { x: 0, y: 33, w: 10, h: 10 }, // middle
    ];
    // Span 0..100, total height 30 → gap = 35; order top, middle, bottom.
    expect(distributeRects(rects, "y")).toEqual([{ y: 90 }, { y: 0 }, { y: 45 }]);
  });

  it("leaves fewer than three rects untouched", () => {
    const rects: Rect[] = [
      { x: 5, y: 0, w: 10, h: 10 },
      { x: 40, y: 0, w: 10, h: 10 },
    ];
    expect(distributeRects(rects, "x")).toEqual([{ x: 5 }, { x: 40 }]);
  });
});

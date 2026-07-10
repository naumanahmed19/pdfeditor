import { describe, expect, it } from "vitest";
import {
  CLOUD_RADIUS,
  cloudArcCount,
  cloudPathD,
  dedupeTail,
  normalizePoly,
  polyPathD,
  scalePoints,
  signedArea2,
  toAbsolute,
  type PolyPoint,
} from "./poly";

// Clockwise square in y-down screen coordinates.
const SQUARE: PolyPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const arcCountIn = (d: string) => (d.match(/A /g) ?? []).length;

describe("normalizePoly", () => {
  it("shifts points so the min corner is the box origin", () => {
    const n = normalizePoly([
      { x: 50, y: 30 },
      { x: 90, y: 70 },
      { x: 10, y: 110 },
    ]);
    expect(n).toMatchObject({ x: 10, y: 30, w: 80, h: 80 });
    expect(n.points[0]).toEqual({ x: 40, y: 0 });
    expect(n.points[2]).toEqual({ x: 0, y: 80 });
    expect(Math.min(...n.points.map((p) => p.x))).toBe(0);
    expect(Math.min(...n.points.map((p) => p.y))).toBe(0);
  });

  it("clamps a degenerate (straight-line) box to 1pt so it stays drawable", () => {
    const n = normalizePoly([
      { x: 10, y: 50 },
      { x: 200, y: 50 },
    ]);
    expect(n.w).toBe(190);
    expect(n.h).toBe(1);
  });
});

describe("relative ↔ absolute mapping", () => {
  it("normalize then toAbsolute round-trips", () => {
    const abs: PolyPoint[] = [
      { x: 12.5, y: 40 },
      { x: 77, y: 13 },
      { x: 33, y: 90 },
    ];
    const n = normalizePoly(abs);
    expect(toAbsolute(n.points, { x: n.x, y: n.y })).toEqual(abs);
  });
});

describe("scalePoints", () => {
  it("scales x and y independently (box-resize math)", () => {
    const scaled = scalePoints(SQUARE, 2, 0.5);
    expect(scaled).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it("identity scale is a no-op", () => {
    expect(scalePoints(SQUARE, 1, 1)).toEqual(SQUARE);
  });
});

describe("dedupeTail", () => {
  it("drops trailing near-duplicates from a finishing double-click", () => {
    const pts = [...SQUARE, { x: 0.5, y: 100.5 }, { x: 0.8, y: 100.2 }];
    expect(dedupeTail(pts, 5)).toEqual(SQUARE);
  });

  it("keeps intermediate close points", () => {
    const pts: PolyPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 100, y: 0 },
    ];
    expect(dedupeTail(pts, 5)).toEqual(pts);
  });
});

describe("polyPathD", () => {
  it("closed path ends with Z, open path does not", () => {
    expect(polyPathD(SQUARE, true)).toMatch(/Z$/);
    expect(polyPathD(SQUARE, false)).not.toMatch(/Z/);
  });

  it("starts at the first point and visits every vertex", () => {
    const d = polyPathD(SQUARE, true);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect((d.match(/L /g) ?? []).length).toBe(SQUARE.length - 1);
  });
});

describe("signedArea2", () => {
  it("is positive for clockwise (y-down) and negative reversed", () => {
    expect(signedArea2(SQUARE)).toBeGreaterThan(0);
    expect(signedArea2([...SQUARE].reverse())).toBeLessThan(0);
  });
});

describe("cloud path", () => {
  it("scallop count grows with edge length", () => {
    const short = cloudArcCount(20, CLOUD_RADIUS);
    const long = cloudArcCount(200, CLOUD_RADIUS);
    expect(long).toBeGreaterThan(short);
    // Chord per scallop never exceeds 2r (the SVG arc would degenerate).
    expect(200 / cloudArcCount(200, CLOUD_RADIUS)).toBeLessThan(2 * CLOUD_RADIUS);
    expect(cloudArcCount(0.001, CLOUD_RADIUS)).toBe(1);
  });

  it("emits one arc per scallop across all edges", () => {
    const d = cloudPathD(SQUARE, CLOUD_RADIUS);
    const perEdge = cloudArcCount(100, CLOUD_RADIUS);
    expect(arcCountIn(d)).toBe(perEdge * 4);
  });

  it("closed path starts at the first vertex, ends every edge run on a vertex, and closes", () => {
    const d = cloudPathD(SQUARE, CLOUD_RADIUS);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // The final arc returns to the start point before Z.
    expect(d).toMatch(/ 0 0 Z$/);
    // Each vertex is an arc endpoint (arcs land ON the polygon corners).
    expect(d).toContain(" 100 0");
    expect(d).toContain(" 100 100");
    expect(d).toContain(" 0 100");
  });

  it("winding flips the sweep flag so scallops always bulge outward", () => {
    const cw = cloudPathD(SQUARE, CLOUD_RADIUS);
    const ccw = cloudPathD([...SQUARE].reverse(), CLOUD_RADIUS);
    // Arc command: A rx ry rot large sweep x y — sweep is the 5th number.
    const sweeps = (d: string) =>
      new Set([...d.matchAll(/A [\d.]+ [\d.]+ \d \d (\d)/g)].map((m) => m[1]));
    expect(sweeps(cw)).toEqual(new Set(["1"]));
    expect(sweeps(ccw)).toEqual(new Set(["0"]));
  });

  it("falls back to a straight closed path below 3 points", () => {
    const d = cloudPathD(SQUARE.slice(0, 2), CLOUD_RADIUS);
    expect(arcCountIn(d)).toBe(0);
    expect(d).toMatch(/Z$/);
  });
});

// Pure measurement math for the distance / perimeter / area tools. Points use
// the same convention as poly.ts: PDF display points, top-left origin, y down.
// Values are always DERIVED here from the stored vertices + scale — the
// computed length/area is never persisted, so recalibration relabels
// everything on the next render.

import type { PolyPoint } from "./poly";

export type MeasureMode = "distance" | "perimeter" | "area";

/** Real-world units offered by the calibration dialog. "pt" (scale 1) is the
 *  uncalibrated default: raw PDF points. */
export const MEASURE_UNITS = ["pt", "mm", "cm", "m", "in", "ft", "yd"] as const;

/** Half-length of the perpendicular end bars on a distance line, in PDF pts. */
export const DIST_TICK = 4;

/** Total length of an open path (segments between consecutive points). */
export function polylineLength(pts: PolyPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/** Absolute polygon area (shoelace), closing the ring implicitly. */
export function polygonArea(pts: PolyPoint[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Measured value in real-world units: lengths scale linearly, areas by the
 *  square of the calibration factor. */
export function measureValue(
  mode: MeasureMode,
  pts: PolyPoint[],
  scale: number,
): number {
  if (mode === "area") return polygonArea(pts) * scale * scale;
  // Perimeter measures the drawn OPEN path — the user closes it explicitly
  // if they want the full ring.
  return polylineLength(pts) * scale;
}

export function formatMeasure(
  value: number,
  unit: string,
  squared = false,
): string {
  return `${value.toFixed(2)} ${unit}${squared ? "²" : ""}`;
}

/** Ready-to-render label for a measurement annotation or live draft. */
export function measureLabel(
  mode: MeasureMode,
  pts: PolyPoint[],
  scale: number,
  unit: string,
): string {
  return formatMeasure(measureValue(mode, pts, scale), unit, mode === "area");
}

/** Compact calibration factor for UI text ("1 pt = X unit"): ≤4 significant
 *  digits, no trailing zeros. */
export function formatScale(scale: number): string {
  return String(Number(scale.toPrecision(4)));
}

/** Point halfway along the path — where a distance/perimeter label sits. */
export function midpointAlong(pts: PolyPoint[]): PolyPoint {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { ...pts[0] };
  const half = polylineLength(pts) / 2;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (walked + seg >= half && seg > 0) {
      const t = (half - walked) / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      };
    }
    walked += seg;
  }
  return { ...pts[pts.length - 1] };
}

/** Area-weighted polygon centroid — where an area label sits. Degenerate
 *  (zero-area) rings fall back to the vertex average. */
export function polygonCentroid(pts: PolyPoint[]): PolyPoint {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    const n = Math.max(1, pts.length);
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** Perpendicular end bars for a distance line: one segment across each
 *  endpoint, `half` points to either side. */
export function distanceTicks(
  a: PolyPoint,
  b: PolyPoint,
  half: number = DIST_TICK,
): Array<[PolyPoint, PolyPoint]> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return [];
  const nx = (-(b.y - a.y) / len) * half;
  const ny = ((b.x - a.x) / len) * half;
  return [
    [
      { x: a.x - nx, y: a.y - ny },
      { x: a.x + nx, y: a.y + ny },
    ],
    [
      { x: b.x - nx, y: b.y - ny },
      { x: b.x + nx, y: b.y + ny },
    ],
  ];
}

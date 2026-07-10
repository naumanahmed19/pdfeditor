// Pure geometry for polygon / polyline / cloud annotations. Points are in
// PDF display points; paths use top-left-origin y-down coordinates — the same
// convention as the on-screen SVG viewBox AND pdf-lib's drawSvgPath, so one
// `d` string serves both.

export interface PolyPoint {
  x: number;
  y: number;
}

/** Scallop radius for cloud (review-markup) borders, in PDF points. */
export const CLOUD_RADIUS = 8;

/** Max chord length per scallop, as a fraction of the radius. Kept under 2
 *  so the SVG arc radius never has to be auto-scaled up to span a chord. */
const CLOUD_CHORD_FRAC = 1.8;

export function polyBounds(pts: PolyPoint[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Absolute page points → annotation box + box-relative points. The box is
 *  clamped to ≥1pt per side so a straight horizontal/vertical polyline keeps
 *  a drawable (non-degenerate) box, like the line tool does. */
export function normalizePoly(pts: PolyPoint[]): {
  x: number;
  y: number;
  w: number;
  h: number;
  points: PolyPoint[];
} {
  const b = polyBounds(pts);
  return {
    x: b.x,
    y: b.y,
    w: Math.max(1, b.w),
    h: Math.max(1, b.h),
    points: pts.map((p) => ({ x: p.x - b.x, y: p.y - b.y })),
  };
}

export function scalePoints(
  pts: PolyPoint[],
  sx: number,
  sy: number,
): PolyPoint[] {
  return pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

export function toAbsolute(
  pts: PolyPoint[],
  origin: PolyPoint,
): PolyPoint[] {
  return pts.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y }));
}

/** Drop trailing vertices that sit within `eps` of their predecessor — a
 *  finishing double-click places two near-identical points before dblclick
 *  fires. Intermediate points are kept (they may be deliberate). */
export function dedupeTail(pts: PolyPoint[], eps: number): PolyPoint[] {
  const out = [...pts];
  while (out.length > 1) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) > eps) break;
    out.pop();
  }
  return out;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Straight-edged SVG path through the points; `close` appends Z (polygon). */
export function polyPathD(pts: PolyPoint[], close: boolean): string {
  if (!pts.length) return "";
  const d =
    `M ${fmt(pts[0].x)} ${fmt(pts[0].y)} ` +
    pts.slice(1).map((p) => `L ${fmt(p.x)} ${fmt(p.y)}`).join(" ");
  return close ? `${d} Z` : d;
}

/** Shoelace sum ×2. In y-down screen coordinates, positive = clockwise. */
export function signedArea2(pts: PolyPoint[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** Scallops along one edge: enough that each chord stays ≤ CLOUD_CHORD_FRAC·r. */
export function cloudArcCount(edgeLen: number, r: number): number {
  return Math.max(1, Math.ceil(edgeLen / (CLOUD_CHORD_FRAC * r)));
}

/**
 * Closed cloud (revision-markup) path: every polygon edge becomes a run of
 * circular arcs bulging OUTWARD. Outward = the side away from the interior,
 * derived from the winding: walking a clockwise (y-down) polygon the interior
 * is on the right, so the bulge goes left of travel (SVG sweep=1), and
 * vice versa. Degenerate inputs (<3 points) fall back to the straight path.
 */
export function cloudPathD(pts: PolyPoint[], r: number = CLOUD_RADIUS): string {
  if (pts.length < 3) return polyPathD(pts, true);
  const sweep = signedArea2(pts) > 0 ? 1 : 0;
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const n = cloudArcCount(len, r);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      d += ` A ${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(x)} ${fmt(y)}`;
    }
  }
  return `${d} Z`;
}

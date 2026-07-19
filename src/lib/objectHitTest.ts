export interface ScreenRectObject {
  rect: { left: number; top: number; width: number; height: number };
}

/** Return the smallest rendered object containing a screen-space point.
 * A linear scan avoids allocating and sorting a candidate array on every
 * pointer move, which matters on vector-heavy PDF pages. */
export function pickSmallestObjectAt<T extends ScreenRectObject>(
  objects: readonly T[],
  x: number,
  y: number,
): T | undefined {
  let best: T | undefined;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const object of objects) {
    const { left, top, width, height } = object.rect;
    if (x < left || x > left + width || y < top || y > top + height) continue;
    const area = width * height;
    if (area < bestArea) {
      best = object;
      bestArea = area;
    }
  }
  return best;
}

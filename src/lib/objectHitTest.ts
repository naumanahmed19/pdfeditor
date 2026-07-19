export interface ScreenRectObject {
  rect: { left: number; top: number; width: number; height: number };
}

const distanceToRect = (
  { left, top, width, height }: ScreenRectObject["rect"],
  x: number,
  y: number,
) => {
  const dx = Math.max(left - x, 0, x - (left + width));
  const dy = Math.max(top - y, 0, y - (top + height));
  return Math.hypot(dx, dy);
};

/** Return every object close enough to a screen-space point, ordered from the
 * most precise hit to the broadest one. A small tolerance makes hairlines and
 * zero-width PDF paths selectable without making large backgrounds win. */
export function objectsAtPoint<T extends ScreenRectObject>(
  objects: readonly T[],
  x: number,
  y: number,
  tolerance = 5,
): T[] {
  return objects
    .map((object, order) => {
      const distance = distanceToRect(object.rect, x, y);
      const { width, height } = object.rect;
      return {
        object,
        order,
        distance,
        area: Math.max(1, width) * Math.max(1, height),
      };
    })
    .filter((candidate) => candidate.distance <= tolerance)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.area - b.area ||
        // Later page objects are painted above earlier ones.
        b.order - a.order,
    )
    .map((candidate) => candidate.object);
}

/** Return the most precise rendered object at a screen-space point. */
export function pickSmallestObjectAt<T extends ScreenRectObject>(
  objects: readonly T[],
  x: number,
  y: number,
  tolerance = 5,
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  // Keep hover hit-testing allocation-free: this runs on every pointer move
  // on pages that can contain thousands of vector objects.
  for (const object of objects) {
    const distance = distanceToRect(object.rect, x, y);
    if (distance > tolerance) continue;
    const area =
      Math.max(1, object.rect.width) * Math.max(1, object.rect.height);
    if (
      distance < bestDistance ||
      (distance === bestDistance && area <= bestArea)
    ) {
      best = object;
      bestDistance = distance;
      bestArea = area;
    }
  }
  return best;
}

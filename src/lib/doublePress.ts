export interface PressPoint {
  at: number;
  x: number;
  y: number;
}

export const DOUBLE_PRESS_MS = 550;
export const DOUBLE_PRESS_DISTANCE_PX = 6;

/** Browser click counts respect the OS double-click preference. Pointer
 * handlers that suppress click events use the time-and-distance fallback. */
export function isDoublePress(
  previous: PressPoint | null,
  current: PressPoint,
  browserClickCount = 0,
): boolean {
  if (browserClickCount > 1) return true;
  return !!(
    previous &&
    current.at - previous.at <= DOUBLE_PRESS_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <=
      DOUBLE_PRESS_DISTANCE_PX
  );
}

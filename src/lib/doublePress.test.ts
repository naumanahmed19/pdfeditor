import { describe, expect, it } from "vitest";
import { isDoublePress } from "./doublePress";

describe("double-press gesture", () => {
  const first = { at: 100, x: 20, y: 30 };

  it("accepts a nearby second press within the fallback window", () => {
    expect(isDoublePress(first, { at: 620, x: 24, y: 32 })).toBe(true);
  });

  it("rejects slow or spatially distant presses", () => {
    expect(isDoublePress(first, { at: 700, x: 20, y: 30 })).toBe(false);
    expect(isDoublePress(first, { at: 200, x: 40, y: 30 })).toBe(false);
  });

  it("trusts the browser's OS-aware click count", () => {
    expect(isDoublePress(null, { at: 100, x: 20, y: 30 }, 2)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { pickSmallestObjectAt } from "./objectHitTest";

describe("native object hit testing", () => {
  const objects = [
    { id: "background", rect: { left: 0, top: 0, width: 100, height: 100 } },
    { id: "text", rect: { left: 10, top: 20, width: 40, height: 10 } },
    { id: "glyph", rect: { left: 20, top: 20, width: 5, height: 10 } },
  ];

  it("picks the smallest overlapping object", () => {
    expect(pickSmallestObjectAt(objects, 22, 24)?.id).toBe("glyph");
    expect(pickSmallestObjectAt(objects, 30, 24)?.id).toBe("text");
  });

  it("returns undefined outside every object", () => {
    expect(pickSmallestObjectAt(objects, 150, 150)).toBeUndefined();
  });
});

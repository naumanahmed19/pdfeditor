import { describe, expect, it } from "vitest";
import { objectsAtPoint, pickSmallestObjectAt } from "./objectHitTest";

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

  it("makes thin and zero-width objects easy to target", () => {
    const hairlines = [
      { id: "line", rect: { left: 40, top: 10, width: 0, height: 80 } },
    ];
    expect(pickSmallestObjectAt(hairlines, 44, 30)?.id).toBe("line");
    expect(pickSmallestObjectAt(hairlines, 46, 30)).toBeUndefined();
  });

  it("prefers a precise contained hit over a nearby tiny object", () => {
    const nearby = [
      { id: "inside", rect: { left: 10, top: 10, width: 30, height: 20 } },
      { id: "nearby", rect: { left: 43, top: 20, width: 1, height: 1 } },
    ];
    expect(pickSmallestObjectAt(nearby, 39, 20)?.id).toBe("inside");
  });

  it("returns an ordered stack for overlap cycling", () => {
    expect(objectsAtPoint(objects, 22, 24).map((object) => object.id)).toEqual([
      "glyph",
      "text",
      "background",
    ]);
  });
});

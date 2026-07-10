import { describe, expect, it } from "vitest";
import {
  distanceTicks,
  formatMeasure,
  formatScale,
  measureLabel,
  measureValue,
  midpointAlong,
  polygonArea,
  polygonCentroid,
  polylineLength,
} from "./measure";

describe("polylineLength", () => {
  it("sums consecutive segments", () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(20);
  });

  it("is 0 for fewer than two points", () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it("does NOT close the ring (open path)", () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(30);
  });
});

describe("polygonArea (shoelace, absolute)", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("unit square scaled", () => {
    expect(polygonArea(square)).toBe(100);
  });

  it("is winding-independent (absolute)", () => {
    expect(polygonArea([...square].reverse())).toBe(100);
  });

  it("triangle", () => {
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(50);
  });

  it("non-convex L-shape", () => {
    // 10×10 square minus a 5×5 corner bite = 75.
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(75);
  });

  it("degenerate inputs give 0", () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 1, y: 1 }, { x: 5, y: 5 }])).toBe(0);
  });
});

describe("measureValue — scale application", () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("distance and perimeter scale linearly", () => {
    expect(measureValue("distance", line, 0.5)).toBe(50);
    expect(measureValue("perimeter", square, 0.5)).toBe(150); // open path
  });

  it("area scales by the SQUARE of the calibration factor", () => {
    expect(measureValue("area", square, 0.5)).toBe(2500);
    expect(measureValue("area", square, 1)).toBe(10000);
  });
});

describe("formatMeasure / measureLabel / formatScale", () => {
  it("two decimals with unit", () => {
    expect(formatMeasure(50, "cm")).toBe("50.00 cm");
    expect(formatMeasure(12.345, "m")).toBe("12.35 m");
  });

  it("squared unit for areas", () => {
    expect(formatMeasure(2500, "cm", true)).toBe("2500.00 cm²");
  });

  it("measureLabel wires mode → squared", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(measureLabel("area", sq, 2, "mm")).toBe("400.00 mm²");
    expect(measureLabel("distance", [{ x: 0, y: 0 }, { x: 3, y: 4 }], 2, "mm")).toBe(
      "10.00 mm",
    );
  });

  it("formatScale trims to 4 significant digits", () => {
    expect(formatScale(0.123456)).toBe("0.1235");
    expect(formatScale(1)).toBe("1");
    expect(formatScale(0.5)).toBe("0.5");
  });
});

describe("midpointAlong", () => {
  it("segment midpoint", () => {
    expect(midpointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
  });

  it("half of an uneven multi-segment path", () => {
    // Lengths 10 + 30: half = 20 → 10 into the second segment.
    expect(
      midpointAlong([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 30 },
      ]),
    ).toEqual({ x: 10, y: 10 });
  });
});

describe("polygonCentroid", () => {
  it("square centroid", () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toEqual({ x: 5, y: 5 });
  });

  it("degenerate ring falls back to vertex average", () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual({ x: 5, y: 5 });
  });
});

describe("distanceTicks", () => {
  it("perpendicular bars at both endpoints", () => {
    const [ta, tb] = distanceTicks({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(ta).toEqual([{ x: 0, y: -4 }, { x: 0, y: 4 }]);
    expect(tb).toEqual([{ x: 10, y: -4 }, { x: 10, y: 4 }]);
  });

  it("zero-length line yields no ticks", () => {
    expect(distanceTicks({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });
});

// Property/round-trip proofs for the unified coordinate converter.
//
// The independent oracle is pdf.js's PageViewport transform (re-implemented
// verbatim below from pdf.js display/display_utils.js), i.e. "what the page
// actually looks like on screen". Everything else must agree with it:
// point conversions, rect conversions, and the display-frame CTM.
import { describe, expect, it } from "vitest";
import {
  applyMatrix,
  displayPointToPdf,
  displayRectToPdf,
  displaySize,
  displayToPdfMatrix,
  isIdentityMatrix,
  normalizeRotation,
  pageGeometry,
  pdfPointToDisplay,
  pdfRectToDisplay,
  type PageBox,
  type PageGeometry,
  type Point,
} from "./coords";

const ROTATIONS = [0, 90, 180, 270] as const;

// Deliberately non-square boxes, including CropBoxes offset from the origin
// and one with a negative origin (legal in PDF).
const BOXES: PageBox[] = [
  { x: 0, y: 0, width: 612, height: 792 }, // US Letter portrait
  { x: 0, y: 0, width: 400, height: 600 },
  { x: 50, y: 100, width: 300, height: 400 }, // offset CropBox
  { x: -20, y: -30, width: 500, height: 200 }, // negative origin, landscape
];

const geom = (rotation: (typeof ROTATIONS)[number], box: PageBox): PageGeometry => ({
  rotation,
  box,
});

/** Deterministic PRNG so failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const closeTo = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

/**
 * pdf.js PageViewport transform at scale 1 (rotation normalized, dontFlip
 * false), reduced from display/display_utils.js. Maps an absolute PDF
 * user-space point to display CSS px (top-left origin) for viewBox
 * [x1, y1, x2, y2]. This is the ground truth for what a viewer renders.
 */
function pdfjsViewportToDisplay(p: Point, rotation: number, box: PageBox): Point {
  const viewBox = [box.x, box.y, box.x + box.width, box.y + box.height];
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  let rotateA: number, rotateB: number, rotateC: number, rotateD: number;
  switch (((rotation % 360) + 360) % 360) {
    case 180:
      rotateA = -1; rotateB = 0; rotateC = 0; rotateD = 1;
      break;
    case 90:
      rotateA = 0; rotateB = 1; rotateC = 1; rotateD = 0;
      break;
    case 270:
      rotateA = 0; rotateB = -1; rotateC = -1; rotateD = 0;
      break;
    default:
      rotateA = 1; rotateB = 0; rotateC = 0; rotateD = -1;
      break;
  }
  let offsetCanvasX: number, offsetCanvasY: number;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - viewBox[1]);
    offsetCanvasY = Math.abs(centerX - viewBox[0]);
  } else {
    offsetCanvasX = Math.abs(centerX - viewBox[0]);
    offsetCanvasY = Math.abs(centerY - viewBox[1]);
  }
  const m = [
    rotateA,
    rotateB,
    rotateC,
    rotateD,
    offsetCanvasX - rotateA * centerX - rotateC * centerY,
    offsetCanvasY - rotateB * centerX - rotateD * centerY,
  ];
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

describe("coords — agreement with the pdf.js viewport (rendering oracle)", () => {
  it("pdfPointToDisplay matches the pdf.js transform for all rotations/boxes", () => {
    const rand = mulberry32(0xc0ffee);
    for (const rotation of ROTATIONS) {
      for (const box of BOXES) {
        const g = geom(rotation, box);
        for (let i = 0; i < 200; i++) {
          const p = {
            x: box.x + rand() * box.width,
            y: box.y + rand() * box.height,
          };
          const ours = pdfPointToDisplay(p, g);
          const truth = pdfjsViewportToDisplay(p, rotation, box);
          expect(closeTo(ours.x, truth.x), `${rotation}° x`).toBe(true);
          expect(closeTo(ours.y, truth.y), `${rotation}° y`).toBe(true);
        }
      }
    }
  });

  it("displayPointToPdf is the exact inverse of the pdf.js transform", () => {
    const rand = mulberry32(0xbead);
    for (const rotation of ROTATIONS) {
      for (const box of BOXES) {
        const g = geom(rotation, box);
        const { width: dw, height: dh } = displaySize(g);
        for (let i = 0; i < 200; i++) {
          const d = { x: rand() * dw, y: rand() * dh };
          const p = displayPointToPdf(d, g);
          const back = pdfjsViewportToDisplay(p, rotation, box);
          expect(closeTo(back.x, d.x), `${rotation}° x`).toBe(true);
          expect(closeTo(back.y, d.y), `${rotation}° y`).toBe(true);
        }
      }
    }
  });
});

describe("coords — round trips are the identity", () => {
  it("display → PDF → display (points)", () => {
    const rand = mulberry32(1234);
    for (const rotation of ROTATIONS) {
      for (const box of BOXES) {
        const g = geom(rotation, box);
        const { width: dw, height: dh } = displaySize(g);
        for (let i = 0; i < 200; i++) {
          const d = { x: rand() * dw, y: rand() * dh };
          const back = pdfPointToDisplay(displayPointToPdf(d, g), g);
          expect(closeTo(back.x, d.x)).toBe(true);
          expect(closeTo(back.y, d.y)).toBe(true);
        }
      }
    }
  });

  it("PDF → display → PDF (points)", () => {
    const rand = mulberry32(4321);
    for (const rotation of ROTATIONS) {
      for (const box of BOXES) {
        const g = geom(rotation, box);
        for (let i = 0; i < 200; i++) {
          const p = { x: box.x + rand() * box.width, y: box.y + rand() * box.height };
          const back = displayPointToPdf(pdfPointToDisplay(p, g), g);
          expect(closeTo(back.x, p.x)).toBe(true);
          expect(closeTo(back.y, p.y)).toBe(true);
        }
      }
    }
  });

  it("display → PDF → display (rects), with w/h swapping at 90/270", () => {
    const rand = mulberry32(99);
    for (const rotation of ROTATIONS) {
      for (const box of BOXES) {
        const g = geom(rotation, box);
        const { width: dw, height: dh } = displaySize(g);
        for (let i = 0; i < 200; i++) {
          const r = {
            x: rand() * dw * 0.5,
            y: rand() * dh * 0.5,
            w: 1 + rand() * dw * 0.4,
            h: 1 + rand() * dh * 0.4,
          };
          const pdf = displayRectToPdf(r, g);
          if (rotation % 180 === 0) {
            expect(closeTo(pdf.w, r.w)).toBe(true);
            expect(closeTo(pdf.h, r.h)).toBe(true);
          } else {
            expect(closeTo(pdf.w, r.h)).toBe(true);
            expect(closeTo(pdf.h, r.w)).toBe(true);
          }
          const back = pdfRectToDisplay(pdf, g);
          for (const k of ["x", "y", "w", "h"] as const) {
            expect(closeTo(back[k], r[k])).toBe(true);
          }
        }
      }
    }
  });
});

describe("coords — display corners land on the physically correct PDF corners", () => {
  // /Rotate spins the page clockwise on screen, so the display's top-left
  // corner shows: 0 → page top-left, 90 → page bottom-left, 180 → page
  // bottom-right, 270 → page top-right.
  it.each([
    [0, (b: PageBox) => ({ x: b.x, y: b.y + b.height })],
    [90, (b: PageBox) => ({ x: b.x, y: b.y })],
    [180, (b: PageBox) => ({ x: b.x + b.width, y: b.y })],
    [270, (b: PageBox) => ({ x: b.x + b.width, y: b.y + b.height })],
  ] as const)("rotation %d°", (rotation, expected) => {
    for (const box of BOXES) {
      const g = geom(rotation, box);
      const p = displayPointToPdf({ x: 0, y: 0 }, g);
      const want = expected(box);
      expect(closeTo(p.x, want.x)).toBe(true);
      expect(closeTo(p.y, want.y)).toBe(true);
    }
  });

  it("display size swaps dimensions only at 90/270", () => {
    const box = { x: 0, y: 0, width: 400, height: 600 };
    expect(displaySize(geom(0, box))).toEqual({ width: 400, height: 600 });
    expect(displaySize(geom(90, box))).toEqual({ width: 600, height: 400 });
    expect(displaySize(geom(180, box))).toEqual({ width: 400, height: 600 });
    expect(displaySize(geom(270, box))).toEqual({ width: 600, height: 400 });
  });
});

describe("coords — display-frame CTM agrees with the point conversion", () => {
  it("matrix ∘ y-flip === displayPointToPdf for all rotations/boxes", () => {
    const rand = mulberry32(777);
    for (const rotation of ROTATIONS) {
      for (const box of BOXES) {
        const g = geom(rotation, box);
        const m = displayToPdfMatrix(g);
        const { width: dw, height: dh } = displaySize(g);
        for (let i = 0; i < 200; i++) {
          const d = { x: rand() * dw, y: rand() * dh };
          // Drawing code works in the y-up display frame: (x, dispH - y).
          const viaMatrix = applyMatrix(m, { x: d.x, y: dh - d.y });
          const direct = displayPointToPdf(d, g);
          expect(closeTo(viaMatrix.x, direct.x)).toBe(true);
          expect(closeTo(viaMatrix.y, direct.y)).toBe(true);
        }
      }
    }
  });

  it("is the identity exactly when rotation is 0 and the box sits at the origin", () => {
    expect(isIdentityMatrix(displayToPdfMatrix(geom(0, BOXES[0])))).toBe(true);
    expect(isIdentityMatrix(displayToPdfMatrix(geom(90, BOXES[0])))).toBe(false);
    expect(isIdentityMatrix(displayToPdfMatrix(geom(0, BOXES[2])))).toBe(false);
  });
});

describe("coords — regression: the old 270° branch swapped page dimensions", () => {
  // Historical bug (toPdfRect/displayPointToPdf in pdftools.ts): the 270°
  // case returned { x: ph - y - h, y: pw - x - w } — page height applied to
  // the x offset and width to the y offset. On non-square pages every
  // converted rect was displaced diagonally by (height − width), typically
  // landing outside the page. The 90° branch (a pure swap) was correct.
  it("270° on a 400×600 page maps into the page, unlike the old formula", () => {
    const box = { x: 0, y: 0, width: 400, height: 600 };
    const g = geom(270, box);
    const r = { x: 10, y: 20, w: 100, h: 50 };
    const pdf = displayRectToPdf(r, g);
    expect(pdf).toEqual({ x: 400 - 20 - 50, y: 600 - 10 - 100, w: 50, h: 100 });
    // The old formula put the rect at x = 600 - 20 - 50 = 530: beyond the
    // 400pt page width, i.e. drawn completely off the page.
    const old = { x: 600 - 20 - 50, y: 400 - 10 - 100 };
    expect(old.x).toBeGreaterThan(box.width);
    expect(pdf.x + pdf.w).toBeLessThanOrEqual(box.width);
    expect(pdf.y + pdf.h).toBeLessThanOrEqual(box.height);
  });

  it("90° needs no dimension offsets (pure axis swap)", () => {
    const g = geom(90, { x: 0, y: 0, width: 400, height: 600 });
    expect(displayRectToPdf({ x: 10, y: 20, w: 100, h: 50 }, g)).toEqual({
      x: 20,
      y: 10,
      w: 50,
      h: 100,
    });
  });
});

describe("coords — geometry helpers", () => {
  it("normalizeRotation snaps and wraps", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(179)).toBe(180);
  });

  it("pageGeometry intersects CropBox with MediaBox and falls back when empty", () => {
    const page = (media: PageBox, crop: PageBox) => ({
      getRotation: () => ({ angle: 0 }),
      getMediaBox: () => media,
      getCropBox: () => crop,
    });
    const media = { x: 0, y: 0, width: 612, height: 792 };
    // CropBox partly outside the MediaBox is clipped.
    expect(
      pageGeometry(page(media, { x: -50, y: 700, width: 200, height: 200 })).box,
    ).toEqual({ x: 0, y: 700, width: 150, height: 92 });
    // Disjoint CropBox falls back to the MediaBox.
    expect(
      pageGeometry(page(media, { x: 1000, y: 1000, width: 10, height: 10 })).box,
    ).toEqual(media);
  });
});

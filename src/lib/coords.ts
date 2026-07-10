/**
 * Unified display ↔ PDF coordinate conversion.
 *
 * Display space is what the viewer shows: the page's effective box
 * (CropBox ∩ MediaBox) rotated clockwise by /Rotate, origin at the top-left,
 * y down, in PDF points at scale 1. This matches both PDFium
 * (FPDF_GetPageWidthF/HeightF + its display matrix) and pdf.js
 * (`page.getViewport()`), and is the space annotation/crop/OCR coordinates
 * live in throughout the app.
 *
 * PDF space is raw user space: origin bottom-left, y up — what pdf-lib draw
 * calls, annotation /Rect entries and PDFium page-space APIs consume. Results
 * are absolute (they include the effective box's origin offset, which is not
 * (0,0) when the CropBox is offset from the MediaBox).
 *
 * Derivation: /Rotate turns the page clockwise on screen (PDF 1.7 spec,
 * table 3.27). With box-local PDF coords (x', y') = (x − box.x, y − box.y)
 * on a W×H box, the rendered position is
 *
 *   rotate 0:    display = (x',     H − y')
 *   rotate 90:   display = (y',     x')
 *   rotate 180:  display = (W − x', y')
 *   rotate 270:  display = (H − y', W − x')
 *
 * which is exactly pdf.js's PageViewport transform at scale 1 (see the
 * oracle in coords.test.ts). The inverses below follow by substitution.
 */

/** A PDF rectangle box in user space (MediaBox / CropBox shape). */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything a conversion needs to know about a page. */
export interface PageGeometry {
  /** Page /Rotate normalized to 0 | 90 | 180 | 270. */
  rotation: 0 | 90 | 180 | 270;
  /** Effective displayed box (CropBox ∩ MediaBox) in PDF user space. */
  box: PageBox;
}

export interface Point {
  x: number;
  y: number;
}

/** Display rect: top-left origin. PDF rect: bottom-left origin. Both w/h > 0. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Content-stream matrix [a b c d e f] (maps (x,y) → (ax+cy+e, bx+dy+f)). */
export type Matrix = [number, number, number, number, number, number];

/** Snap any /Rotate value to the nearest legal 0/90/180/270. */
export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** Structural subset of pdf-lib's PDFPage that geometry needs. */
export interface PageLike {
  getRotation(): { angle: number };
  getMediaBox(): PageBox;
  getCropBox(): PageBox;
}

/**
 * Read a pdf-lib page's geometry. The displayed box is the CropBox clipped to
 * the MediaBox (what PDFium/pdf.js render); a missing or degenerate CropBox
 * falls back to the MediaBox.
 */
export function pageGeometry(page: PageLike): PageGeometry {
  const media = page.getMediaBox();
  const crop = page.getCropBox(); // pdf-lib falls back to the MediaBox itself
  const x0 = Math.max(crop.x, media.x);
  const y0 = Math.max(crop.y, media.y);
  const x1 = Math.min(crop.x + crop.width, media.x + media.width);
  const y1 = Math.min(crop.y + crop.height, media.y + media.height);
  const box: PageBox =
    x1 > x0 && y1 > y0
      ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
      : { ...media };
  return { rotation: normalizeRotation(page.getRotation().angle), box };
}

/** Size of the page as displayed (rotation swaps width/height at 90/270). */
export function displaySize(g: PageGeometry): { width: number; height: number } {
  return g.rotation % 180 === 0
    ? { width: g.box.width, height: g.box.height }
    : { width: g.box.height, height: g.box.width };
}

/** Display point (top-left origin, rotated page) → absolute PDF user space. */
export function displayPointToPdf(p: Point, g: PageGeometry): Point {
  const { x: ox, y: oy, width: W, height: H } = g.box;
  switch (g.rotation) {
    case 90:
      return { x: ox + p.y, y: oy + p.x };
    case 180:
      return { x: ox + W - p.x, y: oy + p.y };
    case 270:
      return { x: ox + W - p.y, y: oy + H - p.x };
    default:
      return { x: ox + p.x, y: oy + H - p.y };
  }
}

/** Absolute PDF user-space point → display point (top-left origin). */
export function pdfPointToDisplay(p: Point, g: PageGeometry): Point {
  const { x: ox, y: oy, width: W, height: H } = g.box;
  const lx = p.x - ox;
  const ly = p.y - oy;
  switch (g.rotation) {
    case 90:
      return { x: ly, y: lx };
    case 180:
      return { x: W - lx, y: ly };
    case 270:
      return { x: H - ly, y: W - lx };
    default:
      return { x: lx, y: H - ly };
  }
}

/**
 * Display rect (top-left anchor) → PDF rect (bottom-left anchor, absolute
 * user space). At 90/270 the width and height swap.
 */
export function displayRectToPdf(r: Rect, g: PageGeometry): Rect {
  const a = displayPointToPdf({ x: r.x, y: r.y }, g);
  const b = displayPointToPdf({ x: r.x + r.w, y: r.y + r.h }, g);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** PDF rect (bottom-left anchor, absolute) → display rect (top-left anchor). */
export function pdfRectToDisplay(r: Rect, g: PageGeometry): Rect {
  const a = pdfPointToDisplay({ x: r.x, y: r.y }, g);
  const b = pdfPointToDisplay({ x: r.x + r.w, y: r.y + r.h }, g);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/**
 * Content-stream CTM that maps the *display frame* onto page user space.
 *
 * The display frame is display space with a y-up flip: origin at the
 * display's bottom-left corner, x right, y up — i.e. exactly the coordinates
 * rotation-0 drawing code produces from a display rect via
 * `y = displayHeight − top − h`. Pushing
 * `concatTransformationMatrix(...displayToPdfMatrix(g))` lets all content
 * (text, shapes, images, ink) be drawn with plain rotation-0 math and come
 * out correctly placed *and oriented* on rotated and/or crop-offset pages.
 *
 * Note: annotation dictionaries (/Rect of links, notes, form widgets) are not
 * affected by the content stream CTM — those must go through
 * `displayRectToPdf` instead.
 */
export function displayToPdfMatrix(g: PageGeometry): Matrix {
  const { x: ox, y: oy, width: W, height: H } = g.box;
  switch (g.rotation) {
    case 90:
      return [0, 1, -1, 0, ox + W, oy];
    case 180:
      return [-1, 0, 0, -1, ox + W, oy + H];
    case 270:
      return [0, -1, 1, 0, ox, oy + H];
    default:
      return [1, 0, 0, 1, ox, oy];
  }
}

/** True when the matrix is the identity (no CTM push needed). */
export function isIdentityMatrix(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** Apply a content-stream matrix to a point (used by tests and callers). */
export function applyMatrix(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

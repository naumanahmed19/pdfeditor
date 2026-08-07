// Paragraph reflow for the in-place text editor. Pure text/measure logic —
// no DOM, no PDFium — so the wrap decisions are unit-testable. The commit
// path in PageView calls planReflow() with the committed editor lines; a
// non-null result is the paragraph's new line layout, written back via
// reflowTextLines() in lib/pdfium.
//
// Line breaks inside a reflowable paragraph are SOFT: they exist because the
// text hit the column edge, not because the author pressed Enter. So a
// committed newline is treated as a word separator and the final breaks are
// recomputed from the paragraph width — the editor's Shift+Enter merely
// splits a line knowing the wrap will settle where it must.

/** Width of a string in PDF points (at the paragraph's font and size). */
export type Measure = (s: string) => number;

export interface ReflowLineBox {
  text: string;
  originX: number;
  originY: number;
}

export interface ReflowObstacle {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * Measured widths drift slightly between our metrics (fontkit advances or a
 * canvas fallback) and the PDF's own layout (TJ kerning adjustments), so a
 * line that visually fits can measure a hair over the column width. Wrapping
 * accepts that hair rather than spuriously re-breaking untouched text.
 */
const WIDTH_TOLERANCE = 1.015;

/**
 * Join editor lines back into flowing text. A soft break becomes a single
 * space; a line ending in "-" joins bare so an end-of-line hyphenation
 * ("under-" / "stand") doesn't gain a space mid-word. The hyphen itself is
 * kept — un-hyphenating would need a dictionary to tell "under-stand" from
 * "well-known".
 */
export function joinSoftBreaks(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!line) continue;
    if (!out) out = line;
    else if (out.endsWith("-")) out += line;
    else out += " " + line;
  }
  return out;
}

/**
 * Greedy word wrap: pack words onto a line while they fit `maxWidth` (plus
 * the shared tolerance), break before the word that doesn't. A single word
 * wider than the column gets its own overflowing line — chopping words
 * needs hyphenation rules we don't have.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const words = text.split(/[ \t]+/).filter(Boolean);
  if (!words.length) return [];
  const limit = maxWidth * WIDTH_TOLERANCE;
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (measure(w) > limit) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const pieces: string[] = [];
      let piece = "";
      for (const char of Array.from(w)) {
        const candidate = piece + char;
        if (piece && measure(candidate) > limit) {
          pieces.push(piece);
          piece = char;
        } else {
          piece = candidate;
        }
      }
      if (piece) pieces.push(piece);
      lines.push(...pieces.slice(0, -1));
      line = pieces.at(-1) ?? "";
      continue;
    }
    const candidate = line ? line + " " + w : w;
    if (!line || measure(candidate) <= limit) {
      line = candidate;
    } else {
      lines.push(line);
      line = w;
    }
  }
  lines.push(line);
  return lines;
}

/** True when any newly planned line would paint over existing page text. */
export function reflowWouldOverlap(
  lines: ReflowLineBox[],
  fontSize: number,
  measure: Measure,
  obstacles: ReflowObstacle[],
): boolean {
  return lines.some((line) => {
    if (!line.text.trim()) return false;
    const box = {
      left: line.originX,
      right: line.originX + measure(line.text),
      bottom: line.originY - fontSize * 0.25,
      top: line.originY + fontSize * 0.9,
    };
    return obstacles.some(
      (obstacle) =>
        box.right > obstacle.left &&
        box.left < obstacle.right &&
        box.top > obstacle.bottom &&
        box.bottom < obstacle.top,
    );
  });
}

/**
 * Decide whether a committed paragraph edit needs reflow, and compute the
 * final line layout when it does. Returns null when the committed lines
 * already match the original structure — same line count and no CHANGED line
 * overflowing — so the caller can keep today's minimal per-run diff path
 * (which preserves untouched runs byte-for-byte). Unchanged lines only
 * rewrap when `force` is true because the user explicitly resized the column;
 * otherwise their breaks are the document's own layout, not ours to guess.
 *
 * When reflow is needed, lines above the first change are kept verbatim and
 * everything from the first changed line onward is rejoined and rewrapped to
 * the paragraph width.
 */
export function planReflow(
  oldLines: string[],
  committedLines: string[],
  maxWidth: number,
  measure: Measure,
  force = false,
): string[] | null {
  const structural = committedLines.length !== oldLines.length;
  const overflow = committedLines.some(
    (l, i) => l !== oldLines[i] && measure(l) > maxWidth * WIDTH_TOLERANCE,
  );
  // A deletion that leaves a CHANGED non-final line with room for the next
  // line's first word means text below should pull up. Exact, not heuristic:
  // soft breaks only exist at the column edge, so "next word fits" is the
  // definition of a stale break.
  const pullUp = committedLines.some((l, i) => {
    if (i >= committedLines.length - 1 || l === oldLines[i]) return false;
    const next = committedLines[i + 1].trimStart().split(/[ \t]+/)[0];
    if (!next) return false;
    const line = l.replace(/[ \t]+$/, "");
    const joined = line.endsWith("-") ? line + next : line + " " + next;
    return measure(joined) <= maxWidth * WIDTH_TOLERANCE;
  });
  if (!force && !structural && !overflow && !pullUp) return null;

  let firstChanged = 0;
  const common = Math.min(oldLines.length, committedLines.length);
  while (
    !force &&
    firstChanged < common &&
    committedLines[firstChanged] === oldLines[firstChanged]
  ) {
    firstChanged++;
  }

  const prefix = committedLines.slice(0, firstChanged);
  const tail = joinSoftBreaks(committedLines.slice(firstChanged));
  const final = tail ? [...prefix, ...wrapText(tail, maxWidth, measure)] : prefix;

  if (
    final.length === oldLines.length &&
    final.every((l, i) => l === oldLines[i])
  ) {
    return null; // the wrap settles back into the original layout
  }
  return final;
}

/**
 * Build a Measure for the paragraph's face: fontkit advances over the real
 * embedded font program when it parses (exact widths, kerning included),
 * otherwise 2D-canvas measureText with the CSS family the editor displays —
 * an approximation, but the same one the user is looking at. Canvas measures
 * `${size}px` and px-at-1:1 equals pt numerically.
 */
export async function makeParagraphMeasure(
  fontData: Uint8Array | null,
  cssFamily: string,
  fontSize: number,
): Promise<Measure> {
  if (fontData) {
    try {
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      const font = fontkit.create(fontData) as unknown as {
        layout?: (s: string) => { advanceWidth: number };
        unitsPerEm?: number;
      };
      const upm = font.unitsPerEm;
      if (typeof font.layout === "function" && upm) {
        const scale = fontSize / upm;
        return (s) => font.layout!(s).advanceWidth * scale;
      }
    } catch {
      /* bare CFF/CID subsets fontkit can't parse — fall through to canvas */
    }
  }
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (s) => s.length * fontSize * 0.5; // headless last resort
  ctx.font = `${fontSize}px ${cssFamily}`;
  return (s) => ctx.measureText(s).width;
}

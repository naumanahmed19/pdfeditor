// Document comparison primitives: a word-level diff (LCS) for text changes and
// a pixel diff for visual changes. Both operate per page so a whole-document
// compare stays responsive.
import { renderPage } from "./pdfium";

export type DiffType = "eq" | "add" | "del";
export interface DiffPart {
  type: DiffType;
  text: string;
}

/**
 * Word-level diff of two strings via longest-common-subsequence. Whitespace is
 * kept as its own tokens so spacing is preserved in the rendered output.
 */
export function diffWords(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/).filter((s) => s.length);
  const B = b.split(/(\s+)/).filter((s) => s.length);
  const n = A.length;
  const m = B.length;
  // dp[i][j] = LCS length of A[i..] and B[j..].
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (type: DiffType, text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("eq", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", A[i]);
      i++;
    } else {
      push("add", B[j]);
      j++;
    }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}

/** True when the two documents' text for a page differs at all. */
export function hasTextChange(parts: DiffPart[]): boolean {
  return parts.some((p) => p.type !== "eq");
}

export interface PixelDiff {
  width: number;
  height: number;
  /** RGBA overlay: changed pixels tinted red on a faded grayscale base. */
  rgba: Uint8ClampedArray;
  /** Fraction of pixels that changed (0–1). */
  changed: number;
}

/**
 * Rasterize the same page index of both documents at a matched scale and build
 * a diff image: unchanged content faded to light gray, changed pixels tinted
 * red. Pages are compared on a common canvas sized to the larger of the two.
 */
export async function pixelDiffPage(
  bytesA: Uint8Array,
  bytesB: Uint8Array,
  pageIndex: number,
  scale = 1.5,
  threshold = 32,
): Promise<PixelDiff> {
  const [a, b] = await Promise.all([
    renderPage(bytesA, pageIndex, scale),
    renderPage(bytesB, pageIndex, scale),
  ]);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  const total = width * height;

  const at = (img: typeof a, x: number, y: number): [number, number, number] => {
    if (x >= img.width || y >= img.height) return [255, 255, 255];
    const i = (y * img.width + x) * 4;
    return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [ar, ag, ab] = at(a, x, y);
      const [br, bg, bb] = at(b, x, y);
      const d = Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
      const o = (y * width + x) * 4;
      if (d > threshold) {
        // Changed: strong red, weighted by how dark the "new" (B) pixel is so
        // added ink reads clearly.
        const ink = 255 - Math.min(br, bg, bb);
        out[o] = 220;
        out[o + 1] = 40 + (255 - ink) * 0.3;
        out[o + 2] = 40 + (255 - ink) * 0.3;
        out[o + 3] = 255;
        changed++;
      } else {
        // Unchanged: fade toward white so changes pop.
        const gray = Math.round((br + bg + bb) / 3);
        const faded = Math.round(gray + (255 - gray) * 0.72);
        out[o] = faded;
        out[o + 1] = faded;
        out[o + 2] = faded;
        out[o + 3] = 255;
      }
    }
  }
  return { width, height, rgba: out, changed: changed / total };
}

type Rgb = [number, number, number];

export interface TextBackdrop {
  color: string;
  /** Local background reconstruction for non-uniform page artwork. */
  image?: string;
  width: number;
  height: number;
}

function compositeOverWhite(r: number, g: number, b: number, a: number): Rgb {
  const alpha = a / 255;
  return [
    Math.round(r * alpha + 255 * (1 - alpha)),
    Math.round(g * alpha + 255 * (1 - alpha)),
    Math.round(b * alpha + 255 * (1 - alpha)),
  ];
}

/**
 * Find the dominant painted color in a canvas crop. Quantizing first keeps
 * antialiasing and compression noise from splitting one flat PDF background
 * into many nearly-identical colors.
 */
export function dominantBackdropColor(
  pixels: Uint8ClampedArray,
  maxSamples = 4096,
  inkColor?: string,
): string | null {
  const pixelCount = Math.floor(pixels.length / 4);
  if (!pixelCount) return null;

  const stride = Math.max(1, Math.floor(pixelCount / maxSamples));
  const buckets = new Map<number, [number, number, number, number]>();
  const normalizedInk = inkColor ?? "";
  const ink = /^#[0-9a-f]{6}$/i.test(normalizedInk)
    ? [
        parseInt(normalizedInk.slice(1, 3), 16),
        parseInt(normalizedInk.slice(3, 5), 16),
        parseInt(normalizedInk.slice(5, 7), 16),
      ]
    : null;
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const [r, g, b] = compositeOverWhite(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      pixels[offset + 3],
    );
    // The canvas still contains the original glyphs. Never let those pixels
    // become the replacement surface, even when dense lettering occupies
    // more of a very tight object box than the surrounding background.
    if (
      ink &&
      (r - ink[0]) ** 2 + (g - ink[1]) ** 2 + (b - ink[2]) ** 2 < 64 ** 2
    ) {
      continue;
    }
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? [0, 0, 0, 0];
    bucket[0] += 1;
    bucket[1] += r;
    bucket[2] += g;
    bucket[3] += b;
    buckets.set(key, bucket);
  }

  let best: [number, number, number, number] | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket[0] > best[0]) best = bucket;
  }
  if (!best) return null;
  return `rgb(${Math.round(best[1] / best[0])}, ${Math.round(best[2] / best[0])}, ${Math.round(best[3] / best[0])})`;
}

/** Pick a readable emergency surface if canvas sampling is unavailable. */
export function fallbackBackdropForInk(colorHex: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(colorHex) ? colorHex.slice(1) : "000000";
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const linear = (channel: number) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.18 ? "rgb(17, 17, 17)" : "rgb(255, 255, 255)";
}

function parseRgb(color: string): Rgb | null {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
}

/**
 * Build a small SVG mosaic from local background estimates. It replaces ink
 * pixels inside each cell with that cell's dominant non-ink color, preserving
 * gradients and artwork instead of painting one solid rectangle over them.
 */
export function mosaicBackdropImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  inkColor: string,
): string | undefined {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return;
  const columns = Math.max(2, Math.min(12, Math.ceil(width / 48)));
  const rows = Math.max(2, Math.min(12, Math.ceil(height / 36)));
  const fallback = dominantBackdropColor(pixels, 4096, inkColor);
  if (!fallback) return;
  const colors: string[] = [];
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
    for (let column = 0; column < columns; column++) {
      const x0 = Math.floor((column * width) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * width) / columns));
      const cell = new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4);
      let offset = 0;
      for (let y = y0; y < y1; y++) {
        const start = (y * width + x0) * 4;
        const end = (y * width + x1) * 4;
        cell.set(pixels.subarray(start, end), offset);
        offset += end - start;
      }
      colors.push(dominantBackdropColor(cell, 1024, inkColor) ?? fallback);
    }
  }
  const parsed = colors.map(parseRgb).filter((color): color is Rgb => !!color);
  if (!parsed.length) return;
  const first = parsed[0];
  const varied = parsed.some(
    (color) =>
      (color[0] - first[0]) ** 2 +
        (color[1] - first[1]) ** 2 +
        (color[2] - first[2]) ** 2 >
      24 ** 2,
  );
  if (!varied) return;
  const rects = colors
    .map((fill, index) => {
      const x = index % columns;
      const y = Math.floor(index / columns);
      return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${rows}" preserveAspectRatio="none">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function sampleTextBackdrop(
  canvas: HTMLCanvasElement | null,
  rect: { left: number; top: number; width: number; height: number },
  page: { width: number; height: number },
  inkColor: string,
): TextBackdrop {
  const fallback = fallbackBackdropForInk(inkColor);
  const empty = { color: fallback, width: rect.width, height: rect.height };
  if (!canvas || page.width <= 0 || page.height <= 0) return empty;

  try {
    const scaleX = canvas.width / page.width;
    const scaleY = canvas.height / page.height;
    const left = Math.max(0, Math.floor(rect.left * scaleX));
    const top = Math.max(0, Math.floor(rect.top * scaleY));
    const width = Math.max(
      1,
      Math.min(
        canvas.width - left,
        Math.ceil(rect.width * scaleX),
      ),
    );
    const height = Math.max(
      1,
      Math.min(
        canvas.height - top,
        Math.ceil(rect.height * scaleY),
      ),
    );
    const context = canvas.getContext("2d");
    if (!context || width <= 0 || height <= 0) return empty;
    const pixels = context.getImageData(left, top, width, height).data;
    return {
      color: dominantBackdropColor(pixels, 4096, inkColor) ?? fallback,
      image: mosaicBackdropImage(pixels, width, height, inkColor),
      width: rect.width,
      height: rect.height,
    };
  } catch {
    return empty;
  }
}

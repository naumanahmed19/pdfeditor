import { describe, expect, it, vi } from "vitest";
import {
  dominantBackdropColor,
  fallbackBackdropForInk,
  mosaicBackdropImage,
  sampleTextBackdrop,
} from "./textBackdrop";

describe("text editor backdrop", () => {
  it("keeps the page background when sparse light glyph pixels are present", () => {
    const pixels = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
      const offset = i * 4;
      const whiteGlyph = i % 6 === 0;
      pixels.set(whiteGlyph ? [255, 255, 255, 255] : [4, 105, 87, 255], offset);
    }

    expect(dominantBackdropColor(pixels, 4096, "#ffffff")).toBe(
      "rgb(4, 105, 87)",
    );
  });

  it("composites transparent canvas pixels over the viewer's white page", () => {
    expect(dominantBackdropColor(new Uint8ClampedArray([0, 0, 0, 0]))).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("uses a contrasting fallback for light and dark PDF ink", () => {
    expect(fallbackBackdropForInk("#ffffff")).toBe("rgb(17, 17, 17)");
    expect(fallbackBackdropForInk("#000000")).toBe("rgb(255, 255, 255)");
  });

  it("samples the scaled click neighborhood from the page canvas", () => {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels.set([0, 96, 74, 255], i);
    }
    const getImageData = vi.fn(() => ({ data: pixels }));
    const canvas = {
      width: 200,
      height: 200,
      getContext: () => ({ getImageData }),
    } as unknown as HTMLCanvasElement;

    expect(
      sampleTextBackdrop(
        canvas,
        { left: 10, top: 10, width: 12, height: 12 },
        { width: 100, height: 100 },
        "#ffffff",
      ),
    ).toEqual({
      color: "rgb(0, 96, 74)",
      image: undefined,
      width: 12,
      height: 12,
    });
    expect(getImageData).toHaveBeenCalledWith(20, 20, 24, 24);
  });

  it("preserves non-uniform artwork with a local mosaic instead of one flat fill", () => {
    const pixels = new Uint8ClampedArray(96 * 48 * 4);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 96; x++) {
        const offset = (y * 96 + x) * 4;
        pixels.set(x < 48 ? [15, 90, 130, 255] : [190, 130, 40, 255], offset);
      }
    }
    const image = mosaicBackdropImage(pixels, 96, 48, "#ffffff");
    expect(image).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(decodeURIComponent(image!)).toContain("rgb(15, 90, 130)");
    expect(decodeURIComponent(image!)).toContain("rgb(190, 130, 40)");
  });
});

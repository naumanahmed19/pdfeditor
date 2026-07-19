// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfDoc } from "./pdf";

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(async () => ({
    data: {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: "Recognized", confidence: 95, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  })),
  terminate: vi.fn(async () => {}),
}));

vi.mock("tesseract.js", () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: vi.fn(async () => ({
    recognize: mocks.recognize,
    terminate: mocks.terminate,
  })),
}));

afterEach(() => vi.restoreAllMocks());

describe("runOcrPages", () => {
  it("renders and recognizes only the requested page", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const getPage = vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }));
    const pdf = { numPages: 500, getPage } as unknown as PdfDoc;
    const { runOcrPages } = await import("./ocr");

    const result = await runOcrPages(pdf, [86]);

    expect(getPage).toHaveBeenCalledOnce();
    expect(getPage).toHaveBeenCalledWith(87);
    expect(result).toEqual([
      expect.objectContaining({
        pageIndex: 86,
        words: [expect.objectContaining({ text: "Recognized" })],
      }),
    ]);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
});

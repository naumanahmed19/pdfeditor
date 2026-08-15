// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareScreen } from "./CompareScreen";

const renderPageToCanvas = vi.hoisted(() => vi.fn(async () => undefined));
const comparisonPdf = vi.hoisted(() => ({
  numPages: 2,
  page: vi.fn(() => ({ width: 400, height: 600 })),
}));
const app = vi.hoisted(() => ({
  pdf: {
    numPages: 4,
    page: vi.fn(() => ({ width: 400, height: 600 })),
  },
  numPages: 4,
  docVersion: 1,
  docBytes: new Uint8Array([1, 2, 3]),
  docName: "report.pdf",
  openFile: vi.fn(),
  setScreen: vi.fn(),
}));

vi.mock("../../store", () => ({ useApp: () => app }));

vi.mock("../../lib/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pdf")>();
  return {
    ...actual,
    renderPageToCanvas,
    loadPdf: vi.fn(async () => comparisonPdf),
    extractAllText: vi.fn(async (pdf) =>
      pdf === app.pdf
        ? [
            { full: "Original first page" },
            { full: "Original second page" },
            { full: "Original third page" },
            { full: "Original fourth page" },
          ]
        : [{ full: "Changed first page" }, { full: "Original second page" }],
    ),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Compare workspace", () => {
  it("shows the current PDF preview beside comparison controls and keeps both diff modes", async () => {
    const { container } = render(<CompareScreen />);

    const workspace = screen.getByTestId("compare-workspace");
    const preview = screen.getByTestId("compare-page-preview");
    const controls = screen.getByTestId("compare-controls");
    expect(workspace.firstElementChild?.contains(preview)).toBe(true);
    expect(workspace.lastElementChild).toBe(controls);
    expect(screen.getByRole("button", { name: "Choose the PDF to compare against" })).toBeTruthy();
    await waitFor(() =>
      expect(renderPageToCanvas).toHaveBeenCalledWith(app.pdf, 0, expect.anything(), expect.any(Number)),
    );

    const file = new File([new Uint8Array([4, 5, 6])], "comparison.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([4, 5, 6]).buffer,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("comparison.pdf")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Text diff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pixel diff" })).toBeTruthy();
    expect(screen.getByText("Text differs on this page")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 / 4")).toBeTruthy();
    await waitFor(() =>
      expect(renderPageToCanvas).toHaveBeenLastCalledWith(app.pdf, 1, expect.anything(), expect.any(Number)),
    );
  });
});

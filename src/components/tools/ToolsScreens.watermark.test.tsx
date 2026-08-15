// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatermarkScreen } from "./ToolsScreens";

const renderPageToCanvas = vi.hoisted(() => vi.fn(async () => undefined));
const app = vi.hoisted(() => ({
  pdf: {
    page: vi.fn(() => ({ width: 400, height: 600 })),
  },
  numPages: 2,
  docVersion: 1,
  docBytes: new Uint8Array([1, 2, 3]),
  screen: "watermark",
  applyBytesOp: vi.fn(),
  downloadCurrent: vi.fn(),
  openFile: vi.fn(),
  setScreen: vi.fn(),
}));

vi.mock("../../store", () => ({ useApp: () => app }));

vi.mock("../../lib/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pdf")>();
  return {
    ...actual,
    renderPageToCanvas,
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

describe("Watermark workspace", () => {
  it("shows a live page preview beside watermark and page-number controls", async () => {
    render(<WatermarkScreen />);

    const workspace = screen.getByTestId("watermark-workspace");
    const preview = screen.getByTestId("watermark-page-preview");
    const controls = screen.getByTestId("watermark-controls");
    expect(workspace.firstElementChild?.contains(preview)).toBe(true);
    expect(workspace.lastElementChild).toBe(controls);
    await waitFor(() => expect(renderPageToCanvas).toHaveBeenCalledWith(app.pdf, 0, expect.anything(), expect.any(Number)));

    const watermark = screen.getByTestId("watermark-preview-text");
    expect(watermark.textContent).toBe("CONFIDENTIAL");
    expect(watermark.style.transform).toContain("rotate(-45deg)");
    expect(screen.getByTestId("page-number-preview-text").textContent).toBe("1 / 2");

    fireEvent.change(screen.getByPlaceholderText("Watermark text"), {
      target: { value: "APPROVED" },
    });
    expect(screen.getByTestId("watermark-preview-text").textContent).toBe("APPROVED");

    fireEvent.click(screen.getByRole("checkbox", { name: "Diagonal watermark" }));
    expect(screen.getByTestId("watermark-preview-text").style.transform).toContain("rotate(0deg)");

    expect(screen.getByRole("combobox", { name: "Page number position" }).textContent).toContain(
      "Bottom center",
    );
    expect(screen.getByTestId("page-number-preview-text").style.left).toBe("50%");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByTestId("page-number-preview-text").textContent).toBe("2 / 2");
    await waitFor(() => expect(renderPageToCanvas).toHaveBeenLastCalledWith(app.pdf, 1, expect.anything(), expect.any(Number)));

    fireEvent.click(screen.getByRole("button", { name: "Apply watermark" }));
    fireEvent.click(screen.getByRole("button", { name: "Add page numbers" }));
    expect(app.applyBytesOp).toHaveBeenCalledTimes(2);
  });
});

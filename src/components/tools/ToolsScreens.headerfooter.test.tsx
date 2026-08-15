// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderFooterScreen } from "./ToolsScreens";

const renderPageToCanvas = vi.hoisted(() => vi.fn(async () => undefined));
const app = vi.hoisted(() => ({
  pdf: {
    page: vi.fn(() => ({ width: 400, height: 600 })),
  },
  numPages: 3,
  docVersion: 1,
  docBytes: new Uint8Array([1, 2, 3]),
  screen: "headerfooter",
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

describe("Headers and footers workspace", () => {
  it("previews expanded header and footer slots beside the controls", async () => {
    render(<HeaderFooterScreen />);

    const workspace = screen.getByTestId("header-footer-workspace");
    const preview = screen.getByTestId("header-footer-page-preview");
    const controls = screen.getByTestId("header-footer-controls");
    expect(workspace.firstElementChild?.contains(preview)).toBe(true);
    expect(workspace.lastElementChild).toBe(controls);
    await waitFor(() =>
      expect(renderPageToCanvas).toHaveBeenCalledWith(app.pdf, 0, expect.anything(), expect.any(Number)),
    );

    expect(screen.getByTestId("header-footer-preview-footerCenter").textContent).toBe("1 / 3");
    fireEvent.change(screen.getAllByPlaceholderText("—")[0], {
      target: { value: "REPORT" },
    });
    expect(screen.getByTestId("header-footer-preview-headerLeft").textContent).toBe("REPORT");

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Bates numbering" }));
    expect(screen.getByTestId("header-footer-preview-footerRight").textContent).toBe("000001");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 / 3")).toBeTruthy();
    expect(screen.getByTestId("header-footer-preview-footerCenter").textContent).toBe("2 / 3");
    expect(screen.getByTestId("header-footer-preview-footerRight").textContent).toBe("000002");

    fireEvent.change(screen.getByPlaceholderText("all"), { target: { value: "1" } });
    expect(screen.getByText("Not included in page range")).toBeTruthy();
    expect(screen.queryByTestId("header-footer-preview-footerCenter")).toBeNull();
  });
});

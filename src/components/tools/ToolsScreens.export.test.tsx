// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportScreen } from "./ToolsScreens";

const renderPageToCanvas = vi.hoisted(() => vi.fn(async () => undefined));
const app = vi.hoisted(() => ({
  pdf: {
    page: vi.fn(() => ({ width: 400, height: 600 })),
  },
  numPages: 4,
  docVersion: 1,
  docBytes: new Uint8Array([1, 2, 3]),
  docName: "report.pdf",
  screen: "export",
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

describe("Export workspace", () => {
  it("shows a navigable document preview beside all export formats", async () => {
    render(<ExportScreen />);

    const workspace = screen.getByTestId("export-workspace");
    const preview = screen.getByTestId("export-page-preview");
    const controls = screen.getByTestId("export-controls");
    expect(workspace.firstElementChild?.contains(preview)).toBe(true);
    expect(workspace.lastElementChild).toBe(controls);
    await waitFor(() =>
      expect(renderPageToCanvas).toHaveBeenCalledWith(app.pdf, 0, expect.anything(), expect.any(Number)),
    );

    expect(screen.getByRole("button", { name: "Export text" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export HTML" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export Word" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export PNGs (zip)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 / 4")).toBeTruthy();
    await waitFor(() =>
      expect(renderPageToCanvas).toHaveBeenLastCalledWith(app.pdf, 1, expect.anything(), expect.any(Number)),
    );
  });
});

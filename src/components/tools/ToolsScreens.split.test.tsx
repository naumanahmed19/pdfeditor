// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitScreen } from "./ToolsScreens";

const app = vi.hoisted(() => ({
  pdf: {
    numPages: 3,
    page: vi.fn(() => ({ width: 400, height: 600 })),
  } as { numPages: number; page: ReturnType<typeof vi.fn> } | null,
  numPages: 3,
  docVersion: 1,
  docBytes: new Uint8Array([1, 2, 3]) as Uint8Array | null,
  docName: "report.pdf",
  screen: "split",
  openBytes: vi.fn(),
  openFile: vi.fn(),
  setScreen: vi.fn(),
}));

vi.mock("../../store", () => ({ useApp: () => app }));

vi.mock("../layout/Sidebar", () => ({
  Thumbnail: ({ pageIndex, active }: { pageIndex: number; active?: boolean }) => (
    <div data-testid={`page-thumbnail-${pageIndex}`} data-active={active || undefined}>
      Page {pageIndex + 1} preview
    </div>
  ),
}));

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
  app.pdf = {
    numPages: 3,
    page: vi.fn(() => ({ width: 400, height: 600 })),
  };
  app.docBytes = new Uint8Array([1, 2, 3]);
});

const renderSplit = () =>
  render(
    <>
      <div id="tool-header-actions" />
      <SplitScreen />
    </>,
  );

describe("Split and extract workspace", () => {
  it("shows every PDF page in a selectable grid with actions in the top bar", async () => {
    renderSplit();

    expect(screen.getByTestId("split-workspace")).toBeTruthy();
    expect(screen.getByTestId("split-page-grid")).toBeTruthy();
    expect(screen.getAllByTestId("split-page-card")).toHaveLength(3);
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText("3 pages")).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Change PDF" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Split all" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Extract selected" })).toBeNull();

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(await screen.findByText("3 selected")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/selected$/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Page 1" }));
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open selected" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extract selected" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Page 3" }), { ctrlKey: true });
    expect(await screen.findByText("2 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(await screen.findByText("3 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();
  });

  it("can open as a generic tool without a document", () => {
    app.pdf = null;
    app.docBytes = null;

    renderSplit();

    expect(screen.getByTestId("split-empty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a PDF to split" })).toBeTruthy();
    expect(screen.queryByTestId("split-page-grid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Split all" })).toBeNull();
  });
});

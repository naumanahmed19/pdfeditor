// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropZone } from "../layout/DropZone";
import { MergeScreen, SplitScreen } from "./ToolsScreens";
import { TOOL_HEADER_ACTIONS_ID } from "./ToolPageHeader";
import { TOOL_SIDEBAR_CONTENT_ID } from "./ToolFileSidebar";

const app = vi.hoisted(() => ({
  docBytes: null as Uint8Array | null,
  pdf: null,
  screen: "merge",
  openBytes: vi.fn(async () => "merged"),
  openFile: vi.fn(async () => "opened"),
  setScreen: vi.fn(),
}));

vi.mock("../../store", () => ({
  useApp: () => app,
  useAppSelector: (selector: (state: typeof app) => unknown) => selector(app),
}));

vi.mock("../layout/Sidebar", () => ({
  Thumbnail: () => <div data-testid="pdf-thumbnail" />,
}));

vi.mock("../../lib/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pdf")>();
  return {
    ...actual,
    loadPdf: vi.fn(async () => ({ numPages: 1 })),
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const droppedFile = (name: string, type: string) => {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  });
  return file;
};

const dataTransfer = (files: File[]) => ({
  files,
  items: [],
  types: ["Files"],
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  app.docBytes = null;
  app.pdf = null;
  app.screen = "merge";
});

describe("tool page file drops", () => {
  it("adds every supported dropped file to the Merge list without opening editor tabs", async () => {
    const files = [
      droppedFile("one.pdf", "application/pdf"),
      droppedFile("two.pdf", "application/pdf"),
      droppedFile("cover.png", "image/png"),
    ];
    render(
      <>
        <div id={TOOL_HEADER_ACTIONS_ID} data-testid={TOOL_HEADER_ACTIONS_ID} />
        <div id={TOOL_SIDEBAR_CONTENT_ID} data-testid={TOOL_SIDEBAR_CONTENT_ID} />
        <MergeScreen />
        <DropZone />
      </>,
    );
    expect(screen.getByTestId("file-collection-empty")).toBeTruthy();
    expect(screen.getByTestId("tool-page-content").getAttribute("data-layout-width")).toBe("full");
    expect(screen.queryByRole("heading", { name: "Merge PDFs" })).toBeNull();
    expect(screen.getByTestId("tool-file-sidebar")).toBeTruthy();
    expect(screen.getByText(/No merge files yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Merge & download" })).toBeNull();

    fireEvent.drop(screen.getByTestId("tool-drop-surface"), {
      dataTransfer: dataTransfer(files),
    });

    await waitFor(() => expect(screen.getAllByText("one.pdf")).toHaveLength(2));
    expect(screen.queryByTestId("file-collection-empty")).toBeNull();
    expect(screen.getAllByText("two.pdf")).toHaveLength(2);
    expect(screen.getAllByText("cover.png")).toHaveLength(2);
    expect(screen.getAllByTestId("pdf-thumbnail")).toHaveLength(2);
    expect(screen.getAllByTestId("tool-sidebar-file")).toHaveLength(3);
    expect(screen.getAllByTestId("tool-sidebar-file")[0].querySelector('[data-file-icon="pdf"]')).toBeTruthy();
    expect(screen.getAllByTestId("tool-sidebar-file")[2].querySelector('[data-file-icon="png"]')).toBeTruthy();
    expect(screen.getAllByTestId("tool-sidebar-file")[0].getAttribute("data-selected")).toBe("true");
    expect(screen.getAllByTestId("file-collection-item")[0].getAttribute("data-selected")).toBe("true");
    fireEvent.click(screen.getAllByTestId("tool-sidebar-file")[1]);
    expect(screen.getAllByTestId("tool-sidebar-file")[1].getAttribute("data-selected")).toBe("true");
    expect(screen.getAllByTestId("file-collection-item")[1].getAttribute("data-selected")).toBe("true");
    expect(app.openFile).not.toHaveBeenCalled();
    const actionsHost = screen.getByTestId(TOOL_HEADER_ACTIONS_ID);
    expect(actionsHost.contains(screen.getByRole("button", { name: "Merge & download" }))).toBe(true);
    expect(actionsHost.contains(screen.getByRole("button", { name: "Merge & open here" }))).toBe(true);
    expect(screen.getByTestId("file-collection-add").textContent).toContain("Add more PDFs or images");
    expect(screen.queryByRole("button", { name: "Add PDFs / images" })).toBeNull();

    expect(screen.queryByRole("button", { name: "List view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();
    expect(screen.getAllByTestId("file-collection-item")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Rotate one.pdf clockwise" }));
    expect(screen.getAllByText(/90°/)).toHaveLength(2);
    expect(screen.getAllByTestId("merge-file-preview")[0].getAttribute("data-rotation")).toBe("90");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate one.pdf" }));
    expect(screen.getAllByText("one.pdf")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Remove cover.png" }));
    expect(screen.getByRole("alertdialog", { name: "Remove this file?" })).toBeTruthy();
    expect(screen.getAllByText("cover.png")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.queryByText("cover.png")).toBeNull();
    expect(screen.getAllByTestId("tool-sidebar-file")[2].getAttribute("data-selected")).toBe("true");
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select one.pdf" })[0]);
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(actionsHost.contains(screen.getByRole("button", { name: "Rotate selected files" }))).toBe(true);
    expect(actionsHost.contains(screen.getByRole("button", { name: "Delete selected files" }))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Rotate selected files" }));
    expect(screen.getAllByTestId("merge-file-preview")[0].getAttribute("data-rotation")).toBe("180");

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected files" }));
    expect(screen.getByRole("alertdialog", { name: "Remove 3 files?" })).toBeTruthy();
    expect(screen.getAllByTestId("file-collection-item")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected files" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove files" }));
    expect(screen.getByTestId("file-collection-empty")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Merge & download" })).toBeNull();
  });

  it("loads a dropped PDF into a single-document tool and keeps that tool active", async () => {
    app.screen = "split";
    const file = droppedFile("report.pdf", "application/pdf");
    render(
      <>
        <SplitScreen />
        <DropZone />
      </>,
    );

    fireEvent.drop(screen.getByTestId("tool-drop-surface"), {
      dataTransfer: dataTransfer([file]),
    });

    await waitFor(() => expect(app.openFile).toHaveBeenCalledTimes(1));
    expect(app.openFile).toHaveBeenCalledWith(file, undefined);
    expect(app.setScreen).toHaveBeenCalledWith("split");
  });

  it("supports select-all, modifier-click ranges, and delete keyboard shortcuts", async () => {
    render(
      <>
        <div id={TOOL_HEADER_ACTIONS_ID} data-testid={TOOL_HEADER_ACTIONS_ID} />
        <div id={TOOL_SIDEBAR_CONTENT_ID} data-testid={TOOL_SIDEBAR_CONTENT_ID} />
        <MergeScreen />
      </>,
    );

    fireEvent.drop(screen.getByTestId("tool-drop-surface"), {
      dataTransfer: dataTransfer([
        droppedFile("first.pdf", "application/pdf"),
        droppedFile("second.pdf", "application/pdf"),
        droppedFile("third.pdf", "application/pdf"),
      ]),
    });
    await waitFor(() => expect(screen.getAllByTestId("tool-sidebar-file")).toHaveLength(3));

    const checkbox = screen.getAllByRole("checkbox", { name: "Select first.pdf" })[0];
    expect(checkbox.className).toContain("cursor-pointer");

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/selected$/)).toBeNull();

    const sidebarFiles = screen.getAllByTestId("tool-sidebar-file");
    fireEvent.click(sidebarFiles[0], { ctrlKey: true });
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(sidebarFiles[2], { shiftKey: true });
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByRole("alertdialog", { name: "Remove 3 files?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove files" }));
    expect(screen.getByTestId("file-collection-empty")).toBeTruthy();
  });
});

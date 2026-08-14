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

    fireEvent.click(screen.getByRole("button", { name: "Duplicate one.pdf" }));
    expect(screen.getAllByText("one.pdf")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Remove cover.png" }));
    expect(screen.queryByText("cover.png")).toBeNull();
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
});

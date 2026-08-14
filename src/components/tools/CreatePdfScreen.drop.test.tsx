// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagesToPdfScreen } from "./CreatePdfScreen";
import { TOOL_HEADER_ACTIONS_ID } from "./ToolPageHeader";
import { TOOL_SIDEBAR_CONTENT_ID } from "./ToolFileSidebar";

const app = vi.hoisted(() => ({
  openBytes: vi.fn(async () => "created"),
}));

vi.mock("../../store", () => ({ useApp: () => app }));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const imageFile = (name: string, type: string) => {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  });
  return file;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Images-to-PDF collection view", () => {
  it("shares grid, duplicate, remove, and ordering controls with Merge", async () => {
    render(
      <>
        <div id={TOOL_HEADER_ACTIONS_ID} data-testid={TOOL_HEADER_ACTIONS_ID} />
        <div id={TOOL_SIDEBAR_CONTENT_ID} data-testid={TOOL_SIDEBAR_CONTENT_ID} />
        <ImagesToPdfScreen />
      </>,
    );
    const root = screen.getByTestId("tool-drop-surface");
    expect(screen.getByTestId("file-collection-empty")).toBeTruthy();
    expect(screen.getByTestId("tool-page-content").getAttribute("data-layout-width")).toBe("full");
    expect(screen.queryByRole("heading", { name: "Images to PDF" })).toBeNull();
    expect(
      screen.queryByText(/Each PNG or JPEG becomes one page, in the order listed/),
    ).toBeNull();
    expect(screen.getByText(/No images yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create & open" })).toBeNull();

    fireEvent.drop(root, {
      dataTransfer: {
        files: [imageFile("first.png", "image/png"), imageFile("second.jpg", "image/jpeg")],
        items: [],
        types: ["Files"],
      },
    });

    await waitFor(() => expect(screen.getAllByText("first.png")).toHaveLength(2));
    expect(screen.queryByTestId("file-collection-empty")).toBeNull();
    expect(screen.getAllByText("second.jpg")).toHaveLength(2);
    expect(screen.getAllByTestId("file-collection-item")).toHaveLength(2);
    expect(screen.getAllByTestId("tool-sidebar-file")).toHaveLength(2);
    expect(screen.getAllByTestId("tool-sidebar-file")[0].querySelector('[data-file-icon="png"]')).toBeTruthy();
    expect(screen.getAllByTestId("tool-sidebar-file")[1].querySelector('[data-file-icon="jpeg"]')).toBeTruthy();
    expect(screen.getAllByTestId("tool-sidebar-file")[0].getAttribute("data-selected")).toBe("true");
    fireEvent.click(screen.getAllByTestId("file-collection-item")[1]);
    expect(screen.getAllByTestId("tool-sidebar-file")[1].getAttribute("data-selected")).toBe("true");
    expect(screen.getAllByTestId("file-collection-item")[1].getAttribute("data-selected")).toBe("true");
    const actionsHost = screen.getByTestId(TOOL_HEADER_ACTIONS_ID);
    expect(actionsHost.contains(screen.getByLabelText("Page size"))).toBe(true);
    expect(actionsHost.contains(screen.getByRole("button", { name: "Create & open" }))).toBe(true);
    expect(actionsHost.contains(screen.getByRole("button", { name: "Download" }))).toBe(true);
    expect(screen.getByTestId("file-collection-add").textContent).toContain("Add more images");
    expect(
      screen
        .getByTestId(TOOL_SIDEBAR_CONTENT_ID)
        .contains(screen.getByRole("button", { name: "Add images" })),
    ).toBe(true);

    expect(screen.queryByRole("button", { name: "List view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate first.png" }));
    expect(screen.getAllByText("first.png")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Move second.jpg earlier" }));
    const itemText = screen.getAllByTestId("file-collection-item").map((item) => item.textContent);
    expect(itemText[1]).toContain("second.jpg");

    fireEvent.click(screen.getByRole("button", { name: "Remove second.jpg" }));
    expect(screen.queryByText("second.jpg")).toBeNull();
  });
});

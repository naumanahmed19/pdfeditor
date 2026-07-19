// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropZone } from "../layout/DropZone";
import { Viewer } from "./Viewer";

const app = vi.hoisted(() => ({
  openBytes: vi.fn(async () => "doc-1"),
  openFile: vi.fn(async () => {}),
  registerFileHandle: vi.fn(),
  recentFiles: [],
  pdf: null,
}));

vi.mock("../../store", () => ({
  shallowEqual: Object.is,
  useAppSelector: (selector: (state: typeof app) => unknown) => selector(app),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("welcome-screen PDF drop", () => {
  it("opens a dropped PDF once instead of bubbling to the global drop target", async () => {
    const file = new File([new Uint8Array(16)], "large.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn(async () => new ArrayBuffer(16)),
    });

    const { container } = render(
      <>
        <Viewer />
        <DropZone />
      </>,
    );
    const welcome = container.querySelector(".scrollbar-soft");
    expect(welcome).not.toBeNull();

    fireEvent.drop(welcome!, {
      dataTransfer: {
        files: [file],
        items: [],
        types: ["Files"],
      },
    });

    await waitFor(() => expect(app.openFile).toHaveBeenCalledTimes(1));
    expect(app.openBytes).not.toHaveBeenCalled();
  });
});

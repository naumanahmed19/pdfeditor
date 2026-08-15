// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "./store";

const persistence = vi.hoisted(() => ({
  docs: [] as Array<{
    id: string;
    name: string;
    bytes: Uint8Array;
    lastOpened: number;
    open: boolean;
  }>,
  remove: vi.fn(async (ids: readonly string[]) => {
    persistence.docs = persistence.docs.filter((doc) => !ids.includes(doc.id));
    return true;
  }),
}));

vi.mock("./lib/persist", () => ({
  MAX_PERSIST_BYTES: 80 * 1024 * 1024,
  getStoredDoc: vi.fn(async () => undefined),
  listStoredDocs: vi.fn(async () => [...persistence.docs]),
  markDocClosed: vi.fn(async () => {}),
  persistAnnotations: vi.fn(async () => "stored"),
  persistDoc: vi.fn(async () => "stored"),
  removeStoredDocs: persistence.remove,
  touchStoredDoc: vi.fn(async () => {}),
}));

vi.mock("./lib/folder", () => ({
  pickFolder: vi.fn(async () => null),
  readNode: vi.fn(async () => null),
}));

vi.mock("./lib/pdftools", () => ({
  addOcrTextLayer: vi.fn(),
  bakeAnnotations: vi.fn(),
}));

let store: ReturnType<typeof useApp>;

function Capture() {
  store = useApp();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  persistence.docs = [
    {
      id: "recent-a",
      name: "a.pdf",
      bytes: new Uint8Array([1]),
      lastOpened: 2,
      open: false,
    },
    {
      id: "recent-b",
      name: "b.pdf",
      bytes: new Uint8Array([2]),
      lastOpened: 1,
      open: false,
    },
  ];
  persistence.remove.mockClear();
});

afterEach(() => cleanup());

describe("recent history removal", () => {
  it("collapses the startup sidebar when there are no recent documents", async () => {
    persistence.docs = [];
    localStorage.setItem("pickpdf-sidebar-open", "1");

    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    await waitFor(() => expect(store.sessionRestoring).toBe(false));
    expect(store.sidebarOpen).toBe(false);
    expect(localStorage.getItem("pickpdf-sidebar-open")).toBe("1");
  });

  it("keeps the saved sidebar preference when recent documents exist", async () => {
    localStorage.setItem("pickpdf-sidebar-open", "1");

    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    await waitFor(() => expect(store.sessionRestoring).toBe(false));
    expect(store.sidebarOpen).toBe(true);
  });

  it("exposes startup restoration until the active-document lookup settles", async () => {
    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    expect(store.sessionRestoring).toBe(true);
    await waitFor(() => expect(store.sessionRestoring).toBe(false));
  });

  it("shows every open session entry even when there are more than ten", async () => {
    persistence.docs = Array.from({ length: 15 }, (_, index) => ({
      id: `open-${index}`,
      name: `open-${index}.pdf`,
      bytes: new Uint8Array([index]),
      lastOpened: 100 - index,
      open: true,
    }));

    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    await waitFor(() => expect(store.recentFiles).toHaveLength(15));
    expect(store.recentFiles.every((item) => item.open)).toBe(true);
  });

  it("removes one item and then clears the remaining closed history", async () => {
    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );
    await waitFor(() => expect(store.recentFiles).toHaveLength(2));

    await act(async () => {
      await store.removeRecent("recent-a");
    });
    expect(store.recentFiles.map((item) => item.id)).toEqual(["recent-b"]);
    expect(persistence.remove).toHaveBeenCalledWith(["recent-a"]);

    await act(async () => {
      await store.clearRecent();
    });
    expect(store.recentFiles).toHaveLength(0);
    expect(persistence.remove).toHaveBeenLastCalledWith(["recent-b"]);
  });
});

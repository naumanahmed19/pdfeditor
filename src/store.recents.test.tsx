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
  persistDoc: vi.fn(async () => "stored"),
  removeStoredDocs: persistence.remove,
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

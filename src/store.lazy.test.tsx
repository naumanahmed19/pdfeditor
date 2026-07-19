// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "./store";

const persistence = vi.hoisted(() => ({
  docs: new Map<string, any>(),
}));

vi.mock("./lib/persist", () => ({
  MAX_PERSIST_BYTES: 80 * 1024 * 1024,
  getStoredDoc: vi.fn(async (id: string) => persistence.docs.get(id)),
  listStoredDocs: vi.fn(async () =>
    [...persistence.docs.values()]
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .map((doc) => ({
        id: doc.id,
        name: doc.name,
        sourceKey: doc.sourceKey,
        lastOpened: doc.lastOpened,
        open: doc.open,
        byteLength: doc.bytes.length,
      })),
  ),
  markDocClosed: vi.fn(async (id: string) => {
    const doc = persistence.docs.get(id);
    if (doc) persistence.docs.set(id, { ...doc, open: false });
  }),
  persistAnnotations: vi.fn(async (id: string, annotations: unknown) => {
    const doc = persistence.docs.get(id);
    if (doc) persistence.docs.set(id, { ...doc, annotations });
    return "stored";
  }),
  persistDoc: vi.fn(async (doc: any) => {
    persistence.docs.set(doc.id, doc);
    return "stored";
  }),
  removeStoredDocs: vi.fn(async (ids: readonly string[]) => {
    for (const id of ids) persistence.docs.delete(id);
    return true;
  }),
  touchStoredDoc: vi.fn(async (id: string, lastOpened: number) => {
    const doc = persistence.docs.get(id);
    if (doc) persistence.docs.set(id, { ...doc, lastOpened, open: true });
  }),
}));

vi.mock("./lib/folder", () => ({
  pickFolder: vi.fn(async () => null),
  readNode: vi.fn(async () => null),
}));

vi.mock("./lib/pdftools", () => ({
  addOcrTextLayer: vi.fn(),
  bakeAnnotations: vi.fn(),
}));

vi.mock("./lib/annotimport", () => ({
  importAnnotations: vi.fn(async () => null),
}));

vi.mock("./lib/pdf", () => ({
  loadPdf: vi.fn(async () => ({
    numPages: 1,
    getAttachment: vi.fn(() => null),
    isEncrypted: vi.fn(() => false),
    destroy: vi.fn(async () => {}),
  })),
  searchDocumentAdvanced: vi.fn(async () => []),
  extractAllText: vi.fn(async () => [{ pageIndex: 0, items: ["text"], full: "text" }]),
  setPasswordPrompter: vi.fn(),
  hasRasterImages: vi.fn(() => false),
}));

let store: ReturnType<typeof useApp>;

function Capture() {
  store = useApp();
  return null;
}

function pdfFile(index: number): File {
  const file = new File([new Uint8Array([index])], `document-${index}.pdf`, {
    type: "application/pdf",
    lastModified: index,
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn(async () => new Uint8Array([index]).buffer),
  });
  return file;
}

beforeEach(() => {
  persistence.docs.clear();
});

afterEach(() => cleanup());

describe("lazy document engines", () => {
  it("keeps all session entries while unloading clean inactive engines", async () => {
    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    for (let index = 0; index < 7; index += 1) {
      await act(async () => {
        await store.openFile(pdfFile(index));
      });
    }

    await waitFor(() => expect(store.recentFiles).toHaveLength(7));
    await waitFor(() => expect(store.tabs).toHaveLength(6));
    const unloaded = store.recentFiles.find(
      (recent) => !store.tabs.some((tab) => tab.id === recent.id),
    );
    expect(unloaded?.open).toBe(true);

    await act(async () => {
      await store.openRecent(unloaded!.id);
    });

    await waitFor(() => expect(store.activeTabId).toBe(unloaded!.id));
    expect(store.recentFiles).toHaveLength(7);
  });
});

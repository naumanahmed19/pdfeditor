// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "./store";
import { loadPdf } from "./lib/pdf";

vi.mock("./lib/persist", () => ({
  MAX_PERSIST_BYTES: 80 * 1024 * 1024,
  getStoredDoc: vi.fn(async () => undefined),
  listStoredDocs: vi.fn(async () => []),
  markDocClosed: vi.fn(async () => {}),
  persistAnnotations: vi.fn(async () => "stored"),
  persistDoc: vi.fn(async () => "error"),
  removeStoredDocs: vi.fn(async () => true),
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("opening an already-open file", () => {
  it("activates the existing document without parsing or listing it twice", async () => {
    const file = new File([new Uint8Array(16)], "report.pdf", {
      type: "application/pdf",
      lastModified: 123,
    });
    const read = vi.fn(async () => new ArrayBuffer(16));
    Object.defineProperty(file, "arrayBuffer", { value: read });

    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    await act(async () => {
      await store.openFile(file);
    });
    await act(async () => {
      await store.openFile(file);
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(loadPdf).toHaveBeenCalledTimes(1);
    expect(store.tabs).toHaveLength(1);
    expect(store.recentFiles).toHaveLength(1);
  });
});

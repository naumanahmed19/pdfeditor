// @vitest-environment jsdom
//
// Re-render isolation test for the app store. The whole point of splitting the
// mega-context into slices is that changing a hot, high-frequency field (the
// active tool, which flips on every editing interaction) must NOT re-render
// components that only read unrelated chrome state (theme, sidebar). This test
// pins that guarantee so a future change can't silently regress it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { AppProvider, useApp, useUI } from "./store";

// Keep the provider hermetic: stub the browser-only / heavy modules it imports
// so mounting it in jsdom doesn't touch IndexedDB, the File System Access API,
// or the pdf-lib/PDFium graph.
vi.mock("./lib/persist", () => ({
  getStoredDoc: vi.fn(async () => null),
  listStoredDocs: vi.fn(async () => []),
  markDocClosed: vi.fn(async () => {}),
  persistDoc: vi.fn(async () => {}),
}));
vi.mock("./lib/folder", () => ({
  pickFolder: vi.fn(async () => null),
  readNode: vi.fn(async () => null),
}));
vi.mock("./lib/pdftools", () => ({
  addOcrTextLayer: vi.fn(),
  bakeAnnotations: vi.fn(),
}));

const counts = { capture: 0, tool: 0, sidebar: 0 };
let store: ReturnType<typeof useApp>;

function Capture() {
  store = useApp();
  counts.capture++;
  return null;
}
/** Reads the hot field. */
function ToolProbe() {
  useApp().tool;
  counts.tool++;
  return null;
}
/** Reads only chrome state via the UI slice — must be insulated from tool changes. */
function SidebarProbe() {
  useUI().sidebarOpen;
  counts.sidebar++;
  return null;
}

beforeEach(() => {
  counts.capture = counts.tool = counts.sidebar = 0;
});
afterEach(() => cleanup());

describe("store re-render isolation", () => {
  it("changing the active tool does not re-render a chrome-only consumer", () => {
    render(
      <AppProvider>
        <Capture />
        <ToolProbe />
        <SidebarProbe />
      </AppProvider>,
    );
    const sidebarBefore = counts.sidebar;
    const toolBefore = counts.tool;

    act(() => {
      store.setTool("text");
    });

    // The tool consumer must react to the change...
    expect(counts.tool).toBe(toolBefore + 1);
    // ...but a consumer that only reads chrome state must NOT.
    expect(counts.sidebar).toBe(sidebarBefore);
  });

  it("a UI-slice consumer still reacts to its own chrome changes", () => {
    render(
      <AppProvider>
        <Capture />
        <SidebarProbe />
      </AppProvider>,
    );
    const before = counts.sidebar;
    act(() => {
      store.setSidebarOpen(!store.sidebarOpen);
    });
    expect(counts.sidebar).toBe(before + 1);
  });
});

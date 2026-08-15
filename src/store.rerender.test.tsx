// @vitest-environment jsdom
//
// Re-render isolation test for the app store. The whole point of splitting the
// mega-context into slices is that changing a hot, high-frequency field (the
// active tool, which flips on every editing interaction) must NOT re-render
// components that only read unrelated chrome state (theme, sidebar). This test
// pins that guarantee so a future change can't silently regress it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memo } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { AppProvider, useApp, useAppSelector } from "./store";

// Keep the provider hermetic: stub the browser-only / heavy modules it imports
// so mounting it in jsdom doesn't touch IndexedDB, the File System Access API,
// or the pdf-lib/PDFium graph.
vi.mock("./lib/persist", () => ({
  getStoredDoc: vi.fn(async () => null),
  listStoredDocs: vi.fn(async () => []),
  markDocClosed: vi.fn(async () => {}),
  persistAnnotations: vi.fn(async () => "stored"),
  persistDoc: vi.fn(async () => {}),
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

const counts = {
  capture: 0,
  tool: 0,
  sidebar: 0,
  selSidebar: 0,
  selAction: 0,
  parent: 0,
  memoProbe: 0,
  plainProbe: 0,
};
let store: ReturnType<typeof useApp>;

/** Selector consumer WITHOUT memo — re-renders when its parent does. */
function PlainSelectorProbe() {
  useAppSelector((s) => s.sidebarOpen);
  counts.plainProbe++;
  return null;
}
/** Selector consumer WITH memo (no props) — should ignore parent re-renders. */
const MemoSelectorProbe = memo(function MemoSelectorProbe() {
  useAppSelector((s) => s.sidebarOpen);
  counts.memoProbe++;
  return null;
});
/** A parent that reads the whole store (like the app's Shell) and renders the
 *  probes INLINE (new elements each render) — exactly how Shell renders
 *  TitleBar/Sidebar/AiPanel. Re-renders on every store change. */
function ReRenderingParent() {
  useApp();
  counts.parent++;
  return (
    <>
      <PlainSelectorProbe />
      <MemoSelectorProbe />
    </>
  );
}

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
/** Reads only chrome state via a selector — must be insulated from tool changes. */
function SidebarProbe() {
  useAppSelector((s) => s.sidebarOpen);
  counts.sidebar++;
  return null;
}
/** Selects a single field via useAppSelector — the new subscription path. */
function SelectorSidebarProbe() {
  useAppSelector((s) => s.sidebarOpen);
  counts.selSidebar++;
  return null;
}
/** Selects a stable action — should never re-render after mount. */
function SelectorActionProbe() {
  useAppSelector((s) => s.openFile);
  counts.selAction++;
  return null;
}

beforeEach(() => {
  localStorage.clear();
  counts.capture = counts.tool = counts.sidebar = counts.selSidebar = counts.selAction = 0;
  counts.parent = counts.memoProbe = counts.plainProbe = 0;
});
afterEach(() => cleanup());

describe("store re-render isolation", () => {
  it("restores the saved sidebar and Copilot visibility preferences", () => {
    localStorage.setItem("pickpdf-sidebar-open", "0");
    localStorage.setItem("pickpdf-ai-open", "0");

    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    expect(store.sidebarOpen).toBe(false);
    expect(store.aiOpen).toBe(false);
  });

  it("saves sidebar and Copilot visibility changes", () => {
    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    act(() => {
      store.setSidebarOpen(false);
      store.setAiOpen(false);
    });

    expect(localStorage.getItem("pickpdf-sidebar-open")).toBe("0");
    expect(localStorage.getItem("pickpdf-ai-open")).toBe("0");
  });

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

  it("useAppSelector re-renders only when the selected field changes", () => {
    render(
      <AppProvider>
        <Capture />
        <SelectorSidebarProbe />
        <SelectorActionProbe />
      </AppProvider>,
    );
    const sbBefore = counts.selSidebar;
    const actBefore = counts.selAction;

    // An unrelated change (the active tool) must not re-render either selector.
    act(() => {
      store.setTool("text");
    });
    expect(counts.selSidebar).toBe(sbBefore);
    expect(counts.selAction).toBe(actBefore);

    // Changing the selected field re-renders exactly that consumer...
    act(() => {
      store.setSidebarOpen(!store.sidebarOpen);
    });
    expect(counts.selSidebar).toBe(sbBefore + 1);
    // ...and the stable-action selector still never re-renders.
    expect(counts.selAction).toBe(actBefore);
  });

  it("a selector only pays off under React.memo when the parent re-renders", () => {
    render(
      <AppProvider>
        <Capture />
        <ReRenderingParent />
      </AppProvider>,
    );
    const parentBefore = counts.parent;
    const plainBefore = counts.plainProbe;
    const memoBefore = counts.memoProbe;

    // An unrelated change re-renders the whole-store parent...
    act(() => {
      store.setTool("text");
    });
    expect(counts.parent).toBe(parentBefore + 1);
    // ...which drags the NON-memoized selector child along (selector defeated)...
    expect(counts.plainProbe).toBe(plainBefore + 1);
    // ...but the memoized child (no props) ignores the parent re-render entirely.
    expect(counts.memoProbe).toBe(memoBefore);
  });
});

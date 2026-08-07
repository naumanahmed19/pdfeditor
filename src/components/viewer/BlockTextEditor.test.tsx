// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextAnnotation } from "../../types";
import { activeBlockEditor } from "../../lib/activeBlockEditor";
import { BlockTextEditor } from "./BlockTextEditor";

const ann: TextAnnotation = {
  id: "text-1",
  kind: "text",
  x: 10,
  y: 20,
  w: 180,
  h: 40,
  text: "hello",
  fontSize: 12,
  color: "#000000",
  fontFamily: "helvetica",
};

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal("ResizeObserver", TestResizeObserver));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BlockTextEditor", () => {
  it("commits on an outside pointer press without relying on blur", async () => {
    const onCommit = vi.fn();
    const { container } = render(
      <>
        <div data-text-annotation={ann.id}>
          <BlockTextEditor
            ann={ann}
            scale={1}
            onChange={vi.fn()}
            onSize={vi.fn()}
            onCommit={onCommit}
            onCancel={vi.fn()}
            onBoxPatch={vi.fn()}
          />
          <button data-testid="resize-handle">Resize</button>
        </div>
        <button>Outside</button>
      </>,
    );
    await waitFor(() =>
      expect(container.querySelector('[contenteditable="true"]')?.textContent).toBe(
        "hello",
      ),
    );

    fireEvent.pointerDown(screen.getByTestId("resize-handle"));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0][0].runs[0].text).toBe("hello");
  });

  it("supports Ctrl+Enter to save and Escape to cancel", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <div data-text-annotation={ann.id}>
        <BlockTextEditor
          ann={ann}
          scale={1}
          onChange={vi.fn()}
          onSize={vi.fn()}
          onCommit={onCommit}
          onCancel={onCancel}
          onBoxPatch={vi.fn()}
        />
      </div>,
    );
    const editor = container.querySelector('[contenteditable="true"]')!;
    await waitFor(() => expect(editor.textContent).toBe("hello"));

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps whole-box toolbar patches in the active edit draft", async () => {
    const onBoxPatch = vi.fn();
    render(
      <div data-text-annotation={ann.id}>
        <BlockTextEditor
          ann={ann}
          scale={1}
          onChange={vi.fn()}
          onSize={vi.fn()}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
          onBoxPatch={onBoxPatch}
        />
      </div>,
    );
    await waitFor(() => expect(activeBlockEditor.current?.annId).toBe(ann.id));
    activeBlockEditor.current?.patchBox({ align: "center" });
    expect(onBoxPatch).toHaveBeenCalledWith({ align: "center" });
    expect(activeBlockEditor.current?.boxValue("fontSize")).toBe(12);
  });
});

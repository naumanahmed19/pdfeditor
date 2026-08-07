// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTextEditor } from "./InlineTextEditor";
import type { InlineEdit } from "./textedit";
import { activeInlineEdit } from "../../lib/activeInlineEdit";

function inlineEdit(reflow = false, autoWrapLine = false): InlineEdit {
  return {
    id: 1,
    runs: [
      {
        objectIndex: 0,
        text: "hello",
        start: 0,
        sep: "",
        originX: 10,
        originY: 20,
        fontName: "Helvetica",
        fontSize: 12,
        color: [0, 0, 0, 255],
      },
    ],
    original: "hello",
    left: 10,
    top: 10,
    width: 100,
    height: 20,
    maxWidth: 400,
    maxHeight: 300,
    autoWrapLine,
    caretOffset: 2,
    fontPx: 12,
    color: "rgb(0, 0, 0)",
    colorHex: "#000000",
    backdropColor: "rgb(255, 255, 255)",
    fontSize: 12,
    fontName: "Helvetica",
    fallbackFamily: "helvetica",
    embeddedFont: null,
    bold: false,
    italic: false,
    anchor: [10, 20],
    fontChars: { Helvetica: "hello" },
    faceIndexes: { Helvetica: 0 },
    siblings: {},
    reflow: reflow
      ? {
          lines: [{ objectIndexes: [0], originX: 10, originY: 20 }],
          width: 100,
          leading: 14,
        }
      : undefined,
  };
}

afterEach(cleanup);

describe("InlineTextEditor", () => {
  it("puts the caret where the page was clicked instead of selecting everything", () => {
    render(
      <InlineTextEditor
        edit={inlineEdit()}
        saving={false}
        onCommit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("Edit PDF text") as HTMLTextAreaElement;
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it("uses natural paragraph keys: Enter adds lines and Ctrl+Enter commits", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <InlineTextEditor
        edit={inlineEdit(true)}
        saving={false}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("Edit PDF text");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "hello\nworld" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0]).toBe("hello\nworld");
  });

  it("grows a fixed-line editor horizontally and stays readable while saving", async () => {
    const width = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollWidth",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => 260,
    });
    try {
      const { rerender } = render(
        <InlineTextEditor
          edit={inlineEdit()}
          saving={false}
          onCommit={vi.fn().mockResolvedValue(true)}
          onCancel={vi.fn()}
        />,
      );
      const textarea = screen.getByLabelText(
        "Edit PDF text",
      ) as HTMLTextAreaElement;
      await waitFor(() => expect(textarea.style.width).toBe("264px"));

      rerender(
        <InlineTextEditor
          edit={inlineEdit()}
          saving
          onCommit={vi.fn().mockResolvedValue(true)}
          onCancel={vi.fn()}
        />,
      );
      expect(textarea.readOnly).toBe(true);
      expect(textarea.disabled).toBe(false);

      rerender(
        <InlineTextEditor
          edit={inlineEdit()}
          saving
          passive
          onCommit={vi.fn().mockResolvedValue(true)}
          onCancel={vi.fn()}
        />,
      );
      expect(textarea.style.color).toBe("rgb(0, 0, 0)");
      expect(textarea.style.backgroundColor).toBe("rgb(255, 255, 255)");
    } finally {
      if (width) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollWidth", width);
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollWidth?: number }).scrollWidth;
      }
    }
  });

  it("uses the sampled PDF backdrop instead of a white edit surface", () => {
    const edit = inlineEdit();
    edit.color = "rgb(255, 255, 255)";
    edit.colorHex = "#ffffff";
    edit.backdropColor = "rgb(4, 105, 87)";
    render(
      <InlineTextEditor
        edit={edit}
        saving={false}
        onCommit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("Edit PDF text") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "visible white text" } });
    expect(textarea.style.color).toBe("rgb(255, 255, 255)");
    expect(textarea.style.backgroundColor).toBe("rgb(4, 105, 87)");
  });

  it("grows an auto-wrapping line to the page edge, then wraps without horizontal scrolling", async () => {
    const width = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollWidth",
    );
    const height = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => 620,
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 72,
    });
    try {
      render(
        <InlineTextEditor
          edit={inlineEdit(true, true)}
          saving={false}
          onCommit={vi.fn().mockResolvedValue(true)}
          onCancel={vi.fn()}
        />,
      );
      const textarea = screen.getByLabelText(
        "Edit PDF text",
      ) as HTMLTextAreaElement;
      await waitFor(() => expect(textarea.style.width).toBe("400px"));
      expect(textarea.style.height).toBe("74px");
      expect(textarea.style.overflowX).toBe("hidden");
      expect(textarea.wrap).toBe("soft");
      expect(activeInlineEdit.current?.commitHint).toBe(
        "Enter saves · Shift+Enter adds a line",
      );
    } finally {
      if (width) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollWidth", width);
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollWidth?: number })
          .scrollWidth;
      }
      if (height) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", height);
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollHeight?: number })
          .scrollHeight;
      }
    }
  });

  it("keeps Enter-to-commit for auto-wrapping line edits", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <InlineTextEditor
        edit={inlineEdit(true, true)}
        saving={false}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("Edit PDF text");
    fireEvent.change(textarea, { target: { value: "a long wrapping line" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0]).toBe("a long wrapping line");
  });

  it("commits when a pointer press lands outside a non-focusable editor surface", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <InlineTextEditor
        edit={inlineEdit(true)}
        saving={false}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
  });

  it("passes a manually resized wrap width to the commit path", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <InlineTextEditor
        edit={inlineEdit(true)}
        saving={false}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByLabelText("Resize text width"), {
      clientX: 100,
    });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(screen.getByLabelText("Edit PDF text"), { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][6]).toEqual({ width: 188 });
  });

  it("offers explicit Done and Cancel actions", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(
      <InlineTextEditor
        edit={inlineEdit(true)}
        saving={false}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    cleanup();
    render(
      <InlineTextEditor
        edit={inlineEdit(true)}
        saving={false}
        onCommit={vi.fn().mockResolvedValue(true)}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("restores a remembered wrapping width when the editor reopens", async () => {
    const edit = inlineEdit(true);
    edit.preferredWidth = 176;
    render(
      <InlineTextEditor
        edit={edit}
        saving={false}
        onCommit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("Edit PDF text") as HTMLTextAreaElement).style.width).toBe(
        "176px",
      ),
    );
  });

  it("shows live overlap and possible font fallback feedback", async () => {
    const edit = inlineEdit(true);
    edit.collisionRects = [{ left: 20, top: 10, right: 80, bottom: 40 }];
    render(
      <InlineTextEditor
        edit={edit}
        saving={false}
        onCommit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("Edit PDF text");
    expect(textarea.className).toContain("outline-red-500");
    expect(screen.getByText("Overlaps page content")).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "helloz" } });
    await waitFor(() =>
      expect(screen.getByText(/may use Helvetica when saved/)).toBeTruthy(),
    );
  });
});

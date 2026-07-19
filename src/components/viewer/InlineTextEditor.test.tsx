// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTextEditor } from "./InlineTextEditor";
import type { InlineEdit } from "./textedit";

function inlineEdit(reflow = false): InlineEdit {
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
      },
    ],
    original: "hello",
    left: 10,
    top: 10,
    width: 100,
    height: 20,
    maxWidth: 400,
    maxHeight: 300,
    caretOffset: 2,
    fontPx: 12,
    color: "rgb(0, 0, 0)",
    colorHex: "#000000",
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
      expect(textarea.style.backgroundColor).toBe("white");
    } finally {
      if (width) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollWidth", width);
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollWidth?: number }).scrollWidth;
      }
    }
  });
});

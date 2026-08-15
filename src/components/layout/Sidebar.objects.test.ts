import { describe, expect, it } from "vitest";
import type { Annotation } from "../../types";
import {
  annotationObjectLabel,
  annotationObjectSecondaryLabel,
  collectAnnotationObjects,
  groupAnnotationObjectsByPage,
} from "./Sidebar";

const text = (id: string, x: number, y: number, value: string): Annotation => ({
  id,
  kind: "text",
  x,
  y,
  w: 100,
  h: 20,
  text: value,
  fontSize: 12,
  color: "#000000",
});

describe("Objects sidebar helpers", () => {
  it("uses useful object labels instead of raw ids", () => {
    expect(annotationObjectLabel(text("a", 0, 0, "  Agreement title  "))).toBe(
      "Agreement title",
    );
    expect(
      annotationObjectLabel({
        id: "field",
        kind: "formfield",
        fieldType: "text",
        fieldName: "customer_name",
        x: 0,
        y: 0,
        w: 80,
        h: 20,
      }),
    ).toBe("customer_name");
    expect(
      annotationObjectLabel({
        id: "image",
        kind: "image",
        dataUrl: "data:image/png;base64,AA==",
        x: 0,
        y: 0,
        w: 80,
        h: 20,
      }),
    ).toBe("Image");
  });

  it("hides repeated object types but keeps useful secondary labels", () => {
    expect(annotationObjectSecondaryLabel("Highlight", "Highlight")).toBeNull();
    expect(annotationObjectSecondaryLabel("drawing", "Drawing")).toBeNull();
    expect(annotationObjectSecondaryLabel("Agreement title", "Text")).toBe(
      "Text",
    );
    expect(annotationObjectSecondaryLabel("Agreement title", "Text", true)).toBe(
      "Text · Locked",
    );
  });

  it("orders objects by page and visual position", () => {
    const rows = collectAnnotationObjects({
      2: [text("late", 10, 50, "Late")],
      0: [text("right", 40, 10, "Right"), text("left", 10, 10, "Left")],
    });
    expect(rows.map(({ page, ann }) => [page, ann.id])).toEqual([
      [0, "left"],
      [0, "right"],
      [2, "late"],
    ]);
  });

  it("groups ordered objects into page-level sections", () => {
    const rows = collectAnnotationObjects({
      2: [text("third", 10, 10, "Third")],
      0: [text("first", 10, 10, "First"), text("second", 20, 20, "Second")],
    });

    expect(
      groupAnnotationObjectsByPage(rows).map(({ page, objects }) => [
        page,
        objects.map((object) => object.id),
      ]),
    ).toEqual([
      [0, ["first", "second"]],
      [2, ["third"]],
    ]);
  });
});

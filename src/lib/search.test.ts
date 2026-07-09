import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  findInIndex,
  preserveReplacementCase,
  replaceAllInText,
} from "./search";

describe("search utilities", () => {
  it("finds phrases across split text runs", () => {
    const index = buildSearchIndex([
      { itemIndex: 0, text: "Hello" },
      { itemIndex: 1, text: "world" },
    ]);
    const hits = findInIndex(index, "hello world");
    expect(Array.isArray(hits)).toBe(true);
    expect(hits).toHaveLength(1);
    expect(Array.isArray(hits) && hits[0].ranges).toEqual([
      { itemIndex: 0, start: 0, end: 5 },
      { itemIndex: 1, start: 0, end: 5 },
    ]);
  });

  it("treats typed spaces as flexible whitespace in literal search", () => {
    const index = buildSearchIndex([{ itemIndex: 0, text: "hello\n   world" }]);
    const hits = findInIndex(index, "hello world");
    expect(Array.isArray(hits) && hits[0].text).toBe("hello\n   world");
  });

  it("honors match case", () => {
    const index = buildSearchIndex([{ itemIndex: 0, text: "Alpha alpha" }]);
    const hits = findInIndex(index, "alpha", { matchCase: true });
    expect(Array.isArray(hits) && hits).toHaveLength(1);
    expect(Array.isArray(hits) && hits[0].text).toBe("alpha");
  });

  it("filters whole-word matches", () => {
    const index = buildSearchIndex([{ itemIndex: 0, text: "cat scatter cat" }]);
    const hits = findInIndex(index, "cat", { wholeWord: true });
    expect(Array.isArray(hits) && hits.map((h) => h.text)).toEqual(["cat", "cat"]);
  });

  it("supports regex capture replacement", () => {
    const result = replaceAllInText("2026-07-09", "(\\d{4})-(\\d{2})-(\\d{2})", "$2/$3/$1", {
      regex: true,
    });
    expect(result).toEqual({ text: "07/09/2026", count: 1 });
  });

  it("reports invalid regex patterns", () => {
    const index = buildSearchIndex([{ itemIndex: 0, text: "alpha" }]);
    const hits = findInIndex(index, "(", { regex: true });
    expect("error" in hits).toBe(true);
  });

  it("preserves simple replacement case", () => {
    expect(preserveReplacementCase("HELLO", "bye")).toBe("BYE");
    expect(preserveReplacementCase("hello", "BYE")).toBe("bye");
    expect(preserveReplacementCase("Hello", "bye")).toBe("Bye");
  });
});

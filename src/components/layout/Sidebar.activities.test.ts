import { describe, expect, it } from "vitest";
import { SIDEBAR_ACTIVITIES, TOOL_SIDEBAR_ACTIVITIES } from "./Sidebar";

describe("tool sidebar activities", () => {
  it("keeps Recent available before tool-specific views", () => {
    expect(TOOL_SIDEBAR_ACTIVITIES.map((item) => item.key)).toEqual([
      "recent",
      "files",
      "tools",
    ]);
  });

  it("offers the editor tool catalog from the document activity rail", () => {
    expect(SIDEBAR_ACTIVITIES.map((item) => item.key)).toContain("editor-tools");
  });
});

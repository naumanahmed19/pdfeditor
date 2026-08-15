import { describe, expect, it } from "vitest";
import { TOOL_SIDEBAR_ACTIVITIES } from "./Sidebar";

describe("tool sidebar activities", () => {
  it("keeps Recent available before tool-specific views", () => {
    expect(TOOL_SIDEBAR_ACTIVITIES.map((item) => item.key)).toEqual([
      "recent",
      "files",
      "tools",
    ]);
  });
});

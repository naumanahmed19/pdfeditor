import { describe, expect, it } from "vitest";
import {
  BASIC_EDITOR_TOOLS,
  EDITOR_TOOL_GROUPS,
  EDITOR_TOOLS,
  getEditorTool,
} from "./editorToolRegistry";

describe("editor tool registry", () => {
  it("keeps every tool key unique and assigned to a visible group", () => {
    const keys = EDITOR_TOOLS.map((tool) => tool.key);
    const groups = new Set(EDITOR_TOOL_GROUPS.map((group) => group.id));

    expect(new Set(keys).size).toBe(keys.length);
    expect(EDITOR_TOOLS.every((tool) => groups.has(tool.group))).toBe(true);
  });

  it("keeps the compact toolbar limited to the three base modes", () => {
    expect(BASIC_EDITOR_TOOLS.map((tool) => tool.key)).toEqual([
      "read",
      "pan",
      "select",
    ]);
  });

  it("resolves the same metadata used by the sidebar and toolbar", () => {
    expect(getEditorTool("redact")).toMatchObject({
      group: "cleanup",
      name: "Redact",
      shortcut: "X",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  CURRENT_PDF_TOOLS,
  FILE_SCOPED_TOOL_SCREENS,
  GENERAL_TOOLS,
  TOOL_BY_SCREEN,
  TOOL_DEFINITIONS,
} from "./toolRegistry";

describe("tool registry", () => {
  it("contains one definition per tool screen", () => {
    const screens = TOOL_DEFINITIONS.map((tool) => tool.screen);

    expect(new Set(screens).size).toBe(screens.length);
    expect(Object.keys(TOOL_BY_SCREEN)).toHaveLength(screens.length);
  });

  it("keeps document tools separate from standalone tools", () => {
    expect(CURRENT_PDF_TOOLS.map((tool) => tool.screen)).toContain("organize");
    expect(GENERAL_TOOLS.map((tool) => tool.screen)).toEqual(
      expect.arrayContaining(["merge", "split", "createimages", "createdoc"]),
    );
    expect(FILE_SCOPED_TOOL_SCREENS.has("split")).toBe(false);
    expect(FILE_SCOPED_TOOL_SCREENS.has("merge")).toBe(false);
    expect(FILE_SCOPED_TOOL_SCREENS.has("watermark")).toBe(true);
  });

  it("keeps menu ordering deterministic", () => {
    const assertOrdered = (orders: number[]) => {
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    };

    assertOrdered(CURRENT_PDF_TOOLS.map((tool) => tool.menuOrder));
    assertOrdered(GENERAL_TOOLS.map((tool) => tool.menuOrder));
  });
});

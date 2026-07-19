import { describe, expect, it } from "vitest";
import { parsePageNavigation } from "./aiCommands";

describe("parsePageNavigation", () => {
  it.each([
    ["go to page 3", 3],
    ["Open page 12", 12],
    ["please show me page 7", 7],
    ["can you take me to page 42?", 42],
    ["navigate to page 9 please", 9],
    ["navigate to 50", 50],
    ["nevigate to 50?", 50],
  ])("recognizes %s", (input, page) => {
    expect(parsePageNavigation(input)).toBe(page);
  });

  it.each([
    "what is on page 3?",
    "summarize page 3",
    "show me what page 3 says",
    "go to page zero",
  ])("does not treat a document question as navigation: %s", (input) => {
    expect(parsePageNavigation(input)).toBeNull();
  });
});

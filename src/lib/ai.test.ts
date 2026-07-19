import { describe, expect, it } from "vitest";
import { resolveModel } from "./ai";

describe("resolveModel", () => {
  it("keeps an exact configured model", () => {
    expect(resolveModel("gpt-4.1-mini", ["gpt-4.1", "gpt-4.1-mini"])).toBe(
      "gpt-4.1-mini",
    );
  });

  it("does not silently substitute a fuzzy or first model", () => {
    expect(() => resolveModel("gpt-4.1", ["gpt-4.1-mini", "expensive-model"])).toThrow(
      /not available/i,
    );
  });

  it("uses the configured id when model discovery is unsupported", () => {
    expect(resolveModel("private-model", [])).toBe("private-model");
  });
});

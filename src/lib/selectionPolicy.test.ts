import { describe, expect, it } from "vitest";
import {
  canMoveExistingFormField,
  canMoveNativeContent,
} from "./selectionPolicy";

describe("unified Move/select policy", () => {
  const unrestricted = { restricted: false, modify: false };
  const annotateOnly = { restricted: true, modify: false };
  const modifiable = { restricted: true, modify: true };

  it("moves native content only with Select and modify permission", () => {
    expect(canMoveNativeContent("select", unrestricted)).toBe(true);
    expect(canMoveNativeContent("select", modifiable)).toBe(true);
    expect(canMoveNativeContent("select", annotateOnly)).toBe(false);
    expect(canMoveNativeContent("read", unrestricted)).toBe(false);
    expect(canMoveNativeContent("edittext", unrestricted)).toBe(false);
  });

  it("keeps forms fillable in Read and locks read-only fields in Select", () => {
    expect(canMoveExistingFormField("read", unrestricted, false)).toBe(false);
    expect(canMoveExistingFormField("select", unrestricted, false)).toBe(true);
    expect(canMoveExistingFormField("select", unrestricted, true)).toBe(false);
    expect(canMoveExistingFormField("select", annotateOnly, false)).toBe(false);
  });
});

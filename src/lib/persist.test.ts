// Autosave size-cutoff behavior. Runs in the default node environment (no
// IndexedDB): the "too-large" path must decide and return BEFORE any storage
// access, so it is fully testable here — while anything that does try to reach
// IndexedDB deterministically reports "error" instead.
import { describe, expect, it } from "vitest";
import {
  MAX_PERSIST_BYTES,
  exceedsPersistLimit,
  persistDoc,
  type StoredDoc,
} from "./persist";

function doc(byteLength: number): StoredDoc {
  return {
    id: "test-doc",
    name: "test.pdf",
    bytes: new Uint8Array(byteLength),
    lastOpened: 0,
    open: true,
  };
}

describe("autosave size limit", () => {
  it("gates strictly above MAX_PERSIST_BYTES", () => {
    expect(exceedsPersistLimit(0)).toBe(false);
    expect(exceedsPersistLimit(MAX_PERSIST_BYTES)).toBe(false);
    expect(exceedsPersistLimit(MAX_PERSIST_BYTES + 1)).toBe(true);
  });

  it("persistDoc reports 'too-large' for oversized docs without touching storage", async () => {
    // node has no indexedDB, so any storage attempt would yield "error" —
    // getting "too-large" proves the guard runs first and the skip is visible
    // to the caller instead of a silent no-op.
    await expect(persistDoc(doc(MAX_PERSIST_BYTES + 1))).resolves.toBe(
      "too-large",
    );
  });

  it("persistDoc attempts storage for docs at or under the limit", async () => {
    // Same environment: the small doc must get PAST the size gate and fail at
    // the (absent) IndexedDB layer, i.e. anything but "too-large".
    await expect(persistDoc(doc(16))).resolves.toBe("error");
  });
});

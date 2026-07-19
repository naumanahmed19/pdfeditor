import { describe, expect, it } from "vitest";
import { fileSourceKey, legacyBytesSourceKey } from "./fileIdentity";

describe("file identity", () => {
  it("matches the same file metadata and distinguishes different paths", () => {
    const file = { name: "report.pdf", size: 120, lastModified: 42 };
    expect(fileSourceKey(file)).toBe(fileSourceKey({ ...file }));
    expect(fileSourceKey({ ...file, path: "a/report.pdf" })).not.toBe(
      fileSourceKey({ ...file, path: "b/report.pdf" }),
    );
  });

  it("collapses identical legacy bytes but distinguishes changed content", () => {
    const first = new Uint8Array([1, 2, 3, 4]);
    const same = new Uint8Array(first);
    const changed = new Uint8Array([1, 2, 9, 4]);
    expect(legacyBytesSourceKey("report.pdf", first)).toBe(
      legacyBytesSourceKey("report.pdf", same),
    );
    expect(legacyBytesSourceKey("report.pdf", first)).not.toBe(
      legacyBytesSourceKey("report.pdf", changed),
    );
  });
});

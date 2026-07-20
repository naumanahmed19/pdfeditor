import { describe, expect, it } from "vitest";
import { chromePdfFilename } from "./chromeExtension";

describe("chromePdfFilename", () => {
  it("prefers an RFC 5987 content-disposition filename", () => {
    expect(
      chromePdfFilename("https://example.com/download/42", {
        "Content-Disposition": "attachment; filename*=UTF-8''Quarterly%20Report.pdf",
      }),
    ).toBe("Quarterly Report.pdf");
  });

  it("uses and decodes the URL filename", () => {
    expect(chromePdfFilename("https://example.com/files/My%20File.pdf?token=1")).toBe(
      "My File.pdf",
    );
  });

  it("adds the PDF extension when the source omits it", () => {
    expect(chromePdfFilename("https://example.com/export/invoice")).toBe("invoice.pdf");
  });

  it("falls back for nonstandard URLs", () => {
    expect(chromePdfFilename("not a url")).toBe("document.pdf");
  });
});

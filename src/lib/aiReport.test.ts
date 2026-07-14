import { describe, expect, it } from "vitest";
import {
  AI_REPORT_EMAIL,
  MAX_REPORTED_RESPONSE_CHARS,
  MICROSOFT_STORE_PRODUCT_ID,
  buildAiReport,
} from "./aiReport";

const baseInput = {
  response: "A generated response with symbols: 50% & useful ✓",
  category: "harmful" as const,
  details: "It suggested something unsafe & unexpected.",
  appVersion: "1.2.3",
  provider: "Built-in",
  model: "Gemma 4 (in-browser)",
};

describe("buildAiReport", () => {
  it("builds an encoded mailto containing the required report details", () => {
    const report = buildAiReport(baseInput);
    const url = new URL(report.mailto);

    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(AI_REPORT_EMAIL);
    expect(url.searchParams.get("subject")).toContain(MICROSOFT_STORE_PRODUCT_ID);
    expect(url.searchParams.get("body")).toBe(report.body);
    expect(report.body).toContain("Category: Harmful or dangerous content");
    expect(report.body).toContain(baseInput.response);
    expect(report.body).toContain(baseInput.details);
  });

  it("limits the included AI response to 2,000 characters", () => {
    const response = "x".repeat(MAX_REPORTED_RESPONSE_CHARS + 500);
    const report = buildAiReport({ ...baseInput, response });
    const includedResponse = report.body
      .split("Reported AI response:\n---\n")[1]
      .split("\n[Response truncated")[0];

    expect(includedResponse).toHaveLength(MAX_REPORTED_RESPONSE_CHARS);
    expect(report.body).toContain("[Response truncated to 2,000 characters]");
  });

  it("ignores prompt and PDF fields even if an untyped caller supplies them", () => {
    const report = buildAiReport({
      ...baseInput,
      prompt: "SECRET_USER_PROMPT",
      pdfText: "SECRET_PDF_TEXT",
      documentName: "secret.pdf",
    } as typeof baseInput);

    expect(report.body).not.toContain("SECRET_USER_PROMPT");
    expect(report.body).not.toContain("SECRET_PDF_TEXT");
    expect(report.body).not.toContain("secret.pdf");
  });
});

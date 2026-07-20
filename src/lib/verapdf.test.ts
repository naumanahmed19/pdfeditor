import { describe, expect, it } from "vitest";
import { parseVeraPdfReport } from "./verapdf";

describe("parseVeraPdfReport", () => {
  it("maps failed rules and contexts into UI findings", () => {
    const result = parseVeraPdfReport({
      report: {
        buildInformation: { releaseDetails: [{ id: "core", version: "1.28.2" }] },
        jobs: {
          job: {
            validationResult: [{
              profileName: "PDF/A-2B validation profile",
              statement: "PDF file is not compliant.",
              compliant: false,
              details: {
                failedRules: 1,
                ruleSummaries: [{
                  specification: "ISO 19005-2:2011",
                  clause: "6.2.11.4",
                  testNumber: "1",
                  failedChecks: 2,
                  description: "Every font shall be embedded.",
                  checks: [
                    { status: "failed", context: "root/pages[0]/font[0]" },
                    { status: "failed", context: "root/pages[1]/font[0]" },
                  ],
                }],
              },
            }],
          },
        },
      },
    });

    expect(result.source).toBe("verapdf");
    expect(result.ready).toBe(false);
    expect(result.errors).toBe(1);
    expect(result.validatorVersion).toBe("1.28.2");
    expect(result.findings[0]).toMatchObject({
      title: "ISO 19005-2:2011 · clause 6.2.11.4 · test 1",
      passed: false,
      items: ["root/pages[0]/font[0]", "root/pages[1]/font[0]"],
    });
  });

  it("accepts attribute-prefixed JSON and produces a passing finding", () => {
    const result = parseVeraPdfReport({
      report: {
        jobs: {
          job: {
            validationReport: {
              "@profileName": "PDF/A-2B validation profile",
              "@isCompliant": "true",
              "@statement": "PDF file is compliant.",
              details: { "@failedRules": "0" },
            },
          },
        },
      },
    });

    expect(result.ready).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].passed).toBe(true);
  });

  it("rejects reports without a validation result", () => {
    expect(() =>
      parseVeraPdfReport({ report: { batchSummary: { failedToParse: 1 } } }),
    ).toThrow("could not parse");
  });
});

import type { PdfaFinding, PdfaReport } from "./pdfa";
import { isTauriDesktop } from "./tauri";

interface NativeVeraPdfOutput {
  executable: string;
  report: unknown;
}

type JsonRecord = Record<string, unknown>;

export class VeraPdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VeraPdfUnavailableError";
  }
}

export async function validatePdfAWithVeraPdf(
  bytes: Uint8Array,
  flavour = "2b",
): Promise<PdfaReport> {
  if (!isTauriDesktop) {
    throw new VeraPdfUnavailableError("veraPDF is only available in the desktop app.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const output = await invoke<NativeVeraPdfOutput>("validate_pdfa_with_verapdf", {
      // Command arguments use JSON IPC. A plain array is reliably decoded by
      // serde as Vec<u8> on every supported Tauri webview.
      bytes: Array.from(bytes),
      flavour,
    });
    return parseVeraPdfReport(output.report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("VERAPDF_NOT_FOUND:")) {
      throw new VeraPdfUnavailableError(message.split("VERAPDF_NOT_FOUND:")[1].trim());
    }
    throw error;
  }
}

/** Convert veraPDF's machine report into the checklist model used by the UI. */
export function parseVeraPdfReport(raw: unknown): PdfaReport {
  // Current JSON reports use validationResult (an array); older/XML-derived
  // JSON uses validationReport. Accept both so upgrades do not break the UI.
  const reports = [
    ...collectNamed(raw, "validationResult").flatMap(normaliseList),
    ...collectNamed(raw, "validationReport").flatMap(normaliseList),
  ];
  const validation = reports.map(asRecord).find(Boolean);
  if (!validation) {
    const batch = collectNamed(raw, "batchSummary").map(asRecord).find(Boolean);
    const failedToParse =
      numberField(batch, "failedToParse") ?? numberField(batch, "failedParsingJobs") ?? 0;
    throw new Error(
      failedToParse > 0
        ? "veraPDF could not parse this PDF."
        : "The veraPDF report did not contain a validation result.",
    );
  }

  const compliant =
    booleanField(validation, "isCompliant") ?? booleanField(validation, "compliant");
  if (compliant === undefined) {
    throw new Error("The veraPDF report did not contain a compliance verdict.");
  }

  const profileName = text(field(validation, "profileName")) ?? "PDF/A validation profile";
  const statement = text(field(validation, "statement"));
  const details = asRecord(field(validation, "details"));
  const ruleValues = field(details, "ruleSummaries") ?? field(details, "rule");
  const rules = normaliseList(ruleValues)
    .map(asRecord)
    .filter((rule): rule is JsonRecord => !!rule);
  const findings: PdfaFinding[] = rules.map((rule, index) => ruleFinding(rule, index));

  if (compliant) {
    findings.push({
      id: "verapdf-compliant",
      title: profileName,
      severity: "error",
      passed: true,
      detail: statement ?? "veraPDF found the document compliant with this validation profile.",
    });
  } else if (findings.length === 0) {
    findings.push({
      id: "verapdf-noncompliant",
      title: "Validation failed",
      severity: "error",
      passed: false,
      detail: statement ?? "veraPDF found the document non-compliant.",
    });
  }

  const reportedFailedRules = numberField(details, "failedRules");
  const errors = compliant ? 0 : Math.max(findings.length, reportedFailedRules ?? 1);
  const validatorVersion = findValidatorVersion(raw);

  return {
    findings,
    errors,
    warnings: 0,
    infos: 0,
    ready: compliant,
    verdict: compliant
      ? `veraPDF: compliant with ${profileName}.`
      : `veraPDF: not compliant with ${profileName} (${errors} failed rule${errors === 1 ? "" : "s"}).`,
    source: "verapdf",
    profileName,
    ...(validatorVersion ? { validatorVersion } : {}),
  };
}

function ruleFinding(rule: JsonRecord, index: number): PdfaFinding {
  const specification = text(field(rule, "specification"));
  const clause = text(field(rule, "clause"));
  const testNumber = text(field(rule, "testNumber"));
  const description = text(field(rule, "description")) ?? "This PDF/A requirement failed.";
  const failedChecks = numberField(rule, "failedChecks");
  const label = [specification, clause && `clause ${clause}`, testNumber && `test ${testNumber}`]
    .filter(Boolean)
    .join(" · ");
  const contexts = collectNamed(rule, "context")
    .map(text)
    .filter((value): value is string => !!value);
  const uniqueContexts = [...new Set(contexts)];
  const items = uniqueContexts.slice(0, 25);
  if (uniqueContexts.length > items.length) {
    items.push(`… and ${uniqueContexts.length - items.length} more`);
  }

  return {
    id: `verapdf-${safeId(specification)}-${safeId(clause)}-${safeId(testNumber)}-${index}`,
    title: label || `Failed veraPDF rule ${index + 1}`,
    severity: "error",
    passed: false,
    detail:
      failedChecks && failedChecks > 1 ? `${description} (${failedChecks} failed checks)` : description,
    ...(items.length ? { items } : {}),
  };
}

function findValidatorVersion(raw: unknown): string | undefined {
  const releases = collectNamed(raw, "releaseDetails")
    .flatMap(normaliseList)
    .map(asRecord)
    .filter((release): release is JsonRecord => !!release);
  const preferred = releases.find((release) => {
    const id = text(field(release, "id"))?.toLowerCase();
    return id === "core" || id === "validation-model";
  });
  return text(field(preferred, "version"));
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function normaliseList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalisedKey(value: string): string {
  return value.replace(/^@/, "").replace(/[-_]/g, "").toLowerCase();
}

function field(record: JsonRecord | undefined, name: string): unknown {
  if (!record) return undefined;
  const wanted = normalisedKey(name);
  const key = Object.keys(record).find((candidate) => normalisedKey(candidate) === wanted);
  return key === undefined ? undefined : record[key];
}

function collectNamed(value: unknown, name: string, output: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNamed(entry, name, output));
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  const wanted = normalisedKey(name);
  for (const [key, child] of Object.entries(record)) {
    if (normalisedKey(key) === wanted) output.push(child);
    collectNamed(child, name, output);
  }
  return output;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = text(entry);
      if (result) return result;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["#text", "_", "value", "content"]) {
    const result = text(record[key]);
    if (result) return result;
  }
  return undefined;
}

function numberField(record: JsonRecord | undefined, name: string): number | undefined {
  const value = field(record, name);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanField(record: JsonRecord | undefined, name: string): boolean | undefined {
  const value = field(record, name);
  if (typeof value === "boolean") return value;
  const serialised = text(value)?.toLowerCase();
  if (serialised === "true") return true;
  if (serialised === "false") return false;
  return undefined;
}

function safeId(value: string | undefined): string {
  return (value ?? "rule").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

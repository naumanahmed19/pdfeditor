import { isTauri } from "./tauri";

export const AI_REPORT_EMAIL = "support@pickpdf.app";
export const MICROSOFT_STORE_PRODUCT_ID = "9NH6V3X339CW";
export const MAX_REPORTED_RESPONSE_CHARS = 2000;

export const AI_REPORT_CATEGORIES = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "harmful", label: "Harmful or dangerous content" },
  { value: "hate", label: "Hate or harassment" },
  { value: "sexual", label: "Sexual content" },
  { value: "illegal", label: "Illegal activity" },
  { value: "other", label: "Other" },
] as const;

export type AiReportCategory = (typeof AI_REPORT_CATEGORIES)[number]["value"];

export interface AiReportInput {
  response: string;
  category: AiReportCategory;
  details: string;
  appVersion: string;
  provider: string;
  model: string;
}

export interface AiReportDraft {
  subject: string;
  body: string;
  mailto: string;
}

function categoryLabel(category: AiReportCategory): string {
  return (
    AI_REPORT_CATEGORIES.find((option) => option.value === category)?.label ??
    "Other"
  );
}

export function buildAiReport(input: AiReportInput): AiReportDraft {
  const response = input.response.trim().slice(0, MAX_REPORTED_RESPONSE_CHARS);
  const responseWasTruncated = input.response.trim().length > response.length;
  const subject = `PickPDF AI content report - ${MICROSOFT_STORE_PRODUCT_ID}`;
  const body = [
    "PickPDF AI content report",
    "",
    `Product ID: ${MICROSOFT_STORE_PRODUCT_ID}`,
    `App version: ${input.appVersion}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model}`,
    `Category: ${categoryLabel(input.category)}`,
    `Additional details: ${input.details.trim() || "None provided"}`,
    "",
    "Reported AI response:",
    "---",
    response,
    ...(responseWasTruncated ? ["[Response truncated to 2,000 characters]"] : []),
    "---",
    "",
    "This report was created by PickPDF. The user's prompt and PDF content are not attached.",
  ].join("\n");

  return {
    subject,
    body,
    mailto: `mailto:${AI_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

export async function openAiReportEmail(draft: AiReportDraft): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(draft.mailto);
    return;
  }

  const link = document.createElement("a");
  link.href = draft.mailto;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyAiReport(draft: AiReportDraft): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(draft.body);
    return;
  }

  const field = document.createElement("textarea");
  field.value = draft.body;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

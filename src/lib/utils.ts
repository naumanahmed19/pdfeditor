import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Annotation kinds that can be freely rotated. Excluded: notes (a fixed marker
 * icon), highlight/markup (glued to text lines), redactions (the destructive
 * region must stay axis-aligned) and form fields (AcroForm widgets are
 * axis-aligned).
 */
export const ROTATABLE_KINDS: ReadonlySet<string> = new Set([
  "text",
  "image",
  "rect",
  "ellipse",
  "line",
  "arrow",
  "ink",
  "whiteout",
]);

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download a text/HTML string as a file with the given MIME type. */
export function downloadText(
  content: string,
  filename: string,
  mime = "text/plain",
) {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename);
}

/** Download an already-built Blob (e.g. a generated .docx) as a file. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Parse a page-range expression like "1-3, 5, 8-10" into 0-based page indexes. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const out: number[] = [];
  for (const part of input.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        if (i >= 1 && i <= pageCount) out.push(i - 1);
      }
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1 && n <= pageCount) out.push(n - 1);
    }
  }
  return out;
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h.padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** Bundle files into a zip and download it (jszip loads lazily). */
export async function downloadZip(
  files: Array<{ name: string; data: Uint8Array | Blob }>,
  zipName: string,
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

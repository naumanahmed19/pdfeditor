/**
 * Client-side mirrors of the Acrobat AF format/validate presets, so our own
 * viewer (which has no JS engine) can show the same formatting the baked /AA
 * actions produce in Acrobat/Chrome. Used by the form-builder live preview.
 */
export type FieldFormat =
  | "none"
  | "number"
  | "currency"
  | "percent"
  | "phone"
  | "ssn"
  | "zip"
  | "email";

const num = (raw: string): number | null => {
  const n = parseFloat(raw.replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? null : n;
};

const with2 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Display form of a raw value for the given preset (falls back to raw). */
export function formatFieldValue(format: FieldFormat | undefined, raw: string): string {
  if (!raw || !format || format === "none") return raw;
  switch (format) {
    case "number": {
      const n = num(raw);
      return n === null ? raw : with2(n);
    }
    case "currency": {
      const n = num(raw);
      return n === null ? raw : `$${with2(n)}`;
    }
    case "percent": {
      const n = num(raw);
      return n === null ? raw : `${with2(n)}%`;
    }
    case "phone": {
      const d = raw.replace(/\D/g, "").slice(0, 10);
      return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
    }
    case "ssn": {
      const d = raw.replace(/\D/g, "").slice(0, 9);
      return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : raw;
    }
    case "zip": {
      const d = raw.replace(/\D/g, "").slice(0, 9);
      return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    }
    default:
      return raw;
  }
}

/** Validation message for a raw value, or null when it's acceptable/empty. */
export function fieldValueError(format: FieldFormat | undefined, raw: string): string | null {
  if (!raw || !format || format === "none") return null;
  switch (format) {
    case "email":
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? null : "Enter a valid email address";
    case "number":
    case "currency":
    case "percent":
      return num(raw) === null ? "Enter a number" : null;
    case "phone":
      return raw.replace(/\D/g, "").length === 10 ? null : "Enter a 10-digit phone number";
    case "ssn":
      return raw.replace(/\D/g, "").length === 9 ? null : "Enter a 9-digit SSN";
    case "zip": {
      const n = raw.replace(/\D/g, "").length;
      return n === 5 || n === 9 ? null : "Enter a 5- or 9-digit ZIP";
    }
    default:
      return null;
  }
}

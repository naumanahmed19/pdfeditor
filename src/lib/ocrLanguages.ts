/**
 * Curated OCR language list — kept in its own dependency-free module so the
 * store and Settings screen can import it statically without pulling
 * tesseract.js (loaded lazily by lib/ocr.ts) into the main bundle.
 *
 * Codes are Tesseract traineddata names, not BCP-47 (note "chi_sim"/"chi_tra").
 * The traineddata for a language is fetched once from tesseract.js's default
 * CDN and cached; the recognition itself always runs on-device.
 */

export interface OcrLanguage {
  /** Tesseract traineddata code, e.g. "deu" or "chi_sim". */
  code: string;
  /** English name. */
  label: string;
  /** Native name, where it differs from the English one. */
  native?: string;
}

export const DEFAULT_OCR_LANGUAGE = "eng";

// English first (the default), the rest alphabetical by English name.
export const OCR_LANGUAGES: readonly OcrLanguage[] = [
  { code: "eng", label: "English" },
  { code: "ara", label: "Arabic", native: "العربية" },
  { code: "ben", label: "Bengali", native: "বাংলা" },
  { code: "chi_sim", label: "Chinese (Simplified)", native: "简体中文" },
  { code: "chi_tra", label: "Chinese (Traditional)", native: "繁體中文" },
  { code: "ces", label: "Czech", native: "Čeština" },
  { code: "dan", label: "Danish", native: "Dansk" },
  { code: "nld", label: "Dutch", native: "Nederlands" },
  { code: "fin", label: "Finnish", native: "Suomi" },
  { code: "fra", label: "French", native: "Français" },
  { code: "deu", label: "German", native: "Deutsch" },
  { code: "ell", label: "Greek", native: "Ελληνικά" },
  { code: "heb", label: "Hebrew", native: "עברית" },
  { code: "hin", label: "Hindi", native: "हिन्दी" },
  { code: "hun", label: "Hungarian", native: "Magyar" },
  { code: "ind", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ita", label: "Italian", native: "Italiano" },
  { code: "jpn", label: "Japanese", native: "日本語" },
  { code: "kor", label: "Korean", native: "한국어" },
  { code: "nor", label: "Norwegian", native: "Norsk" },
  { code: "fas", label: "Persian", native: "فارسی" },
  { code: "pol", label: "Polish", native: "Polski" },
  { code: "por", label: "Portuguese", native: "Português" },
  { code: "ron", label: "Romanian", native: "Română" },
  { code: "rus", label: "Russian", native: "Русский" },
  { code: "slk", label: "Slovak", native: "Slovenčina" },
  { code: "spa", label: "Spanish", native: "Español" },
  { code: "swe", label: "Swedish", native: "Svenska" },
  { code: "tam", label: "Tamil", native: "தமிழ்" },
  { code: "tha", label: "Thai", native: "ไทย" },
  { code: "tur", label: "Turkish", native: "Türkçe" },
  { code: "ukr", label: "Ukrainian", native: "Українська" },
  { code: "vie", label: "Vietnamese", native: "Tiếng Việt" },
];

/** Dropdown options: "German — Deutsch", or just "English" where they match. */
export const OCR_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  OCR_LANGUAGES.map((l) => ({
    value: l.code,
    label: l.native ? `${l.label} — ${l.native}` : l.label,
  }));

/** A persisted code may predate the curated list (or be garbage) — anything
 *  unknown falls back to English rather than failing the worker download. */
export function normalizeOcrLanguage(code: string | null | undefined): string {
  return OCR_LANGUAGES.some((l) => l.code === code) ? (code as string) : DEFAULT_OCR_LANGUAGE;
}

/** English display name for a code; unknown codes read as the code itself. */
export function ocrLanguageLabel(code: string): string {
  return OCR_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

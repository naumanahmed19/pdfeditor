// Integrity of the curated OCR language list and its lookup helpers — the
// codes are shipped verbatim to tesseract.js as traineddata names, so a typo
// here means a broken model download at runtime.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_LANGUAGE,
  OCR_LANGUAGES,
  OCR_LANGUAGE_OPTIONS,
  normalizeOcrLanguage,
  ocrLanguageLabel,
} from "./ocrLanguages";

// The minimum coverage the feature promises (Tesseract traineddata codes).
const REQUIRED_CODES = [
  "eng", "deu", "fra", "spa", "ita", "por", "nld", "pol", "swe", "dan",
  "nor", "fin", "ces", "slk", "hun", "ron", "tur", "rus", "ukr", "ell",
  "ara", "heb", "fas", "hin", "ben", "tam", "tha", "vie", "ind", "jpn",
  "chi_sim", "chi_tra", "kor",
];

describe("OCR language list", () => {
  it("covers every required language", () => {
    const codes = new Set(OCR_LANGUAGES.map((l) => l.code));
    for (const code of REQUIRED_CODES) {
      expect(codes.has(code), `missing traineddata code "${code}"`).toBe(true);
    }
  });

  it("has unique codes and non-empty labels", () => {
    const codes = OCR_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of OCR_LANGUAGES) {
      expect(l.code.trim().length).toBeGreaterThan(0);
      expect(l.label.trim().length).toBeGreaterThan(0);
      if (l.native !== undefined) expect(l.native.trim().length).toBeGreaterThan(0);
    }
  });

  it("lists the default language first", () => {
    expect(DEFAULT_OCR_LANGUAGE).toBe("eng");
    expect(OCR_LANGUAGES[0].code).toBe(DEFAULT_OCR_LANGUAGE);
  });

  it("builds one dropdown option per language, native name included", () => {
    expect(OCR_LANGUAGE_OPTIONS.length).toBe(OCR_LANGUAGES.length);
    const german = OCR_LANGUAGE_OPTIONS.find((o) => o.value === "deu");
    expect(german?.label).toBe("German — Deutsch");
    // English has no distinct native name, so no dash suffix.
    const english = OCR_LANGUAGE_OPTIONS.find((o) => o.value === "eng");
    expect(english?.label).toBe("English");
  });
});

describe("normalizeOcrLanguage", () => {
  it("passes known codes through", () => {
    expect(normalizeOcrLanguage("chi_sim")).toBe("chi_sim");
    expect(normalizeOcrLanguage("ukr")).toBe("ukr");
  });

  it("falls back to the default for unknown or missing values", () => {
    expect(normalizeOcrLanguage("klingon")).toBe(DEFAULT_OCR_LANGUAGE);
    expect(normalizeOcrLanguage("")).toBe(DEFAULT_OCR_LANGUAGE);
    expect(normalizeOcrLanguage(null)).toBe(DEFAULT_OCR_LANGUAGE);
    expect(normalizeOcrLanguage(undefined)).toBe(DEFAULT_OCR_LANGUAGE);
  });
});

describe("ocrLanguageLabel", () => {
  it("resolves codes to English names", () => {
    expect(ocrLanguageLabel("jpn")).toBe("Japanese");
    expect(ocrLanguageLabel("eng")).toBe("English");
  });

  it("echoes unknown codes rather than guessing", () => {
    expect(ocrLanguageLabel("xyz")).toBe("xyz");
  });
});

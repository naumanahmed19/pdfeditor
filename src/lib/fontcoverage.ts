// Glyph-coverage preflight for in-place text edits. Embedded PDF fonts are
// almost always subsets — they only carry the glyphs the document already
// uses — so before rewriting a run's string with FPDFText_SetText we check
// that every new character actually has a glyph, instead of silently baking
// tofu/blank boxes into the file.

/**
 * Characters from `chars` that have no glyph in the given font program.
 * Returns null when the font can't be parsed (bare CFF subsets, broken
 * cmaps…) — coverage is then unverifiable, not necessarily missing.
 */
export async function missingGlyphs(
  fontData: Uint8Array,
  chars: string[],
): Promise<string[] | null> {
  try {
    // fontkit is large — load it only when a preflight actually runs.
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const font = fontkit.create(fontData) as unknown as {
      hasGlyphForCodePoint?: (cp: number) => boolean;
    };
    if (!font || typeof font.hasGlyphForCodePoint !== "function") return null;
    return chars.filter((c) => {
      const cp = c.codePointAt(0);
      return cp == null || !font.hasGlyphForCodePoint!(cp);
    });
  } catch {
    return null;
  }
}

/** Unique characters of `text` that appear in neither `existing` string. */
export function newCharacters(text: string, ...existing: string[]): string[] {
  const out: string[] = [];
  for (const c of new Set(text)) {
    if (c === "\n" || c === "\r") continue;
    if (existing.some((s) => s.includes(c))) continue;
    out.push(c);
  }
  return out;
}

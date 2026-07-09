import type { SearchOptions, SearchRange } from "../types";

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
  preserveCase: false,
  includePdfText: true,
  includeAnnotations: true,
  includeFormValues: true,
};

export interface SearchIndexPart {
  itemIndex: number;
  text: string;
}

interface CharRef {
  itemIndex: number;
  offset: number;
  virtual?: boolean;
}

export interface SearchIndex {
  text: string;
  refs: CharRef[];
}

export interface SearchHit {
  start: number;
  end: number;
  text: string;
  ranges: SearchRange[];
}

export interface CompiledSearch {
  regex: RegExp;
  singleRegex: RegExp;
  findAll: (text: string) => SearchHit[];
  replacementFor: (hit: Pick<SearchHit, "text">, replacement: string) => string;
}

const WORD_CLASS = String.raw`\p{L}\p{N}_`;

export function normalizeSearchOptions(
  options?: Partial<SearchOptions>,
): SearchOptions {
  return { ...DEFAULT_SEARCH_OPTIONS, ...(options ?? {}) };
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function literalToPattern(query: string): string {
  return query
    .trim()
    .split(/(\s+)/)
    .filter(Boolean)
    .map((part) => (/\s+/.test(part) ? String.raw`\s+` : escapeRegex(part)))
    .join("");
}

function buildPattern(query: string, options: SearchOptions): string {
  const body = options.regex ? query : literalToPattern(query);
  if (!options.wholeWord) return body;
  return String.raw`(?<![${WORD_CLASS}])(?:${body})(?![${WORD_CLASS}])`;
}

export function compileSearch(
  query: string,
  rawOptions?: Partial<SearchOptions>,
): CompiledSearch | { error: string } {
  const options = normalizeSearchOptions(rawOptions);
  const source = options.regex ? query : query.trim();
  if (!source) return { error: "Enter text to search for." };

  const flags = `g${options.matchCase ? "" : "i"}u`;
  const singleFlags = `${options.matchCase ? "" : "i"}u`;
  try {
    const pattern = buildPattern(query, options);
    const regex = new RegExp(pattern, flags);
    const singleRegex = new RegExp(pattern, singleFlags);
    return {
      regex,
      singleRegex,
      findAll: (text) => findAll(text, regex),
      replacementFor: (hit, replacement) => {
        const next = options.regex
          ? hit.text.replace(singleRegex, replacement)
          : replacement;
        return options.preserveCase ? preserveReplacementCase(hit.text, next) : next;
      },
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Invalid search pattern.",
    };
  }
}

function findAll(text: string, regex: RegExp): SearchHit[] {
  regex.lastIndex = 0;
  const hits: SearchHit[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    if (value.length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    hits.push({ start, end, text: value, ranges: [] });
  }
  regex.lastIndex = 0;
  return hits;
}

function shouldJoin(a: string, b: string): boolean {
  return !!a && !!b && !/\s$/.test(a) && !/^\s/.test(b);
}

export function buildSearchIndex(parts: SearchIndexPart[]): SearchIndex {
  let text = "";
  const refs: CharRef[] = [];
  let previous = "";

  for (const part of parts) {
    if (!part.text) continue;
    if (shouldJoin(previous, part.text)) {
      text += " ";
      refs.push({ itemIndex: part.itemIndex, offset: 0, virtual: true });
    }
    for (let i = 0; i < part.text.length; i++) {
      text += part.text[i];
      refs.push({ itemIndex: part.itemIndex, offset: i });
    }
    previous = part.text;
  }

  return { text, refs };
}

export function findInIndex(
  index: SearchIndex,
  query: string,
  options?: Partial<SearchOptions>,
): SearchHit[] | { error: string } {
  const compiled = compileSearch(query, options);
  if ("error" in compiled) return compiled;
  return compiled.findAll(index.text).map((hit) => ({
    ...hit,
    ranges: rangesForSpan(index, hit.start, hit.end),
  }));
}

export function rangesForSpan(
  index: SearchIndex,
  start: number,
  end: number,
): SearchRange[] {
  const ranges: SearchRange[] = [];
  for (let pos = start; pos < end; pos++) {
    const ref = index.refs[pos];
    if (!ref || ref.virtual) continue;
    const last = ranges[ranges.length - 1];
    if (
      last &&
      last.itemIndex === ref.itemIndex &&
      last.end === ref.offset
    ) {
      last.end = ref.offset + 1;
    } else {
      ranges.push({
        itemIndex: ref.itemIndex,
        start: ref.offset,
        end: ref.offset + 1,
      });
    }
  }
  return ranges;
}

export function replaceAllInText(
  text: string,
  query: string,
  replacement: string,
  options?: Partial<SearchOptions>,
): { text: string; count: number; error?: string } {
  const compiled = compileSearch(query, options);
  if ("error" in compiled) return { text, count: 0, error: compiled.error };
  const hits = compiled.findAll(text);
  let next = text;
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    next =
      next.slice(0, hit.start) +
      compiled.replacementFor(hit, replacement) +
      next.slice(hit.end);
  }
  return { text: next, count: hits.length };
}

export function replaceHitInText(
  text: string,
  hit: Pick<SearchHit, "start" | "end" | "text">,
  query: string,
  replacement: string,
  options?: Partial<SearchOptions>,
): { text: string; error?: string } {
  const compiled = compileSearch(query, options);
  if ("error" in compiled) return { text, error: compiled.error };
  return {
    text:
      text.slice(0, hit.start) +
      compiled.replacementFor(hit, replacement) +
      text.slice(hit.end),
  };
}

export function snippetAround(
  text: string,
  start: number,
  end: number,
  radius = 42,
): string {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  return `${a > 0 ? "..." : ""}${text.slice(a, b)}${b < text.length ? "..." : ""}`;
}

export function preserveReplacementCase(sample: string, replacement: string): string {
  if (!sample || !replacement) return replacement;
  if (sample === sample.toUpperCase() && /[A-Z]/i.test(sample)) {
    return replacement.toUpperCase();
  }
  if (sample === sample.toLowerCase()) {
    return replacement.toLowerCase();
  }
  if (/^[A-Z][a-z0-9_\W]*$/.test(sample)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }
  const words = sample.split(/\s+/);
  if (
    words.length > 1 &&
    words.every((w) => !/[A-Za-z]/.test(w) || /^[A-Z][a-z0-9_\W]*$/.test(w))
  ) {
    return replacement.replace(/\b([A-Za-z])([A-Za-z]*)/g, (_, a, rest) =>
      `${a.toUpperCase()}${String(rest).toLowerCase()}`,
    );
  }
  return replacement;
}

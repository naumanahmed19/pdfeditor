// Create-PDF pipeline: converts simple structured content (mammoth-generated
// HTML from a .docx, or plain/markdown-ish text) into a block model, then
// typesets the blocks into a Letter-page PDF with pdf-lib.
//
// The block model and all layout math (line wrap, pagination) are pure and
// measurement-agnostic so they can be unit-tested in node with a fake measure
// function; only htmlToBlocks (DOMParser) and blocksToPdf (pdf-lib fonts)
// touch the environment.
import { PDFDocument, PDFFont, StandardFonts } from "pdf-lib";

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type BlockKind = "h1" | "h2" | "h3" | "paragraph" | "li";

export interface Block {
  kind: BlockKind;
  runs: TextRun[];
  /** 1-based number for ordered-list items; bullet marker when absent. */
  ordinal?: number;
}

/** Width of `text` at `size` pt in the style's font. */
export type MeasureFn = (
  text: string,
  bold: boolean,
  italic: boolean,
  size: number,
) => number;

/* ---------------- WinAnsi sanitizing ---------------- */

// pdf-lib's standard fonts encode WinAnsi (CP1252) only and throw on anything
// outside it, so unencodable characters are replaced up front. The 0x80–0x9F
// block maps to these Unicode points in CP1252.
const WINANSI_EXTRA =
  "€‚ƒ„…†‡ˆ‰Š‹Œ" +
  "Ž‘’“”•–—˜™š›" +
  "œžŸ";
const NON_WINANSI = new RegExp(`[^\\x20-\\x7E\\xA0-\\xFF${WINANSI_EXTRA}]`, "g");

export function sanitizeWinAnsi(text: string): string {
  return text.replace(/\t/g, "  ").replace(NON_WINANSI, "?");
}

/* ---------------- Run normalization (pure) ---------------- */

/**
 * Collapse whitespace runs to single spaces, merge adjacent same-style runs,
 * drop empties and trim the block's leading/trailing space — HTML semantics
 * for inline content.
 */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const text = run.text.replace(/\s+/g, " ");
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic) {
      last.text += text;
    } else {
      out.push({ text, bold: !!run.bold || undefined, italic: !!run.italic || undefined });
    }
  }
  if (out.length) {
    out[0].text = out[0].text.replace(/^ +/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, "");
  }
  return out.filter((r) => r.text.length > 0);
}

const runsText = (runs: TextRun[]) => runs.map((r) => r.text).join("");

/* ---------------- HTML → blocks (DOM part, kept thin) ---------------- */

/**
 * Parse simple HTML (mammoth output) into blocks. Only h1–h6, p, ul/ol/li,
 * b/strong and i/em carry meaning; tables are flattened to one paragraph per
 * row, images and everything else unknown are skipped or recursed through.
 */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: Block[] = [];
  collectBlocks(doc.body, blocks);
  return blocks;
}

function collectBlocks(container: Element, blocks: Block[]): void {
  // Loose inline content between block elements accumulates into a paragraph.
  let pending: TextRun[] = [];
  const flush = () => {
    const runs = normalizeRuns(pending);
    pending = [];
    if (runs.length) blocks.push({ kind: "paragraph", runs });
  };

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3) {
      pending.push({ text: node.textContent ?? "" });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      flush();
      const level = Math.min(Number(tag[1]), 3);
      pushBlock(blocks, `h${level}` as BlockKind, collectRuns(el));
    } else if (tag === "p") {
      flush();
      pushBlock(blocks, "paragraph", collectRuns(el));
    } else if (tag === "ul" || tag === "ol") {
      flush();
      collectList(el, tag === "ol", blocks);
    } else if (tag === "table") {
      // Table structure is not preserved — each row becomes one paragraph
      // with cells joined so the content at least survives.
      flush();
      for (const row of Array.from(el.querySelectorAll("tr"))) {
        const cells = Array.from(row.querySelectorAll("th,td"))
          .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (cells.length) pushBlock(blocks, "paragraph", [{ text: cells.join("   ") }]);
      }
    } else if (tag === "br") {
      pending.push({ text: " " });
    } else if (tag === "img" || tag === "script" || tag === "style") {
      // skipped: no image support in the basic typesetter
    } else if (isInlineTag(tag)) {
      pending.push(...collectRuns(el));
    } else {
      // div/section/blockquote/... — recurse into container-ish elements.
      flush();
      collectBlocks(el, blocks);
    }
  }
  flush();
}

function collectList(list: Element, ordered: boolean, blocks: Block[]): void {
  let ordinal = 0;
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    ordinal += 1;
    // Direct inline content of the <li>; nested lists are flattened after it.
    const runs: TextRun[] = [];
    const nested: Element[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === 1) {
        const tag = (child as Element).tagName.toLowerCase();
        if (tag === "ul" || tag === "ol") {
          nested.push(child as Element);
          continue;
        }
      }
      runs.push(...runsFromNode(child, false, false));
    }
    pushBlock(blocks, "li", normalizeRuns(runs), ordered ? ordinal : undefined);
    for (const sub of nested) collectList(sub, sub.tagName.toLowerCase() === "ol", blocks);
  }
}

const INLINE_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "span", "code", "sub", "sup",
  "small", "mark", "abbr", "q", "cite", "time", "kbd",
]);
const isInlineTag = (tag: string) => INLINE_TAGS.has(tag);

function collectRuns(el: Element): TextRun[] {
  return normalizeRuns(runsFromNode(el, false, false));
}

function runsFromNode(node: Node, bold: boolean, italic: boolean): TextRun[] {
  if (node.nodeType === 3) {
    const text = node.textContent ?? "";
    return text ? [{ text, bold: bold || undefined, italic: italic || undefined }] : [];
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return [{ text: " " }];
  if (tag === "script" || tag === "style" || tag === "img") return [];
  const b = bold || tag === "b" || tag === "strong";
  const i = italic || tag === "i" || tag === "em";
  const out: TextRun[] = [];
  for (const child of Array.from(el.childNodes)) out.push(...runsFromNode(child, b, i));
  return out;
}

function pushBlock(blocks: Block[], kind: BlockKind, runs: TextRun[], ordinal?: number): void {
  if (!runsText(runs).trim()) return;
  blocks.push(ordinal !== undefined ? { kind, runs, ordinal } : { kind, runs });
}

/* ---------------- Plain / markdown-ish text → blocks (pure) ---------------- */

/**
 * Each non-blank line becomes a paragraph; blank lines insert vertical
 * spacing (an empty paragraph block). Markdown-ish prefixes are recognized:
 * #/##/### headings, dash/star/bullet list items and "1." / "1)" ordered items.
 */
export function textToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let blankPending = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) {
      blankPending = blocks.length > 0;
      continue;
    }
    if (blankPending) {
      blocks.push({ kind: "paragraph", runs: [] });
      blankPending = false;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: `h${heading[1].length}` as BlockKind, runs: [{ text: heading[2] }] });
      continue;
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "li", runs: [{ text: bullet[1] }] });
      continue;
    }
    const ordered = /^(\d{1,3})[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      blocks.push({ kind: "li", runs: [{ text: ordered[2] }], ordinal: Number(ordered[1]) });
      continue;
    }
    blocks.push({ kind: "paragraph", runs: [{ text: line }] });
  }
  return blocks;
}

/* ---------------- Line wrap (pure) ---------------- */

interface Token {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Joined to the previous token without a space (split mid-word by a style change). */
  glue?: boolean;
  width: number;
}

/**
 * Greedy word wrap across styled runs. Words wider than `maxWidth` are
 * character-split so no line overflows. Returns the runs of each line with
 * adjacent same-style words re-joined.
 */
export function wrapRuns(
  runs: TextRun[],
  maxWidth: number,
  size: number,
  measure: MeasureFn,
): TextRun[][] {
  const tokens: Token[] = [];
  let prevEndsWord = false;
  for (const run of runs) {
    const words = run.text.match(/\S+/g) ?? [];
    const startsGlued = !/^\s/.test(run.text) && prevEndsWord;
    words.forEach((text, i) => {
      tokens.push({
        text,
        bold: run.bold,
        italic: run.italic,
        glue: i === 0 && startsGlued ? true : undefined,
        width: measure(text, !!run.bold, !!run.italic, size),
      });
    });
    if (run.text.length) prevEndsWord = !/\s$/.test(run.text) && words.length > 0;
  }

  const lines: TextRun[][] = [];
  let line: Token[] = [];
  let width = 0;
  const flush = () => {
    if (line.length) lines.push(mergeLineTokens(line));
    line = [];
    width = 0;
  };

  for (const token of tokens) {
    const joinsPrev = line.length > 0 && token.glue;
    const space = line.length && !joinsPrev ? measure(" ", !!token.bold, !!token.italic, size) : 0;

    if (token.width > maxWidth) {
      // Oversized word: fill the current line's remainder is not attempted —
      // break, then emit full-width chunks, keeping the tail as the new line.
      flush();
      const chunks = splitOversized(token, maxWidth, size, measure);
      for (let i = 0; i < chunks.length - 1; i++) lines.push(mergeLineTokens([chunks[i]]));
      const tail = chunks[chunks.length - 1];
      line = [tail];
      width = tail.width;
      continue;
    }
    if (line.length && width + space + token.width > maxWidth) {
      flush();
      line = [{ ...token, glue: undefined }];
      width = token.width;
      continue;
    }
    line.push(token);
    width += space + token.width;
  }
  flush();
  return lines;
}

function splitOversized(token: Token, maxWidth: number, size: number, measure: MeasureFn): Token[] {
  const out: Token[] = [];
  let acc = "";
  for (const ch of token.text) {
    const next = acc + ch;
    if (acc && measure(next, !!token.bold, !!token.italic, size) > maxWidth) {
      out.push({ ...token, glue: undefined, text: acc, width: measure(acc, !!token.bold, !!token.italic, size) });
      acc = ch;
    } else {
      acc = next;
    }
  }
  out.push({ ...token, glue: undefined, text: acc, width: measure(acc, !!token.bold, !!token.italic, size) });
  return out;
}

function mergeLineTokens(tokens: Token[]): TextRun[] {
  const runs: TextRun[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const sep = i === 0 || t.glue ? "" : " ";
    const last = runs[runs.length - 1];
    if (last && !!last.bold === !!t.bold && !!last.italic === !!t.italic) {
      last.text += sep + t.text;
    } else {
      runs.push({ text: sep + t.text, bold: t.bold, italic: t.italic });
    }
  }
  return runs;
}

/* ---------------- Pagination (pure) ---------------- */

export interface BlockStyle {
  size: number;
  /** Baseline-to-baseline advance. */
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
  bold?: boolean;
}

export const BLOCK_STYLES: Record<BlockKind, BlockStyle> = {
  h1: { size: 24, lineHeight: 30, spaceBefore: 18, spaceAfter: 10, bold: true },
  h2: { size: 18, lineHeight: 23, spaceBefore: 14, spaceAfter: 8, bold: true },
  h3: { size: 14, lineHeight: 18, spaceBefore: 12, spaceAfter: 6, bold: true },
  paragraph: { size: 12, lineHeight: 16, spaceBefore: 0, spaceAfter: 8 },
  li: { size: 12, lineHeight: 16, spaceBefore: 0, spaceAfter: 3 },
};

export interface LayoutOptions {
  pageWidth: number;
  pageHeight: number;
  margin: number;
}

/** US Letter in PDF points. */
export const LETTER_LAYOUT: LayoutOptions = { pageWidth: 612, pageHeight: 792, margin: 72 };

/** Hanging indent for list item text; the marker sits in the indent. */
export const LIST_INDENT = 18;

export interface PlacedLine {
  page: number;
  x: number;
  /** Baseline measured DOWN from the page top (drawing flips to PDF coords). */
  y: number;
  size: number;
  runs: TextRun[];
}

/**
 * Typeset blocks into positioned lines: greedy wrap per block, cursor flow
 * down the page, new page when a line would cross the bottom margin. Heading
 * boldness is baked into the emitted runs.
 */
export function layoutBlocks(
  blocks: Block[],
  opts: LayoutOptions,
  measure: MeasureFn,
): PlacedLine[] {
  const out: PlacedLine[] = [];
  const maxY = opts.pageHeight - opts.margin;
  let page = 0;
  let y = opts.margin;
  let pageIsEmpty = true;

  for (const block of blocks) {
    const style = BLOCK_STYLES[block.kind];
    if (!runsText(block.runs).trim()) {
      // Blank spacer (blank source line) — vertical space only.
      if (!pageIsEmpty) y += style.lineHeight;
      continue;
    }
    const effective = block.runs.map((r) => ({ ...r, bold: (r.bold || style.bold) || undefined }));
    const indent = block.kind === "li" ? LIST_INDENT : 0;
    const width = opts.pageWidth - 2 * opts.margin - indent;
    const lines = wrapRuns(effective, width, style.size, measure);

    let cursor = pageIsEmpty ? y : y + style.spaceBefore;
    lines.forEach((runs, i) => {
      if (cursor + style.lineHeight > maxY) {
        page += 1;
        cursor = opts.margin;
      }
      cursor += style.lineHeight;
      if (i === 0 && block.kind === "li") {
        out.push({
          page,
          x: opts.margin,
          y: cursor,
          size: style.size,
          runs: [{ text: block.ordinal !== undefined ? `${block.ordinal}.` : "•" }],
        });
      }
      out.push({ page, x: opts.margin + indent, y: cursor, size: style.size, runs });
    });
    y = cursor + style.spaceAfter;
    pageIsEmpty = false;
  }
  return out;
}

/* ---------------- Blocks → PDF (pdf-lib) ---------------- */

export async function blocksToPdf(blocks: Block[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [regular, bold, italic, boldItalic] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
    doc.embedFont(StandardFonts.HelveticaBoldOblique),
  ]);
  const pick = (b?: boolean, i?: boolean): PDFFont =>
    b && i ? boldItalic : b ? bold : i ? italic : regular;

  const clean = blocks.map((b) => ({
    ...b,
    runs: b.runs.map((r) => ({ ...r, text: sanitizeWinAnsi(r.text) })),
  }));
  const measure: MeasureFn = (text, b, i, size) => pick(b, i).widthOfTextAtSize(text, size);
  const placed = layoutBlocks(clean, LETTER_LAYOUT, measure);

  const pageCount = placed.length ? Math.max(...placed.map((l) => l.page)) + 1 : 1;
  const pages = Array.from({ length: pageCount }, () =>
    doc.addPage([LETTER_LAYOUT.pageWidth, LETTER_LAYOUT.pageHeight]),
  );
  for (const line of placed) {
    let x = line.x;
    for (const run of line.runs) {
      const font = pick(run.bold, run.italic);
      pages[line.page].drawText(run.text, {
        x,
        y: LETTER_LAYOUT.pageHeight - line.y,
        size: line.size,
        font,
      });
      x += font.widthOfTextAtSize(run.text, line.size);
    }
  }
  return doc.save();
}

/* ---------------- File-type entry points ---------------- */

/** Convert a .docx via mammoth → HTML → blocks → PDF. Throws on parse failure. */
export async function docxToPdf(arrayBuffer: ArrayBuffer): Promise<Uint8Array> {
  // mammoth is CJS (~400 KB) — loaded on demand; Vite's interop may expose it
  // on `default` or as the namespace itself depending on the build.
  const mod = await import("mammoth");
  const mammoth = mod.default ?? mod;
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const blocks = htmlToBlocks(result.value);
  if (!blocks.length) throw new Error("No readable text found in the document");
  return blocksToPdf(blocks);
}

export async function textFileToPdf(text: string): Promise<Uint8Array> {
  const blocks = textToBlocks(text);
  if (!blocks.length) throw new Error("The file contains no text");
  return blocksToPdf(blocks);
}

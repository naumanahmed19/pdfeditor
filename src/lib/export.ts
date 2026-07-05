// Text / HTML export. PDFium gives us the page's text runs with geometry
// (`getTextObjects`), so we can reconstruct reading-order lines and do light
// block detection (headings by relative font size, paragraphs by line gaps) —
// far better than the space-joined blob `extractAllText` returns. Perfect
// structural fidelity is not the goal; a readable, copy-pastable document is.
import { getTextObjects, type TextObject } from "./pdfium";

interface Line {
  /** Baseline y in PDF points (origin bottom-left, so larger = higher). */
  y: number;
  /** Left edge of the first run. */
  x: number;
  /** Largest font size on the line. */
  size: number;
  text: string;
}

/** Reconstruct reading-order lines for one page. */
async function pageLines(bytes: Uint8Array, pageIndex: number): Promise<Line[]> {
  const runs = (await getTextObjects(bytes, pageIndex)).filter((o) => o.text.trim());
  const groups: { y: number; size: number; parts: TextObject[] }[] = [];
  for (const r of runs) {
    const g = groups.find((l) => Math.abs(l.y - r.originY) <= Math.max(2, r.fontSize * 0.4));
    if (g) {
      g.parts.push(r);
      g.size = Math.max(g.size, r.fontSize);
    } else {
      groups.push({ y: r.originY, size: r.fontSize, parts: [r] });
    }
  }
  groups.sort((a, b) => b.y - a.y); // top → bottom
  return groups
    .map((g) => {
      const parts = g.parts.sort((a, b) => a.left - b.left);
      let text = "";
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const next = parts[i + 1];
        text += p.text;
        // Insert a space where runs are visually separated but neither side
        // already carries one (PDFs often split words into runs).
        if (
          next &&
          next.left - p.right > 0.15 * g.size &&
          !p.text.endsWith(" ") &&
          !next.text.startsWith(" ")
        ) {
          text += " ";
        }
      }
      return { y: g.y, x: parts[0].left, size: g.size, text: text.replace(/\s+/g, " ").trim() };
    })
    .filter((l) => l.text);
}

/** Plain text: lines joined with newlines, pages separated by a form feed. */
export async function toPlainText(bytes: Uint8Array, numPages: number): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < numPages; i++) {
    const lines = await pageLines(bytes, i);
    out.push(lines.map((l) => l.text).join("\n"));
  }
  return out.join("\n\n\f\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** XML text escape for OOXML (.docx) parts. */
function escapeXml(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

export type BlockType = "h1" | "h2" | "p";
export interface Block {
  type: BlockType;
  text: string;
}

/**
 * Shared block detection used by HTML and DOCX export: per page, the median
 * font size sets the body baseline; noticeably larger lines become h1/h2;
 * runs of same-size lines with tight gaps join into paragraphs, a wide gap
 * starts a new one. Returns one block list per page.
 */
export async function documentBlocks(
  bytes: Uint8Array,
  numPages: number,
): Promise<Block[][]> {
  const pages: Block[][] = [];
  for (let i = 0; i < numPages; i++) {
    const lines = await pageLines(bytes, i);
    const blocks: Block[] = [];
    if (lines.length) {
      const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
      const median = sizes[Math.floor(sizes.length / 2)] || 12;
      let para: string[] = [];
      const flush = () => {
        if (para.length) {
          blocks.push({ type: "p", text: para.join(" ") });
          para = [];
        }
      };
      for (let j = 0; j < lines.length; j++) {
        const l = lines[j];
        const prev = lines[j - 1];
        const heading: BlockType | null =
          l.size >= median * 1.6 ? "h1" : l.size >= median * 1.28 ? "h2" : null;
        const gap = prev ? prev.y - l.y : 0; // vertical distance from prev line
        if (heading) {
          flush();
          blocks.push({ type: heading, text: l.text });
          continue;
        }
        if (prev && gap > l.size * 1.8) flush();
        para.push(l.text);
      }
      flush();
    }
    pages.push(blocks);
  }
  return pages;
}

/** Semantic HTML from the detected blocks; pages become `<section>`s. */
export async function toHtml(
  bytes: Uint8Array,
  numPages: number,
  title: string,
): Promise<string> {
  const pages = await documentBlocks(bytes, numPages);
  const body = pages.map((blocks, i) => {
    const inner = blocks.length
      ? blocks
          .map((b) =>
            b.type === "p"
              ? `<p>${escapeHtml(b.text)}</p>`
              : `<${b.type}>${escapeHtml(b.text)}</${b.type}>`,
          )
          .join("\n")
      : `<!-- page ${i + 1}: no text -->`;
    return `<section class="page">\n${inner}\n</section>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem;
    font: 16px/1.6 -apple-system, system-ui, sans-serif; color: #1a1a1a; }
  h1 { font-size: 1.7rem; margin: 1.4em 0 .4em; }
  h2 { font-size: 1.3rem; margin: 1.2em 0 .3em; }
  p { margin: 0 0 .8em; }
  .page { margin-bottom: 2.5rem; }
  .page + .page { border-top: 1px solid #eee; padding-top: 2rem; }
</style>
</head>
<body>
${body.join("\n")}
</body>
</html>`;
}

// --- DOCX -----------------------------------------------------------------
// A .docx is a zip of OOXML parts. We emit the minimal valid set:
// [Content_Types].xml, _rels/.rels, word/document.xml, word/styles.xml and
// word/_rels/document.xml.rels — headings use real Heading1/Heading2 styles
// (so Word's navigation pane and any TOC pick them up), page breaks separate
// source pages. Layout fidelity is not the goal; a clean, editable doc is.

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const DOCX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCX_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

function docxParagraph(block: Block): string {
  const style =
    block.type === "h1" ? "Heading1" : block.type === "h2" ? "Heading2" : null;
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
}

const DOCX_PAGE_BREAK = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

/** Build a .docx from the detected blocks and return it as a Blob. */
export async function toDocx(bytes: Uint8Array, numPages: number): Promise<Blob> {
  const pages = await documentBlocks(bytes, numPages);
  const paras: string[] = [];
  pages.forEach((blocks, i) => {
    if (i > 0) paras.push(DOCX_PAGE_BREAK);
    for (const b of blocks) paras.push(docxParagraph(b));
  });
  if (!paras.length) paras.push(`<w:p/>`);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paras.join("\n")}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", DOCX_CONTENT_TYPES);
  zip.file("_rels/.rels", DOCX_ROOT_RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", DOCX_STYLES);
  zip.file("word/_rels/document.xml.rels", DOCX_DOC_RELS);
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

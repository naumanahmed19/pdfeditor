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

/**
 * Semantic-ish HTML: median font size sets the body baseline; noticeably
 * larger lines become h1/h2; runs of same-size lines with tight gaps join
 * into paragraphs, a wide gap starts a new one.
 */
export async function toHtml(
  bytes: Uint8Array,
  numPages: number,
  title: string,
): Promise<string> {
  const body: string[] = [];
  for (let i = 0; i < numPages; i++) {
    const lines = await pageLines(bytes, i);
    if (!lines.length) {
      body.push(`<section class="page"><!-- page ${i + 1}: no text --></section>`);
      continue;
    }
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 12;

    const blocks: string[] = [];
    let para: string[] = [];
    const flush = () => {
      if (para.length) {
        blocks.push(`<p>${escapeHtml(para.join(" "))}</p>`);
        para = [];
      }
    };
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      const prev = lines[j - 1];
      const heading = l.size >= median * 1.6 ? "h1" : l.size >= median * 1.28 ? "h2" : null;
      // A big vertical gap from the previous line ends the current paragraph.
      const gap = prev ? prev.y - l.y : 0;
      if (heading) {
        flush();
        blocks.push(`<${heading}>${escapeHtml(l.text)}</${heading}>`);
        continue;
      }
      if (prev && gap > l.size * 1.8) flush();
      para.push(l.text);
    }
    flush();
    body.push(`<section class="page">\n${blocks.join("\n")}\n</section>`);
  }

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

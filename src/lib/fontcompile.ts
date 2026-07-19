// pdf.js as a font compiler: browser-loadable versions of the document's
// embedded fonts. PDFium hands the editor each run's raw font program
// (FPDFFont_GetFontData), but bare CFF / Type1 subsets can't be registered as
// a FontFace or parsed by fontkit, so those faces used to fall back to a CSS
// substitute in the inline editor. pdf.js already solves exactly this for its
// own canvas: its worker rebuilds every embedded font into a valid
// OpenType/TrueType container (cmap repair included) before rendering. We run
// a pdf.js document purely as that translator — no rendering, one page's
// operator list at a time — and feed the rebuilt programs to the FontFace
// preview and the fontkit glyph-coverage preflight.
//
// The rebuilt cmap maps Unicode the same way the browser will, so a coverage
// verdict from these bytes describes what the textarea can actually display.

export interface CompiledFont {
  /** BaseFont name as in the PDF, subset prefix included ("ABCDEF+Foo-Bold"). */
  name: string;
  /** Rebuilt OpenType/TrueType program (FontFace- and fontkit-loadable). */
  data: Uint8Array;
}

interface DocEntry {
  task: { destroy(): Promise<void> } | null;
  doc: Promise<unknown>;
  pages: Map<number, Promise<CompiledFont[]>>;
}

// Keyed by the STABLE document id, not the byte buffer. A text edit produces
// new bytes but the SAME document — and its embedded font programs don't
// change when text is edited — so keying on the id lets every edit reuse the
// one ~1s pdf.js parse instead of re-parsing the whole document each commit.
// (A substitute recreate can embed a new face the cached parse won't know,
// but compiled fonts are only read to FIND a borrow source, so missing a
// just-added face merely falls through — never wrong, just a missed reuse.)
// Old entries hold worker memory until destroyed, so evict beyond a couple.
const docCache = new Map<string, DocEntry>();
const MAX_DOCS = 2;

async function openDoc(docId: string, bytes: Uint8Array): Promise<DocEntry> {
  let entry = docCache.get(docId);
  if (entry) return entry;

  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  // Re-check: a concurrent first call may have created the entry while the
  // module was loading.
  entry = docCache.get(docId);
  if (entry) return entry;

  const task = pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker (detaching it) — never hand
    // over the store's live document bytes.
    data: bytes.slice(),
    // Translation only: no standard-font files to fetch, no rendering.
    useSystemFonts: true,
    disableFontFace: true,
    // Keep each translated program on the font object instead of freeing it
    // after load — the whole point of running pdf.js here.
    fontExtraProperties: true,
  });
  entry = { task, doc: task.promise, pages: new Map() };
  docCache.set(docId, entry);
  for (const [key, old] of docCache) {
    if (docCache.size <= MAX_DOCS) break;
    docCache.delete(key);
    old.task?.destroy().catch(() => undefined);
  }
  // A corrupt/encrypted document must not leave a rejected promise cached.
  entry.doc.catch(() => docCache.delete(docId));
  return entry;
}

/**
 * The rebuilt embedded fonts used on one page. Cached per (document id, page);
 * a failure resolves to [] so editing simply keeps today's fallbacks.
 */
export async function compiledFontsForPage(
  docId: string,
  bytes: Uint8Array,
  pageIndex: number,
): Promise<CompiledFont[]> {
  const entry = await openDoc(docId, bytes);
  let fonts = entry.pages.get(pageIndex);
  if (!fonts) {
    fonts = (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const doc = (await entry.doc) as {
          getPage(n: number): Promise<{
            getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
            commonObjs: { get(id: string): unknown };
          }>;
        };
        const page = await doc.getPage(pageIndex + 1);
        // Building the operator list is what makes the worker parse and
        // translate the page's fonts; its dependency ops name them.
        const ops = await page.getOperatorList();
        const ids = new Set<string>();
        ops.fnArray.forEach((fn, i) => {
          if (fn !== pdfjs.OPS.dependency) return;
          for (const id of ops.argsArray[i] as string[]) ids.add(id);
        });
        const out: CompiledFont[] = [];
        for (const id of ids) {
          if (!id.includes("_f")) continue; // fonts are "g_<doc>_f<n>"
          try {
            const obj = page.commonObjs.get(id) as {
              name?: unknown;
              data?: unknown;
            } | null;
            if (typeof obj?.name === "string" && obj.data instanceof Uint8Array) {
              out.push({ name: obj.name, data: obj.data });
            }
          } catch {
            /* unresolved or non-font dependency */
          }
        }
        return out;
      } catch {
        return [];
      }
    })();
    entry.pages.set(pageIndex, fonts);
  }
  return fonts;
}

/**
 * Fonts matching a PDFium base font name, best match first. Subset prefixes
 * count when both sides have them; a document can embed several subsets under
 * one base name with different coverage, so callers glyph-check each
 * candidate in order rather than trusting the first.
 */
export function compiledCandidates(
  fonts: CompiledFont[],
  baseFontName: string,
): CompiledFont[] {
  if (!baseFontName) return [];
  const strip = (n: string) => n.replace(/^[A-Z]{6}\+/, "");
  const exact = fonts.filter((f) => f.name === baseFontName);
  const loose = fonts.filter(
    (f) => f.name !== baseFontName && strip(f.name) === strip(baseFontName),
  );
  return [...exact, ...loose];
}

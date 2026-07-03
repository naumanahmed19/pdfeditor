# PDFium experiment (`pdfium-experiment` branch)

Prototype of `@embedpdf/pdfium` (v2.14.4, MIT) — a PDFium-WASM binding — to
validate two things pdf.js + pdf-lib can't do well in our stack:

1. **High-fidelity rasterization** (for "Export pages as PNG" and a render
   fallback for documents pdf.js draws wrong).
2. **True, destructive redaction** — the roadmap item whiteout can't satisfy.

## What was built

- [`src/lib/pdfium.ts`](src/lib/pdfium.ts) — lazy-loaded engine wrapper:
  - `getPdfium()` — loads + inits the WASM once. The wasm is **bundled locally**
    via `@embedpdf/pdfium/pdfium.wasm?url` (not the package's jsDelivr CDN
    default), keeping the app fully local-first.
  - `renderPage()` / `renderPageToCanvas()` — render a page to RGBA / a canvas.
  - `getPageCount()`.
  - `redactRegions(bytes, rects, { drawBlackBoxes })` — **true redaction**.
  - `getTextObjects(bytes, pageIndex)` — enumerate real text runs (geometry,
    font size, fill color, base font name).
  - `editTextObject(bytes, pageIndex, objectIndex, newText)` — **true in-place
    text edit** (see below).
- [`src/lib/pdfium_test.ts`](src/lib/pdfium_test.ts) — console harness (not
  shipped): `testRender`, `testRedaction`, `testEdit`, and `show*` variants.

Nothing is wired into the app UI yet — this branch only proves the engine.

## Results (verified in-browser)

| Capability   | Result |
|--------------|--------|
| Init + load  | ✅ loads, inits, opens a doc |
| Rasterize    | ✅ crisp text/vectors; a 200×120 pt page at 3× (600×360) in ~40–70 ms |
| **Redaction**| ✅ **destructive** — redacted text is gone from the saved bytes (pdf.js re-extract drops `SECRET-12345`, keeps `PUBLIC line`) and a black box is painted in place |
| **Edit text**| ✅ **in-place** — `Hello World` → `Howdy PDFium!` keeping the exact font (Helvetica), size (24), color and position; the original string is gone from the stream, no whiteout patch |

## How redaction works (the non-obvious part)

The annotation route (`FPDFPage_CreateAnnot(REDACT)` → set rect → QuadPoints →
`EPDFAnnot_ApplyRedaction`) returned `false` and stripped nothing. The primitive
EmbedPDF's own redaction plugin actually uses is:

```
EPDFText_RedactInQuads(page, quadsPtr, count, recurseForms, drawBlackBoxes)
FPDFPage_GenerateContent(page)
```

- `quadsPtr` = array of `FS_QUADPOINTSF` (8 floats each, page space / bottom-left
  origin), point order **TL, TR, BL, BR**.
- `recurseForms=true` also strips matching form-field content.
- `drawBlackBoxes=true` paints the fill so we don't need a separate cover.

Bytes are read back with `FPDF_SaveAsCopy` + an `FPDF_FILEWRITE` struct whose
`WriteBlock` is a JS callback registered via `addFunction(fn, "iiii")`.

## How PDFium improves "Edit existing text"

Today's editor (`Viewer.tsx › onTextLayerClick`) can't truly edit page text, so
it **fakes** it: cover the original line with a background-colored **whiteout**
patch, then drop an editable text box on top with a *best-effort* font match.
That has three inherent problems:

1. The original text still exists in the file — searchable/extractable/recoverable.
2. The whiteout is a solid color, so it's visible over gradients, images or
   textured backgrounds.
3. The font is only approximated (standard/bundled fallback); edited text can
   look different from its neighbors, especially in the saved file.

PDFium's page-object API fixes all three. `FPDFText_SetText` rewrites the string
of the actual content-stream text object **in place**, keeping its own embedded
font, size, color and matrix — so there's no patch, no font guessing, and the
old text is genuinely replaced. Verified: `getTextObjects` reports the run's
exact bounds/size/color/font name, and `editTextObject` swaps the text with the
result rendering in the identical face and position.

**Caveat — subset fonts:** a font embedded as a subset only carries the glyphs
the document already used. Typing a character that isn't in the subset won't
render. Great for correcting/replacing words with existing letters; for
arbitrary new text you'd fall back to re-embedding a font (what we do today).

**Integration — DONE (wired into the editor).** The whiteout+overlay hack is
gone. In edit-text mode a click now hit-tests the point against
`getTextObjects()` bounds, opens an inline editor over the run, and on commit
calls `applyTextEdit` → `editTextObject` swaps the doc bytes → the page
re-renders from real content. Details:

- **Store** (`store.tsx`): `applyTextEdit(page, objectIndex, text)` rewrites the
  base bytes and reloads pdf.js. Undo/redo is unified onto one timeline —
  each history step carries a `bytesHistory` base snapshot (`{bytes, pdf}`);
  annotation-only steps reuse the same reference (no copy/reload), a text edit
  pushes a new base, and undo restores both annotations and bytes/pdf together.
- **Viewer** (`Viewer.tsx`): `onTextLayerClick` → hit-test → `InlineTextEditor`
  (a transient textarea, not a persisted annotation) → commit/cancel.
- **Fallback:** if `editTextObject` fails (font can't take new glyphs) the user
  is told to overlay a correction with the Text tool.

Verified end-to-end: click a line → inline editor prefilled with the run text →
type → Enter rewrites it in place; pdf.js re-extract confirms the change; Ctrl+Z
restores the previous bytes; edited bytes persist across reload.

## Cost

- `pdfium.wasm` ≈ **4.6 MB** (5 MB on disk). Lazy-loaded on first use only, so it
  never touches the initial bundle.

## Recommendation

Both target capabilities work. Next steps to productionize (separate PRs):

- Wire `redactRegions` behind a **Redact** tool: draw rectangles over content →
  confirm → apply → replace the doc bytes. This finally satisfies the "true
  redaction" TODO and lets us drop the whiteout-isn't-redaction caveat for that
  path.
- Optionally use `renderPage` for "Export pages as PNG" and as an opt-in
  render fallback.
- A full pdf.js → PDFium migration is **not** recommended yet: edit-text font
  detection, the form designer/filler and search marks are wired to pdf.js
  APIs, and the fidelity/perf win doesn't currently justify rewiring them.

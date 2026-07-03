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
- [`src/lib/pdfium_test.ts`](src/lib/pdfium_test.ts) — console harness (not
  shipped): `testRender`, `testRedaction`, `showRender`, `showRedaction`.

Nothing is wired into the app UI yet — this branch only proves the engine.

## Results (verified in-browser)

| Capability   | Result |
|--------------|--------|
| Init + load  | ✅ loads, inits, opens a doc |
| Rasterize    | ✅ crisp text/vectors; a 200×120 pt page at 3× (600×360) in ~40–70 ms |
| **Redaction**| ✅ **destructive** — redacted text is gone from the saved bytes (pdf.js re-extract drops `SECRET-12345`, keeps `PUBLIC line`) and a black box is painted in place |

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

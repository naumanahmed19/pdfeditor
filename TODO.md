# TODO

## Proper form builder (priority)

The current field designer (Field menu + drag placeholders) is minimal.
Replace it with a dedicated form-builder experience:

- [ ] Form-design mode with a field palette (sidebar), not a toolbar menu
- [ ] Properties panel per field: name, tooltip, default value, required,
      read-only, font size, text alignment, multiline toggle, max length
- [ ] Alignment guides, snapping and optional grid while placing/moving
- [ ] Multi-select, copy/paste, and duplicate fields
- [ ] Tab-order management (reorder focus sequence)
- [ ] Field list / outline view of all fields in the document
- [ ] Radio group manager: create a group with N labeled options at once
- [ ] Checkbox export values; dropdown editable + multi-select option lists
- [ ] More field types: date, signature field, button
- [ ] Live preview toggle (design ↔ fill) without leaving the builder
- [ ] Validation: duplicate field names, empty dropdown options, overlaps

## Evaluate @embedpdf/pdfium (PDFium engine)

EmbedPDF (embedpdf.com, MIT) is an actively maintained PDFium-WASM binding +
viewer framework — v2.14.x as of mid-2026, near-complete PDFium API surface
(text geometry, annotations, forms). Evaluation plan:

> **Prototype done** on the `pdfium-experiment` branch — see
> [PDFIUM_EXPERIMENT.md](PDFIUM_EXPERIMENT.md). Rasterization and true redaction
> both verified working (`src/lib/pdfium.ts`); not yet wired into the UI.

- [x] Proof-of-concept: lazy-loaded PDFium engine (`getPdfium`), page
      rasterization (`renderPage`/`renderPageToCanvas`) and destructive
      redaction (`redactRegions` via `EPDFText_RedactInQuads`), wasm bundled
      locally, ~4.6 MB loaded on demand only
- [x] Wire rasterization into "Export pages as PNG" (`renderPage`)
- [ ] Opt-in render fallback for documents pdf.js draws incorrectly
- [x] Wire `redactRegions` behind a **Redact tool** — draw black boxes with the
      Redact tool, then **Apply redactions** destructively strips the covered
      text/content (also enforced on save, so nothing leaks under an un-applied
      box). Image-only regions are covered but the underlying image object isn't
      yet removed — text redaction is fully destructive.
- [ ] Long term: benchmark their engine + plugins (selection, search,
      annotations, forms) against our pdf.js stack as a potential migration —
      only worth it if fidelity/perf wins are clear, since edit-text font
      detection, form designer/filler and search marks are wired to pdf.js APIs
- [ ] Desktop build alternative: pdfium-render (Rust) on the Tauri backend for
      native-speed rasterization without WASM bundle cost

## Other deferred items

- [x] OCR for scanned PDFs (tesseract.js) — adds an invisible searchable text
      layer so search/select/edit/AI work on scans (Tools → Make searchable)
- [x] True redaction (strip text from content stream, not whiteout) — shipped as
      the **Redact tool** (`redactRegions` via PDFium `EPDFText_RedactInQuads`)
- [x] Sticky notes / comments with popups (Comment tool → `NoteAnnotation`)
- [ ] Search across text-run boundaries, case/whole-word options
- [ ] Two-page spread view

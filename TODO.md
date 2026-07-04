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

## PDFium engine (@embedpdf/pdfium)

> **Migration complete** — pdf.js has been removed entirely; PDFium
> (`src/lib/engine.ts`) now handles rendering, text layer geometry, search
> text, annotations and forms behind a pdf.js-compatible API surface. See
> [PDFIUM_EXPERIMENT.md](PDFIUM_EXPERIMENT.md) for the original evaluation.

- [x] Proof-of-concept: lazy-loaded PDFium engine (`getPdfium`), page
      rasterization (`renderPage`/`renderPageToCanvas`) and destructive
      redaction (`redactRegions` via `EPDFText_RedactInQuads`), wasm bundled
      locally, ~4.6 MB loaded on demand only
- [x] Wire rasterization into "Export pages as PNG" (`renderPage`)
- [x] Wire `redactRegions` behind a **Redact tool** — draw black boxes with the
      Redact tool, then **Apply redactions** destructively strips the covered
      text/content (also enforced on save, so nothing leaks under an un-applied
      box). Image-only regions are covered but the underlying image object isn't
      yet removed — text redaction is fully destructive.
- [x] Full migration off pdf.js: rendering, text layer, search, annotations and
      forms all run on PDFium (`engine.ts` exposes pdf.js-shaped APIs so
      callers didn't change); `pdfjs-dist` dependency removed
- [ ] Redaction: remove the underlying image object for image-only regions
      (currently covered but still present in the file)
- [ ] Desktop build alternative: pdfium-render (Rust) on the Tauri backend for
      native-speed rasterization without WASM bundle cost

## Other deferred items

- [x] OCR for scanned PDFs (tesseract.js) — adds an invisible searchable text
      layer so search/select/edit/AI work on scans (Tools → Make searchable)
- [x] True redaction (strip text from content stream, not whiteout) — shipped as
      the **Redact tool** (`redactRegions` via PDFium `EPDFText_RedactInQuads`)
- [x] Sticky notes / comments with popups (Comment tool → `NoteAnnotation`)
- [x] Lock to PickPDF — wrapper PDF with a notice page + the real document
      embedded as an AES-256-GCM payload (PBKDF2 key), so browser viewers that
      ignore permission flags can't read the content at all; PickPDF detects,
      prompts and unwraps; saves re-wrap automatically
- [x] Document security — proper two-password model (File → Protect document):
      AES-256 open password, permission restrictions behind a separate owner
      password (`EPDF_SetEncryption`), in-app enforcement (edit tools/print/copy
      gated on restricted docs, unlock via `EPDF_UnlockOwnerPermissions`), and
      Remove protection requires owner rights (`EPDF_RemoveEncryption`)
- [ ] Certificate-based digital signatures (PKI) — drawn/typed signatures exist,
      cryptographic signing does not
- [ ] Search across text-run boundaries, case/whole-word options
- [ ] Two-page spread view

## Feature gaps (not yet started)

Absent capabilities users coming from Acrobat / PDF-XChange / Sejda expect,
plus a few differentiators. Roughly ordered by effort-to-value within each group.

### Annotation quick wins (cheap — the annotation pipeline already exists)

- [ ] Underline / strikethrough / squiggly markup on EXISTING document text
      (same select-then-mark path as highlight-from-selection)
- [ ] Arrows and callouts (arrow = the line tool + a head)
- [ ] Predefined stamps — APPROVED / DRAFT / CONFIDENTIAL / date stamps
      (reuse the image-stamp mechanism from signatures)
- [ ] Copy / paste / duplicate annotations (only pages can be duplicated today)

### Document tools

- [ ] Compress / optimize (image downsampling, reduce file size) — a staple
      absent from the Tools screen
- [ ] Crop pages / resize page boxes
- [ ] Outline / bookmark EDITING (add / rename / remove entries; reading exists)
- [ ] Custom headers / footers — text, date, page-range; more than the two
      bottom page-number positions available now (Bates numbering fits here)
- [ ] Attachments panel — view / add embedded files
- [ ] Explicit Flatten command (baking happens implicitly on save today)

### Export

- [ ] Export to Word / plain text / HTML (only per-page PNG export exists,
      despite text already being extracted for the AI assistant)

### AI differentiators

- [ ] AI form-fill — "fill this form from this document / text" (local AI +
      the existing form filler make this a natural, differentiating combo)
- [ ] Semantic search / RAG over the document (chat currently sends raw
      extracted text; embeddings would handle long documents)
- [ ] Document comparison / visual diff of two PDFs (PDFium rasterization
      makes a pixel diff feasible)

### Viewer / print

- [ ] Hand / pan tool
- [ ] Print options — page range, scale (currently just window.print via iframe)

### Housekeeping

- [ ] Internationalization (i18n) — English-only today
- [ ] Autosave / backup / file versioning
- [ ] Test infrastructure (no unit/integration tests exist)
- [ ] PDF/A conversion or validation
- [ ] Accessibility: tagged-PDF support, reading order
- [ ] Rebrand the `landing/` page — it still says "Inkden"; the app is PickPDF

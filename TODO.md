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
      cryptographic signing does not. Required for legal/business workflows;
      drawn signatures don't count there. Scope:
      - Sign with a user-supplied certificate (.p12/.pfx), embedding a
        ByteRange + PKCS#7 (CAdES/PAdES-style) signature dictionary
      - Signature FIELDS in the form designer (place a field others sign)
      - Verify + display existing signatures — validity, signer, whether the
        document changed since signing (panel in the sidebar)
      - Tauri desktop: OS certificate store / smartcard access is feasible;
        browser build may be sign-only with an imported cert
- [ ] Search across text-run boundaries, case/whole-word options
- [ ] Two-page spread view

## Feature gaps (not yet started)

Absent capabilities users coming from Acrobat / PDF-XChange / Sejda expect,
plus a few differentiators. Roughly ordered by effort-to-value within each group.

### Annotation quick wins (cheap — the annotation pipeline already exists)

- [x] Underline / strikethrough / squiggly markup on EXISTING document text —
      select text then click the tool (same path as highlight), or drag a box;
      clicking a mark with its tool armed removes it (`MarkupAnnotation`)
- [x] Arrows and callouts — Arrow tool (drag tail → head, resize-safe relative
      endpoints) and Callout tool (drag from target: arrow + linked text box
      sharing a groupId, deleted together)
- [x] Predefined stamps — APPROVED / DRAFT / CONFIDENTIAL / VOID / date stamps
      generated on canvas (`lib/stamps.ts`), placed via the pending-stamp flow
- [x] Copy / paste / duplicate annotations — Ctrl+C/V/D + toolbar Duplicate;
      group-aware (callout pairs, highlight quads travel together)
- [x] Rotate annotations — drag the round handle above a selected object
      (soft 15° snapping, Shift forces it) or the toolbar Rotate 90° button;
      applies to text boxes, images/stamps, shapes, lines, arrows, ink and
      whiteout; baked via a content-stream rotation about the box center
      (`rotation` on `BaseAnnotation`)

### Content editing (biggest gap vs Acrobat / Foxit / PDF-XChange)

The pro desktop editors all offer true content editing; our inline text edit
is a single-run patch tool. This is the largest perceived-quality gap in a
head-to-head comparison.

- [ ] Paragraph-level text editing with reflow — detect the paragraph block
      around the edited run (text-layer geometry already gives line boxes),
      re-wrap lines on insert/delete instead of overflowing or gapping a
      single run, rewrite the affected content-stream text objects
- [ ] Font matching for edited/added text — reuse the document's embedded
      font where possible (subset it further via fontkit, already a dep);
      fall back to the visually closest bundled font instead of a default,
      so edits don't visibly mismatch the surrounding text
- [ ] Edit properties of EXISTING document text — font size, color,
      bold/italic on a selection (not just on annotations)
- [ ] Image object editing — insert, replace, move, resize and delete images
      that are part of the page content (PDFium `FPDFPageObj_*` /
      `FPDFImageObj_*` APIs; the Compress tool already re-encodes image
      objects, so the plumbing exists). Also unblocks the redaction
      image-removal item above.

### Document tools

- [x] Compress / optimize — Tools → Compress: downsamples images above a
      target dpi and re-encodes (JPEG, or PNG when transparent) via
      `EPDFImageObj_SetJpeg/SetPng`; reports before/after sizes
- [x] Crop pages — Tools → Crop: drag the keep-box on a page preview, apply to
      page/range/all; sets CropBox, optional permanent MediaBox rewrite
- [x] Outline / bookmark EDITING — sidebar Outline tab → Edit: add / rename /
      remove / reorder / retarget entries; whole tree rewritten on save
      (`setOutline`, pdf-lib)
- [x] Custom headers / footers — Tools → Headers & footers: 6 slots with
      {page} {pages} {date} {bates} tokens, page ranges, Bates numbering
      (prefix/suffix/start/digits)
- [x] Attachments panel — sidebar Attachments tab: view / add / save / remove
      embedded files (PDFium `FPDFDoc_AddAttachment` & co.)
- [x] Explicit Flatten command — Tools menu → Flatten document
      (`FPDFPage_Flatten` on every page, after the usual annotation bake)

### Export

Table stakes for the category — every competitor (including the free web
tools) has this; we only export per-page PNG. Cheapest big win: the text is
already extracted per page for the AI assistant.

- [ ] Export to plain text — dump the existing extraction, page markers
      optional (nearly free)
- [ ] Export to HTML — extraction + basic block detection (headings by font
      size, paragraphs by line gaps), inline images optional
- [ ] Export to Word (.docx) — generate client-side (a .docx is a zip of XML;
      jszip is already a dep), mapping the same block detection to Word
      paragraphs/headings; perfect layout fidelity is NOT the bar —
      competitors are imperfect here too
- [ ] Table detection → CSV/Excel export (stretch; column clustering over
      text-run x-positions)

### AI differentiators

- [ ] AI form-fill — "fill this form from this document / text" (local AI +
      the existing form filler make this a natural, differentiating combo)
- [ ] Semantic search / RAG over the document (chat currently sends raw
      extracted text; embeddings would handle long documents)
- [ ] Document comparison / visual diff of two PDFs (PDFium rasterization
      makes a pixel diff feasible) — Acrobat/Foxit/PDF-XChange all have this,
      web tools don't. Two modes: pixel diff (rasterize both at matched dpi,
      highlight changed regions) and text diff (extracted text, word-level,
      rendered side-by-side in the existing split view)

### Viewer / print

- [ ] Hand / pan tool
- [ ] Print options — page range, scale (currently just window.print via iframe)

### Housekeeping

- [ ] Internationalization (i18n) — English-only today
- [ ] Autosave / backup / file versioning
- [ ] Test infrastructure (no unit/integration tests exist)
- [ ] PDF/A conversion or validation — matters for government/legal/archival
      buyers; start with validation (report violations: unembedded fonts,
      encryption, transparency) before attempting conversion
- [ ] Accessibility: tagged-PDF support, reading order — enterprise/public-
      sector requirement (Section 508 / EN 301 549); minimum viable: preserve
      existing tags through save (verify we don't strip them today), then a
      reading-order checker
- [ ] Rebrand the `landing/` page — it still says "Inkden"; the app is PickPDF

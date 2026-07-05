# TODO

## Proper form builder (priority)

> **Shipped** — dedicated builder mode (toolbar **Form** button / sidebar Form
> tab): palette + snapping/grid prefs + validation + field outline live in the
> sidebar (`components/form/FormBuilderPanel.tsx`), snapping/validation math in
> `lib/formbuilder.ts`.

- [x] Form-design mode with a field palette (sidebar), not a toolbar menu
- [x] Properties panel per field: name, tooltip, default value, required,
      read-only, font size, text alignment, multiline toggle, max length
      (+ export value, date format, dropdown flags, button caption)
- [x] Alignment guides, snapping and optional grid while placing/moving —
      edges/centers/page-center guides, Alt suspends, grid size configurable
- [x] Multi-select, copy/paste, and duplicate fields — Shift-click, Ctrl+A
      (page), group drag/nudge/delete, align + distribute tools popover
- [x] Tab-order management (reorder focus sequence) — outline ▲▼ reorder;
      creation order = per-page /Annots order in the saved PDF
- [x] Field list / outline view of all fields in the document (new fields in
      tab order + existing AcroForm widgets with delete/restore)
- [x] Radio group manager: create a group with N labeled options at once
      (stacked or in a row, optional text labels grouped with each radio)
- [x] Checkbox export values; dropdown editable + multi-select option lists
- [x] More field types: date (AFDate format actions), signature field
      (unsigned /Sig widget — viewers offer their signing UI), push button
- [x] Live preview toggle (design ↔ fill) without leaving the builder —
      fields render as real inputs; values keyed by field name (mirroring)
- [x] Validation: duplicate field names, empty dropdown options, overlaps
      (+ empty names, mixed-type name clashes, duplicate radio exports,
      default text longer than max length) — click an issue to jump to it
- [x] Drag-and-drop fields from the palette onto the page (drop-target ring,
      grid snap + clamp on drop); click-to-arm still works
- [x] On-screen fields render their configured border/width/style +
      background (design, read and live-preview); focus cue echoes the
      field's own border color instead of a fixed blue (PDF has no
      per-field focus color)
- [x] Sidebar reorg: Pages + Outline direct tabs, then a "More" overflow
      menu (Comments, Attachments, Form) so the tab row stays uncluttered
- [ ] Form-builder polish (deferred): marquee/rubber-band selection, drag
      reorder in the outline, field property copy between fields

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
now works at LINE level with font fidelity (see shipped items below) — the
remaining gap to the pros is paragraph reflow and image objects.

- [ ] Paragraph-level text editing with reflow — detect the paragraph block
      around the edited run (text-layer geometry already gives line boxes),
      re-wrap lines on insert/delete instead of overflowing or gapping a
      single run, rewrite the affected content-stream text objects
- [x] Font matching for edited text — in-place edits ALWAYS keep the
      document's embedded face (`FPDFText_SetText`); toolbar shows the real
      font name with replacement as an explicit "Replace:" choice; the
      recreate path prefers a same-family face embedded in the doc
      (`FPDFFont_GetFontData` + coverage check) before falling back to the
      closest bundled family; glyph-coverage preflight (fontkit) blocks
      edits whose characters the embedded subset can't render, offering a
      one-click "Replace font" fallback for just the edited run(s)
- [x] Edit properties of EXISTING document text — line-level via the Edit
      text tool: color, size (baseline-anchored scale about the line origin),
      bold/italic synthesized on the original face (fill+stroke render mode /
      baseline shear); un-bold/un-italic recreates with a matched face.
      Whole visual line is edited as one string (runs grouped by baseline,
      diff mapped back per run). Remaining: arbitrary sub-line selections
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

> **Mostly shipped** — Tools → Export (`ExportScreen`, `lib/export.ts`):
> plain text, HTML and PNG in one place (PNG moved out of Split & extract).

- [x] Export to plain text — reconstructs reading-order lines from PDFium text
      runs (`getTextObjects`, not the space-joined blob), pages separated by a
      form feed. Warns and points to OCR when a page has no extractable text
- [x] Export to HTML — same line reconstruction + block detection: median font
      size sets the body baseline, larger lines become h1/h2, tight line gaps
      join into paragraphs; styled, self-contained `.html`
- [x] Export to Word (.docx) — client-side OOXML package built with jszip
      (`toDocx` in `lib/export.ts`): shares `documentBlocks` with HTML export,
      emits real Heading1/Heading2 styles (navigable in Word) + paragraphs,
      source pages separated by page breaks. Minimal valid part set
      ([Content_Types], rels, document.xml, styles.xml); verified well-formed
- [ ] Table detection → CSV/Excel export (stretch; column clustering over
      text-run x-positions)
- [ ] HTML/DOCX export: inline the page images (currently text-only)

### AI differentiators

- [ ] AI form-fill — "fill this form from this document / text" (local AI +
      the existing form filler make this a natural, differentiating combo)
- [ ] Semantic search / RAG over the document (chat currently sends raw
      extracted text; embeddings would handle long documents)
- [x] Document comparison / visual diff of two PDFs — Tools → Compare
      documents (`CompareScreen`, `lib/compare.ts`): pick a second PDF (stays
      local), then per page either a **text diff** (word-level LCS, added/
      removed highlighted inline) or a **pixel diff** (both pages rasterized
      via PDFium at a matched scale; changed pixels tinted red over a faded
      base, with a % changed readout). Handles differing page counts
      ("only in A / only in B"). Remaining: OCR-tolerant alignment for
      reflowed pages, side-by-side (not unified) text view

### Viewer / print

- [x] Hand / pan tool — toolbar **Pan** tool (grab cursor, drag the scroll
      surface); a non-editing viewing mode like Read (`tool: "pan"`)
- [x] Two-page spread — zoom menu → **Two-page spread**: pages laid out two-up
      in rows, fit-width/fit-page account for the pair width, page tracking is
      spread-aware. Remaining: cover-page-alone option
- [x] Print options — **Print dialog** (`PrintModal`): page range (all /
      current / custom ranges) and scale (fit / actual / custom %). Builds a
      subset+scaled PDF (`buildPrintDoc`, pdf-lib `embedPages`) then prints via
      the existing iframe path; annotations are baked first

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

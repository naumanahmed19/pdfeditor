# TODO

## Priorities — path to "best PDF editor" (gap analysis 2026-08-15)

Feature *breadth* is already competitive. Paragraph reflow, image replacement,
annotation import/round-trip, multi-language OCR, layers, measurements,
PDF/A validation, a command palette and grouped searchable editor tools have
shipped. The remaining gap is industry-grade reliability, interoperability,
compliance and automation. Ranked order of attack:

1. **Real-PDF compatibility corpus and save-path harness** — add versioned
   Office exports, scans, signed/tagged PDFs, CAD/layered files, malformed PDFs,
   unusual fonts and 50–500 MB documents. In CI, run open → edit → save →
   reopen assertions for text, images, annotations, forms, encryption,
   signatures, layers, attachments and tags. Add an external-viewer release
   checklist for Acrobat, Foxit/PDF-XChange, Chrome and macOS Preview.
2. **Security completion** — add search/pattern redaction, a reviewed PII
   suggestion flow, document sanitization (metadata, annotations, attachments,
   hidden layers and embedded content), and a pre-export inspection report.
3. **Digital-signature depth** — warn before every operation that invalidates
   a signature, then add incremental saves, OS certificate/smartcard access,
   ECDSA verification/signing and RFC 3161 timestamps.
4. **OCR and conversion fidelity** — add OCR confidence review plus
   deskew/despeckle/rotation correction; improve PDF→DOCX layout fidelity and
   add table extraction before broadening to more weak conversion formats.
5. **Native desktop automation** — batch queues, file associations, a CLI,
   reliable disk save and recovery for large documents, then optional native
   PDFium rendering.
6. **Accessibility and archival compliance** — preserve and validate tagged
   PDF structure, expose reading-order checks/repair, add accessibility reports,
   then move from PDF/A validation to conversion where safe.

Do not prioritize more annotation shapes or more AI chat actions until the
reliability, security and workflow gaps above have objective release evidence.

## Proper form builder (priority)

> **Shipped** — dedicated builder mode (toolbar **Form** button / sidebar Form
> tab): palette + snapping/grid prefs + validation + field outline live in the
> sidebar (`components/form/FormBuilderPanel.tsx`), snapping/validation math in
> `lib/formbuilder.ts`.

- [x] Form-design mode with a field palette (sidebar), not a toolbar menu
- [x] Properties panel per field: name, tooltip, default value, required,
      read-only, font size, text alignment, multiline toggle, max length
      (+ export value, date format, dropdown flags, button caption, text
      color, comb/password toggles, format/validation preset)
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
- Adobe/PDFium form-field parity pass (mostly shipped):
      - [x] Designer support for list boxes (single + multi-select) — palette
        "Show as list box" toggle + multi-select flag; save path emits
        `createOptionList`/`/MultiSelect`, fill view renders a real `<select
        multiple>`
      - [x] Comb text fields (fixed character cells) with max length, preview,
        saved `/Comb` flag and PDFium appearance regeneration; fill view uses a
        native `<input>` with per-cell caret/overwrite editing
      - [x] Masked/password text fields via the standard `/Password` flag, plus
        in-app preview that displays bullets
      - [x] Input masks and validation presets (SSN, phone, ZIP, email,
        currency/number/percent) via Acrobat-compatible /AA format+validate
        JavaScript; our no-JS viewer mirrors them client-side in the builder
        preview AND the fill view (engine reads the /AA JS back to a preset)
      - [x] Submit/reset button actions (delegated to PDFium's form engine on
        click); print/custom-JavaScript actions still deferred (no-JS engine)
      - [ ] Add image-upload/image-button workflow where possible; likely custom
        button + image annotation replacement rather than a universal AcroForm
        field
      - [ ] Add barcode generation support as generated PDF content/appearance
        (Acrobat live barcode fields are not simple PDFium-native fields)
      - [ ] Document Adobe Sign-only workflow fields that are out of AcroForm scope
        unless we build a signing/workflow backend: payment, transaction number,
        signer identity fields, participation stamp, routing/attachment fields

## PDFium engine (@embedpdf/pdfium)

> **Primary migration complete** — PDFium (`src/lib/engine.ts`) handles
> rendering, text geometry, search, annotations and forms. `pdfjs-dist` remains
> as a narrow lazy fallback in `lib/fontcompile.ts` for recovering embedded
> font programs that PDFium exposes in formats fontkit cannot parse. See
> [PDFIUM_EXPERIMENT.md](PDFIUM_EXPERIMENT.md) for the original evaluation.

- [x] Proof-of-concept: lazy-loaded PDFium engine (`getPdfium`), page
      rasterization (`renderPage`/`renderPageToCanvas`) and destructive
      redaction (`redactRegions` via `EPDFText_RedactInQuads`), wasm bundled
      locally, ~4.6 MB loaded on demand only
- [x] Wire rasterization into "Export pages as PNG" (`renderPage`)
- [x] Wire `redactRegions` behind a **Redact tool** — draw black boxes with the
      Redact tool, then **Apply redactions** destructively strips the covered
      text/content (also enforced on save, so nothing leaks under an un-applied
      box). Image objects and fully covered vector paths are removed through the
      verified object-removal pass described below.
- [x] Primary viewer migration off pdf.js: rendering, text layer, search,
      annotations and forms all run on PDFium (`engine.ts` exposes the
      compatibility API); pdf.js is not part of normal viewing/editing
- [x] Redaction: remove the underlying image object for image-only regions —
      shipped (`removeObjectsInRects` drops overlapping images and fully
      covered vector paths, with post-apply verification that re-opens the
      bytes and throws on residual content). Remaining limitations: whole
      image dropped on ANY overlap (no partial/cropped image redaction);
      annotations and document metadata are not touched by redaction
- [ ] Desktop build alternative: pdfium-render (Rust) on the Tauri backend for
      native-speed rasterization without WASM bundle cost

## Security, OCR and signatures

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
- [x] Certificate-based digital signatures (PKI) — shipped (`lib/signatures.ts`,
      node-forge; RSA certs):
      - [x] Sign with a user-supplied certificate (.p12/.pfx): File → Sign with
        certificate… — adbe.pkcs7.detached (ByteRange + PKCS#7 CMS with signed
        attributes, SHA-256), invisible field or an existing empty /Sig field;
        identity preview before signing; warns that re-signing/protection
        invalidates existing signatures
      - [x] Signature FIELDS in the form designer (unsigned /Sig widget —
        shipped earlier; the sign dialog can now sign into them)
      - [x] Verify + display existing signatures — sidebar **Signatures** panel:
        valid / modified / invalid / not-verifiable per signature, signer +
        cert details, whether the file gained revisions after signing; honest
        note that identity isn't checked against an OS trust store
      - [ ] Warn before page ops / full-rewrite saves on a signed document
        (the Signatures panel now shows the breakage honestly, and re-signing
        warns first, but other edits still invalidate silently until saved)
      - [ ] Prerequisite for sign-and-keep-valid: incremental (append) saves —
        current saves are full rewrites, which break any existing signature
      - [ ] Tauri desktop: OS certificate store / smartcard access (deferred;
        browser+desktop both use an imported .p12 today). ECDSA certs and
        RFC 3161 timestamps also deferred (RSA only; unsupported algorithms
        report "not verifiable", never a false verdict)
- [x] Search options — case / whole-word / regex / preserve-case shipped
      (`lib/search.ts`), scoped to PDF text + annotations + form values
- [ ] Search/pattern redaction — reuse document search to collect reviewable
      redaction marks for selected terms, regex patterns and page ranges before
      applying destructive removal
- [ ] Reviewed PII suggestions — local detection may propose email, phone,
      account and identity patterns, but the user must review every mark before
      applying; never silently redact from an AI result
- [ ] Sanitize document — inventory and optionally remove metadata, comments,
      attachments, hidden layers, embedded files and other hidden content, then
      produce a clear pre-export report
- [ ] OCR quality review — surface low-confidence words for correction before
      committing the invisible text layer
- [ ] Scan cleanup — deskew, orientation correction, despeckle/contrast cleanup
      and selected-page OCR; keep all preprocessing on-device

## Capability status and remaining gaps

Shipped capabilities and the remaining depth users coming from Acrobat, Foxit,
Nitro or PDF-XChange expect. Roughly ordered by effort-to-value within each
group.

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
- [x] General annotation alignment / snapping / distribute — shared geometry
      lives in `lib/snap.ts`; regular annotations and form fields use alignment
      guides, and multi-selection exposes align/distribute controls
- [x] Polygon / polyline / cloud shapes — vertex-based creation with closed,
      open and scalloped-cloud rendering
- [x] Measure / dimension tools — calibrated distance, perimeter and area
      measurements with live readouts and persisted scale/unit

### Annotation interop / round-trip

- [x] Re-import supported native annotations on reopen — highlight, underline,
      strikeout, squiggly, ink, square, circle, line/arrow, sticky note and
      plain FreeText annotations round-trip into the editable overlay model
      (`lib/annotimport.ts`, guarded by `lib/annotroundtrip.test.ts`)
- [x] Import supported Acrobat/Foxit-authored standard markups into the editable
      overlay model; signed documents remain untouched so import cannot break
      their byte ranges
- [ ] Expand annotation import to unsupported native types: stamps, polygons,
      file-attachment annotations and richer FreeText appearance/style data
- [ ] XFDF import/export (and comments-summary export) for review workflows
- [ ] Reconcile authored links vs the read-only `LinkLayer` (existing
      document links and our `LinkAnnotation`s live in separate worlds)

### Content editing (biggest gap vs Acrobat / Foxit / PDF-XChange)

The pro desktop editors all offer true content editing. PickPDF now edits
line/paragraph scopes with real font data and can replace existing images. The
remaining gap is predictable fidelity across mixed-style, unusual-font and
complex-layout PDFs.

- [x] Paragraph-level text editing with reflow — column-aware paragraph
      collection, soft wrapping, width resize, line creation/removal, glyph
      coverage checks and overlap/page-boundary warnings. Mixed face/size
      paragraphs deliberately block structural reflow rather than lose styling
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
- [x] Image object editing — move, resize, delete and replace existing page
      image objects in place (`replaceImageObject` via PDFium JPEG/PNG setters)
- [ ] Content-editing compatibility matrix — add fixtures and golden checks for
      mixed-style paragraphs, Type1/CFF/CID subsets, vertical/RTL text,
      transparency groups, rotated/skewed objects and clipped content

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

### Create PDF from anything (import side — top acquisition funnel)

- [x] Standalone image→PDF screen — ordered PNG/JPEG file collection with page
      creation, previews and tool-aware drag/drop
- [x] Basic DOCX/text→PDF import — standalone Word or text screen with local
      conversion; appropriate for ordinary flowing documents
- [ ] High-fidelity DOCX→PDF import — preserve complex pagination, tables,
      floating images, headers/footers, sections and Office layout semantics;
      likely requires a native converter for desktop rather than promising
      browser-perfect Office rendering
- [ ] HTML→PDF (print-to-PDF pipeline could bootstrap this)

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

### Enterprise / market unlocks

- [x] Multi-language OCR — searchable language picker with 30+ curated
      Tesseract languages, per-language cached model download and on-device
      recognition (`lib/ocrLanguages.ts`)
- [x] Layers (OCG / optional content) panel — list nested optional-content
      groups and toggle individual/all layer visibility (`lib/ocg.ts`)
- [ ] Incremental (append) saves — all saves are full rewrites today
      (pdf-lib `save()` / PDFium `saveAsCopy`); required before digital
      signatures can survive an edit, and enables faster saves on large docs
- [ ] Linearization ("fast web view") + structural optimization (object
      streams, dedup) — Compress only re-encodes images today

### Native desktop perks (monetization-critical — Pro is SOLD on these)

The Pro one-time-purchase pitch differentiates on native perks, not feature
locks (see docs in pickpdf-web). The Tauri backend currently covers native
menus, system-font matching, veraPDF validation, updates, filesystem/SQL and
process integration, but not document-processing automation. These remain the
monetization-critical native workflows:

- [ ] Batch processing — run merge/compress/OCR/watermark/convert over a
      folder or file list; nothing today operates on more than the open doc
- [ ] File associations + "Open with PickPDF" (double-click a .pdf)
- [ ] Large-file handling — persist/recovery currently skips files >80MB
      (`lib/persist.ts`); native path should lift the browser limits
- [ ] True disk save everywhere (no File System Access API caveats), CLI
      entry point (nice-to-have, enables scripted batch)
- [ ] pdfium-render (Rust) rasterization on the backend for native-speed
      rendering (already listed under PDFium engine above — same workstream)

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

### Toolbar / UX organization

- [x] Replace the flat 19-tool strip with a calm default toolbar and a grouped,
      searchable **Editor tools** sidebar covering Basic, Text, Markup, Shapes,
      Measure and Cleanup tools (`components/viewer/EditorToolsPanel.tsx`)
- [x] Add the left activity rail for recent files, pages, outline, comments,
      attachments/signatures, layers/objects, forms, editor tools and document
      tools; panels can collapse without removing the rail
- [x] Add a command palette (⌘/Ctrl+K) as the searchable fast lane for editor,
      document, navigation, AI and settings actions
- [x] Add contextual controls near selected objects, including inline lock,
      resize/rotate affordances and multi-selection align/distribute
- [ ] First-run focus pass — decide whether the AI panel should open by default,
      verify the editor remains comfortable at common laptop widths, and test
      keyboard-only discovery of the activity rail/tool panels
- [ ] Mobile/compact refinement — keep the complete workbench usable without
      crowding when panels become drawers or documents use split view

### Housekeeping

- [ ] Internationalization (i18n) — English-only today
- [x] Session autosave / crash recovery for documents up to 80 MB, with an
      explicit warning when a document is too large to persist
- [ ] Durable backups and user-visible file version history; lift the 80 MB
      recovery limit through native path-backed persistence
- [x] Automated unit/integration coverage — 74 test files / 467 tests as of
      2026-08-15, including redaction, encryption, signatures, PDFium edits,
      annotation round-trip, forms, coordinates, persistence and tool flows
- [ ] Real-document test infrastructure — build the tricky-PDF corpus and
      save/reopen compatibility matrix described in priority 1; add extension
      and packaged-desktop end-to-end tests
- [x] PDF/A validation — built-in PDF/A-2b structural preflight plus optional
      full veraPDF validation in the desktop app
- [ ] PDF/A conversion — repair or convert only with explicit, verifiable
      preservation rules; never label a file conforming from structural checks
      alone
- [ ] Accessibility: tagged-PDF support, reading order — enterprise/public-
      sector requirement (Section 508 / EN 301 549); minimum viable: preserve
      existing tags through save (verify we don't strip them today), then a
      reading-order checker
- [ ] Bundle/startup performance — split the ~2.4 MB minified application chunk,
      avoid static imports that defeat lazy loading, and decide whether the
      ~23.6 MB ONNX Runtime WASM belongs in every distribution
- [ ] Maintainability — split high-churn modules (`store.tsx`, `pdftools.ts`,
      `annotations.tsx`, `Sidebar.tsx`, `ToolsScreens.tsx`) behind narrower
      feature boundaries before adding another major workflow family

### Chrome extension — post-MVP

The initial Manifest V3 package, toolbar launch, version-gated Chrome 151 PDF
MIME handler preview, native-viewer fallback, local extension builds, and
package verifier live on the `codex/chrome-extension` branch. Follow-up work
for a store-ready release:

- [ ] Add an extension options screen with an explicit **Use PickPDF for PDFs**
      toggle, plus an in-editor **Open with Chrome viewer** escape hatch
- [ ] Add extension-aware document sources so MIME-stream documents clearly
      say **Save a copy**, while picker-backed documents continue to say
      **Save**; offer a reselect-original flow for local streamed files
- [ ] Request narrowly scoped optional host permissions when users enable
      Hugging Face, Ollama, LM Studio, OpenAI, Gemini, OpenRouter, or a custom
      endpoint; remove the Vite-only localhost proxy fallback in extension mode
- [ ] Build a compact embedded-document layout for PDFs inside iframe/embed/
      object contexts (the MVP deliberately renders the complete workbench)
- [ ] Add a PDF-link context-menu command and extension-specific onboarding
- [x] Bundle the licensed Dongle brand font locally so the website, desktop
      applications, and Chrome extension use the same offline typography
- [ ] Add Playwright/Puppeteer tests that load the unpacked extension in Chrome
      stable and beta and cover remote, local, authenticated, embedded,
      encrypted, malformed, and large PDFs plus native-viewer fallback
- [ ] Profile startup and memory on 50 MB, 250 MB, and 500 MB PDFs; reduce
      duplicate ArrayBuffer copies and decide whether the 22 MB packaged ONNX
      runtime should remain in the first Web Store release
- [ ] Prepare the Chrome Web Store privacy disclosure, permission explanations,
      screenshots, correctly sized icon set, support page, and release checklist
- [x] Add extension version synchronization and verified ZIP publication to the
      shared Windows/macOS/Linux/Chrome release workflow
- [ ] Switch the shared release pipeline to the Chrome 151 MIME-handler build
      after Chrome 151 reaches Stable; until then publish the warning-free
      Chrome Stable toolbar/file-picker build
- [ ] Add Chrome Web Store submission after Chrome 151 reaches stable; keep the
      GitHub/R2 ZIP as the reproducible reviewed package

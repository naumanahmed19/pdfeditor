# TODO

## Priorities — path to "best PDF editor" (gap analysis 2026-07-10)

Feature *breadth* is already competitive; the gaps are depth on flagship
features, trust infrastructure, and the native perks the Pro pricing pitch
depends on. Ranked order of attack:

1. **Digital signatures** — ✅ shipped (sign with .p12/.pfx + verify + sidebar
   Signatures panel; see "Other deferred items"). Remaining depth: warn on
   edits that invalidate a signed doc, incremental saves so signatures survive
   edits, OS cert store / ECDSA / timestamps.
2. **Save-path test harness** — one test file (`pdfium.redact.test.ts`) guards
   an app that rewrites content streams, re-encrypts and destructively
   redacts. Corpus of tricky PDFs + round-trip tests (open → edit → save →
   reopen → assert text/forms/encryption/tags intact) in CI.
3. **Paragraph reflow** for in-place text editing (Content editing below) —
   the #1 "can it really edit PDFs?" perception gap vs Acrobat/Foxit.
4. **Annotation round-trip** (new section below) — reopening a saved file must
   yield editable annotations, ours or Acrobat's; today comments are
   write-only and markups bake one-way.
5. **Batch + native desktop perks in Tauri** (new section below) — the Pro
   tier is sold on these and the Rust backend is currently empty.
6. **PDF/A validation + multi-language OCR** — widest market expansion per
   unit of effort (gov/legal/archival buyers; non-English scans).

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
- [x] Redaction: remove the underlying image object for image-only regions —
      shipped (`removeObjectsInRects` drops overlapping images and fully
      covered vector paths, with post-apply verification that re-opens the
      bytes and throws on residual content). Remaining limitations: whole
      image dropped on ANY overlap (no partial/cropped image redaction);
      annotations and document metadata are not touched by redaction
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
- [ ] General annotation alignment / snapping / distribute — the guides,
      align and distribute tooling already built for the form builder
      (`lib/formbuilder.ts`, `snapGuides` in `store.tsx`) is scoped to form
      fields only; wire the same math up for regular annotations
- [ ] Polygon / polyline / cloud shapes — only rect/ellipse/line/arrow exist
- [ ] Measure / dimension tools (distance, perimeter, area with scale
      calibration) — with polygon/cloud, this is the door into the
      AEC/construction niche (Bluebeam territory)

### Annotation interop / round-trip (new — reopening must not be one-way)

- [ ] Re-import annotations on reopen — comments save as native /Text popups
      but are NOT read back (write-only round-trip); highlights/shapes bake
      one-way. Reopening our own saved file should yield editable
      annotations, not frozen content
- [ ] Import annotations authored elsewhere (Acrobat/Foxit markups) into the
      editable overlay model
- [ ] XFDF import/export (and comments-summary export) for review workflows
- [ ] Reconcile authored links vs the read-only `LinkLayer` (existing
      document links and our `LinkAnnotation`s live in separate worlds)

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
- [ ] Image object editing — remaining piece is **replace in place**: move /
      resize / delete / recolor of existing page images shipped (`editobject`
      tool, `objectlayer.tsx`, `transformObject`/`removeObject`), but
      swapping an image's bitmap still means delete + insert overlay. The
      Compress tool already re-encodes image objects
      (`EPDFImageObj_SetJpeg/SetPng`), so the plumbing exists. Also unblocks
      the redaction image-removal item above.

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

- [ ] Standalone image→PDF screen — nearly free: `imagesToPdfPages` already
      exists but is only reachable through Merge
- [ ] DOCX→PDF import — the valuable hard one (client-side layout engine, or
      native converter on the Tauri side as a Pro perk)
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

- [ ] Multi-language OCR — Tesseract worker is hardcoded to `eng`
      (`lib/ocr.ts`); a language picker is cheap and instantly widens the
      market, and pairs with the translation AI story
- [ ] Layers (OCG / optional content) panel — show/toggle layers; expected by
      CAD/print/engineering users, PDFium supports it
- [ ] Incremental (append) saves — all saves are full rewrites today
      (pdf-lib `save()` / PDFium `saveAsCopy`); required before digital
      signatures can survive an edit, and enables faster saves on large docs
- [ ] Linearization ("fast web view") + structural optimization (object
      streams, dedup) — Compress only re-encodes images today

### Native desktop perks (monetization-critical — Pro is SOLD on these)

The Pro one-time-purchase pitch differentiates on native perks, not feature
locks (see docs in pickpdf-web) — but the Tauri Rust backend is essentially
empty (`src-tauri/src/lib.rs` only sets up logging). These must exist before
launch:

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

### Toolbar / UX organization (come back to this)

The editor toolbar's first row shows ~19 annotation tools in one flat,
horizontally-scrolling strip plus Insert image / Form / Stamp / Sign controls —
overwhelming at a glance. The tools already carry a `group` number (0–4) in the
`TOOLS` array (`components/viewer/Toolbar.tsx`) that today only draws divider
lines. Explored ways to reduce the clutter (Photoshop-style):

- [ ] Flyout grouping — collapse each `group` into ONE toolbar slot showing the
      group's last-used tool + a caret; click opens a small menu with the rest
      (Select / Text / Markup / Shapes / Erase & redact), plus fold image /
      form / stamp / signature into a single **Insert** flyout. 19 icons → ~6
      slots. Prototyped and reverted (worked: type-checked, flyouts open via the
      existing `Menu` primitive — remember `MenuLabel` must be wrapped in
      `MenuGroup` or Base UI throws). Reverted pending the broader direction
      below.
- [ ] Mode tabs (ribbon-lite) — top-level tabs (View / Annotate / Draw / Insert /
      Review) that swap the whole toolset by task; would also pull the buried
      Tools menu (merge/split/watermark/…) into a Pages/Document tab. Biggest
      single declutter; the flyout grouping nests under each tab. **Recommended
      next** — needs a decision on the exact tab set before building.
- [ ] Contextual floating bar — a small toolbar next to the current selection
      with just that object's actions (selection state already exists via
      `selectedAnn`); keeps the top bar calm. Good complement, not a replacement.
- [ ] Command palette (⌘K) — searchable fast-lane for every tool/action; makes
      all tools discoverable by name. Additive, lower priority.
- [ ] (Skip for now) Left vertical tool rail — the literal Photoshop layout, but
      it competes with the existing left sidebar for the same edge.

### Housekeeping

- [ ] Internationalization (i18n) — English-only today
- [ ] Autosave / backup / file versioning
- [ ] Test infrastructure — **elevated to priority #2** (see Priorities at
      top): only `pdfium.redact.test.ts` exists; need a tricky-PDF corpus +
      save-path round-trip tests in CI
- [ ] PDF/A conversion or validation — matters for government/legal/archival
      buyers; start with validation (report violations: unembedded fonts,
      encryption, transparency) before attempting conversion
- [ ] Accessibility: tagged-PDF support, reading order — enterprise/public-
      sector requirement (Section 508 / EN 301 549); minimum viable: preserve
      existing tags through save (verify we don't strip them today), then a
      reading-order checker

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

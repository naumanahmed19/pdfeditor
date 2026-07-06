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

- [ ] Short term: lazy-loaded PDFium rasterization for "Export pages as PNG"
      and as a render-fallback for documents pdf.js draws incorrectly
      (~5 MB WASM, load only on demand)
- [ ] Long term: benchmark their engine + plugins (selection, search,
      annotations, forms) against our pdf.js stack as a potential migration —
      only worth it if fidelity/perf wins are clear, since edit-text font
      detection, form designer/filler and search marks are wired to pdf.js APIs
- [ ] Desktop build alternative: pdfium-render (Rust) on the Tauri backend for
      native-speed rasterization without WASM bundle cost

## Other deferred items

- [x] OCR for scanned PDFs (tesseract.js) — adds an invisible searchable text
      layer so search/select/edit/AI work on scans (Tools → Make searchable)
- [x] True redaction (Redact tool) — pages holding a redaction are rasterized on
      save and rebuilt into a fresh document, so the original text/fonts/images
      under the bars are physically dropped, not just hidden (pdf-lib can't strip
      a content stream, and a rebuild guarantees no orphaned objects survive).
      Trade-off: a redacted page loses its selectable text layer and any
      interactivity. A future PDFium path could redact in place, per page above.
- [ ] Sticky notes / comments with popups
- [ ] Search across text-run boundaries, case/whole-word options
- [ ] Two-page spread view

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
- [ ] True redaction via PDFium (their redaction plugin proves it works
      client-side — destructive content removal pdf-lib can't do); replaces
      the "true redaction" item below
- [ ] Long term: benchmark their engine + plugins (selection, search,
      annotations, forms) against our pdf.js stack as a potential migration —
      only worth it if fidelity/perf wins are clear, since edit-text font
      detection, form designer/filler and search marks are wired to pdf.js APIs
- [ ] Desktop build alternative: pdfium-render (Rust) on the Tauri backend for
      native-speed rasterization without WASM bundle cost

## Other deferred items

- [ ] OCR for scanned PDFs (tesseract.js) — enables search/edit/AI on scans
- [ ] True redaction (strip text from content stream, not whiteout) — see
      PDFium evaluation above for the likely implementation path
- [ ] Sticky notes / comments with popups
- [ ] Search across text-run boundaries, case/whole-word options
- [ ] Two-page spread view

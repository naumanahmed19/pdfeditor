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

## Other deferred items

- [ ] OCR for scanned PDFs (tesseract.js) — enables search/edit/AI on scans
- [ ] True redaction (strip text from content stream, not whiteout)
- [ ] Sticky notes / comments with popups
- [ ] Search across text-run boundaries, case/whole-word options
- [ ] Two-page spread view

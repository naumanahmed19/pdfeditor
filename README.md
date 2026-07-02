# PDF Workbench

A professional PDF reader & editor with local-AI assistance, styled after the
Outreach Workbench shell (same theme, layout and component patterns).

![stack](https://img.shields.io/badge/stack-React%2018%20%2B%20Vite%20%2B%20Tailwind-blue)

## Features

**Reader**
- Open PDFs via drag & drop or file picker; multi-document tabs with
  session restore and a recent-files list (IndexedDB)
- Password-protected PDFs, clickable links (URLs + internal destinations)
- Continuous scrolling viewer with lazy page rendering (pdf.js)
- Selectable text layer, full-document search with highlights & prev/next
- Page thumbnails, outline navigation, document properties (editable metadata)
- Zoom, fit-width/fit-page, fullscreen, page jump, print, dark/light theme
- Keyboard shortcuts: Ctrl+O/F/S/P, +/−, PageUp/PageDown, Home/End
- **Form filling**: AcroForm text fields, checkboxes, radios and dropdowns,
  saved into the PDF

**Editor** (annotations are baked into the PDF on save)
- Edit existing text: click any line with the edit-text tool — it's covered
  with a whiteout and reopened as an editable text box in place, with the
  original font family, size, bold and italic auto-detected
- Bundled metric-compatible fonts (SIL OFL): Carlito (Calibri) and Caladea
  (Cambria) are auto-selected when the original document uses those Office
  fonts, shown on screen and fully embedded into the saved PDF; a warning
  toast appears when a font has no close substitute
- Text boxes, highlights, freehand ink, rectangles, ellipses, lines
- Whiteout (cover & retype), image stamps
- Signatures: draw, type (script fonts) or upload — saved for reuse
- Move/resize/delete annotations, undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- Correct baking on rotated pages

**Tools**
- Merge PDFs and PNG/JPG images (each image becomes a page)
- Split into single pages (zip), extract ranges ("1-3, 5"), export pages
  as high-res PNGs (zip)
- Organize: drag-and-drop reorder, rotate, duplicate, delete, insert blank
  pages or pages from another PDF
- Watermark (text, opacity, color, diagonal) and page numbering

**Desktop app (Tauri)**
- `bun tauri build` produces a Windows installer (NSIS `.exe` + `.msi`)
  in `src-tauri/target/release/bundle/` — requires the Rust toolchain
- Save-in-place: files opened via the picker (Chromium / desktop app) are
  saved back to the original file; otherwise an edited copy downloads

**AI assistant** (right-side panel)
- Chat about the open document (text is extracted and sent as context)
- Quick actions: summarize, key points, explain page
- Select text in the PDF → rewrite / fix grammar / translate / explain
- Insert any AI answer into the page as a text box
- Providers: **Ollama** (default, model `gemma3`), **LM Studio**, or any
  OpenAI-compatible endpoint — with model discovery, connection status and
  streaming responses. Configure under **Settings**.

## Run

```bash
bun install
bun run dev        # http://127.0.0.1:5173
bun run build      # production build in dist/
```

For AI features run one of:
- [Ollama](https://ollama.com): `ollama pull gemma3` (works out of the box)
- LM Studio: enable the local server (Developer tab); enable CORS if needed —
  the dev server also proxies `/proxy/ollama` and `/proxy/lmstudio` as a
  CORS fallback.

## Notes

- Documents never leave the browser except as context sent to the AI endpoint
  you configure.
- Structural operations (rotate/delete/reorder/watermark) bake any pending
  annotations into the document first, then apply.
- Text annotations are embedded with Helvetica (WinAnsi); unsupported glyphs
  are replaced with `?`.

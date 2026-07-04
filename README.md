# PickPDF

A professional, local-first PDF **reader, editor, form designer and organizer**
with a built-in **local-AI assistant** — runs in the browser and ships as a
Windows desktop app. Styled after the Outreach Workbench shell (same theme,
layout and component patterns).

![stack](https://img.shields.io/badge/stack-React%2018%20%2B%20Vite%20%2B%20Tailwind-blue)
![engine](https://img.shields.io/badge/pdf-pdf.js%20%2B%20pdf--lib-orange)
![desktop](https://img.shields.io/badge/desktop-Tauri%202-brightgreen)

Everything runs client-side. Documents never leave your machine except as
context sent to the AI endpoint you configure (which can be fully local).

---

## Reader

- **Open** PDFs by drag & drop, file picker, folder browser, or a recent-files
  list — plus password-protected PDFs (prompts for the password).
- **Continuous scrolling** viewer with lazy per-page rendering (pdf.js),
  fit-width / fit-page / manual zoom, fullscreen, and a floating page/zoom pill.
- **Selectable text layer** and **full-document search** that highlights the
  matched word (not the whole line) with prev/next and a match counter.
- **Clickable links** — external URLs open in a new tab; internal links jump to
  the target page.
- **Navigation**: page thumbnails, document outline/bookmarks, page jump.
- **Document properties** dialog (file info, page size) with editable
  Title/Author metadata.
- **Print** and **dark / light theme**.
- **Keyboard shortcuts**: `Ctrl/⌘+O` open, `+F` search, `+S` save, `+P` print,
  `+`/`−` zoom, `PageUp`/`PageDown`, `Home`/`End`, arrow keys nudge a selected
  annotation, `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo.

## Editor

Annotations are overlaid live and **baked into the PDF on save** (correct on
rotated pages). Toggle **Edit** mode; contextual controls appear per tool.

- **Add text** boxes that **auto-grow** to fit what you type (width then wrap).
- **Edit existing text** truly in place (PDFium): click a line and edit it
  inline — the original content-stream text object is **rewritten in its own
  font, size, color and position**. No whiteout patch and no overlay copy; the
  old text is genuinely replaced, so nothing is left behind to extract. If a
  line uses a subset-embedded font that can't take new glyphs, it says so —
  overlay a correction with the Text tool there instead.
- **Move, resize, recolor & delete existing objects** (PDFium): with the
  **Select** tool in edit mode, click any existing **text run, image or vector
  shape** (rectangles, fills, lines) to select it — **drag to move**, drag a
  corner to **resize** images/shapes, **recolor** its fill/stroke (or text ink)
  from the color chip, or press **Delete** to remove it. Real content-stream
  edits with a live drag preview, on the same undo timeline.
- **Highlight** (drag a box, or select text and highlight it), **freehand ink**,
  **rectangle / ellipse / line**, **whiteout**, and **image stamps**.
- **Signatures**: draw, type (script fonts), or upload an image — saved for
  reuse and placed anywhere.
- **Fonts**: the 14 standard PDF fonts plus bundled metric-compatible
  **Carlito (Calibri)** and **Caladea (Cambria)** (SIL OFL) — auto-selected for
  Office documents and fully embedded on save; a warning appears when a font has
  no close substitute.
- Move / resize / delete / **nudge** annotations, aspect-locked image resize,
  full **undo/redo** history per document.

## Forms

- **Fill** existing AcroForm fields — text, checkbox, radio, dropdown — with
  values saved into the PDF. On save, field **appearance streams are regenerated
  with PDFium** so entered values render correctly in every viewer (not just ones
  that honor `/NeedAppearances`).
- **Design** forms: a Field menu places **text fields, checkboxes, radio groups
  and dropdowns** as draggable placeholders; set name, options and radio values
  in the toolbar. On save they become real AcroForm fields (tall text fields
  become multiline).
- **Edit existing fields**: move, resize, rename or delete a document's fields;
  changes are written back to the form on save.
- **Templates** — **File → New from template** opens ready-made **fillable forms**
  (invoice, job application, feedback survey, NDA with signature lines, weekly
  timesheet) with real form fields, plus blank **document starters** (business
  letter, meeting notes, résumé).

## Tools

- **Merge** PDFs — and PNG/JPG **images** (each image becomes a page).
- **Split & extract**: split into single pages (zip), extract a range
  (`1-3, 5, 8-10`), or export every page as a **high-res PNG** (zip).
- **Organize pages**: drag-and-drop reorder, rotate, duplicate, delete, insert
  blank pages, or **insert pages from another PDF**.
- **Watermark** (text, opacity, color, diagonal) and **page numbering**.
- **OCR (Make searchable)** — recognize text on scanned/image PDFs (Tesseract.js,
  runs locally) and add an invisible text layer so **search, selection, copy,
  edit-text and the AI assistant** work on scans. Offered automatically when a
  text-less PDF is opened, or via Tools → Make searchable.

## Workspace

- **Multi-document tabs** — open many PDFs at once; switch, close, and reopen
  from the sidebar.
- **Split view** — VS Code-style **up to 4 panes** side by side; split the same
  document or open different ones. The focused pane is fully editable; each pane
  has its own menu (edit, print, split, close). Panes stack vertically on mobile.
- **Sidebar workspace** (left): an **Open** list of current documents (active one
  highlighted, close on hover, "open side-by-side" per document), a
  **folder browser** (see below), and **Recently closed** for quick reopening —
  plus per-document **Pages** (thumbnails) and **Outline** tabs.
- **Folder browser** — open a whole folder and browse its PDFs as a collapsible
  tree, including **nested subfolders**; open files are highlighted in place.
  Uses the File System Access API (with save-in-place) where available, and falls
  back to `webkitdirectory` elsewhere.
- **Session restore & recents** — open tabs and recent files persist across
  reloads (IndexedDB); an unsaved-edits guard warns before closing.
- **Save**: writes **in place** to the original file when opened via the picker
  or a folder handle (Chromium / desktop app); otherwise downloads an edited
  copy. "Download a copy" is always available.
- Responsive layout (sidebars become drawers on mobile) and an error-recovery
  screen.

## AI assistant

A right-side, collapsible panel backed by a **local** model by default — with a
zero-setup option that needs no server at all.

- **Chat** about the open document (its text is extracted and sent as context).
- **Quick actions**: summarize, key points, explain page.
- **Selection actions**: select text in the PDF → rewrite / fix grammar /
  translate / explain.
- **Insert** any AI answer into the page as a text box.
- Streaming responses, persisted chat history, connection status, and an
  in-panel **model switcher**.
- **Providers**:
  - **Built-in (Gemma 4, in-browser)** — the **default**; runs Google's
    **Gemma 4 (E2B)** entirely in the browser via Transformers.js/WebGPU. No
    Ollama, LM Studio, API key or setup — the model downloads once (~2 GB, then
    cached) and works offline. Needs WebGPU (Chrome/Edge or the desktop app).
  - **Ollama** (model `gemma3`), **LM Studio**, or any OpenAI-compatible
    endpoint — for users who already run a local/remote model server.
  - Switch and configure under **Settings**.

---

## Run (web)

```bash
bun install
bun run dev        # http://127.0.0.1:5173
bun run build      # production build in dist/
```

For AI features, run a local model server:

- [Ollama](https://ollama.com): `ollama pull gemma3` (works out of the box).
- LM Studio: enable the local server (Developer tab); enable CORS if needed —
  the dev server also proxies `/proxy/ollama` and `/proxy/lmstudio` as a CORS
  fallback.

## Build the desktop app (Tauri)

Produces a Windows installer (NSIS `.exe` + `.msi`) in
`src-tauri/target/release/bundle/`. Requires the Rust toolchain and MSVC build
tools.

```bash
bun run tauri build
```

The desktop app runs on WebView2 (Chromium), so folder browsing and
save-in-place work there too.

## Tech

- **React 18 + Vite + TypeScript + Tailwind**, base-ui (shadcn-style) primitives.
- **pdf.js** for rendering/text/search; **pdf-lib** (+ fontkit) for editing,
  merging, splitting, forms and saving; **JSZip** for zip exports.
- State in a single React context store; persistence via IndexedDB and
  localStorage. No backend.

## Notes & limitations

- Structural operations (rotate/delete/reorder/watermark) bake any pending
  annotations into the document first, then apply.
- **Whiteout hides, it doesn't redact** — the covered text still exists in the
  saved PDF. Don't use it to remove confidential content (true redaction is on
  the roadmap — see [TODO.md](TODO.md)).
- The reference (non-focused) split pane is read-only and shows the saved
  document; edit by focusing that pane.
- In-place text editing reuses a run's own embedded font. If that font is a
  subset (only the glyphs the document already used), characters outside the
  subset can't be typed — the editor says so; overlay a correction with the
  Text tool instead.

- OCR fetches its language model once from a CDN (cached); the recognition
  itself runs locally, so your document is never uploaded.

See [TODO.md](TODO.md) for the roadmap (a full form-builder UX, true redaction,
and a PDFium evaluation).

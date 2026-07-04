# PickPDF

A professional, local-first PDF **reader, editor, form designer and organizer**
with a built-in **local-AI assistant** — runs in the browser and ships as a
Windows desktop app with a clean, shadcn-style UI.

![stack](https://img.shields.io/badge/stack-React%2018%20%2B%20Vite%20%2B%20Tailwind-blue)
![engine](https://img.shields.io/badge/pdf-pdf.js%20%2B%20PDFium%20%2B%20pdf--lib-orange)
![desktop](https://img.shields.io/badge/desktop-Tauri%202-brightgreen)

Everything runs client-side. Documents never leave your machine except as
context sent to the AI endpoint you configure (which can be fully local).

---

## Reader

- **Open** PDFs by drag & drop, file picker, folder browser, or a recent-files
  list — plus password-protected PDFs (prompts for the password).
- **Continuous scrolling** viewer with lazy per-page rendering (pdf.js) and a
  floating pill with page navigation, a **zoom menu** (fit width / fit page /
  100% / fullscreen), and **AI quick actions for the current page**.
- **Selectable text layer** and **full-document search** that highlights the
  matched word (not the whole line) with prev/next and a match counter.
- **Clickable links** — external URLs open in a new tab; internal links jump to
  the target page.
- **Navigation**: page thumbnails, document outline/bookmarks, page jump.
- **Document properties** dialog (file info, page size) with editable
  Title/Author metadata.
- **Print**, **dark / light theme**, and selectable **accent colors**
  (shadcn-style presets that tint the whole app, Settings → Appearance).
- **Keyboard shortcuts**: `Ctrl/⌘+O` open, `+F` search, `+S` save, `+P` print,
  `+`/`−` zoom, `PageUp`/`PageDown`, `Home`/`End`, arrow keys nudge a selected
  annotation, `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo.

## Editor

Annotations are overlaid live and **baked into the PDF on save** (correct on
rotated pages). Editing is **modeless** — the toolbar is always there, like a
browser: the default **Read** cursor selects text and follows links; arming
any tool switches what a click does, and **Escape** returns to reading.
**Save** commits (and disarms); **Discard** (with confirmation) throws pending
edits away.

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
- **Comments (sticky notes)** — drop a marker anywhere on a page and write a
  note in its popup; recolor or delete from the same popup. On save they become
  **real PDF popup annotations** (Acrobat, Chrome & co. show them as native
  comments), and a sidebar **Comments** tab lists them all with click-to-jump.
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
  plus per-document **Pages** (thumbnails), **Outline** and **Comments** tabs.
  The sidebar collapses on desktop too, for a distraction-free reading view.
- **Folder browser** — open a whole folder and browse its PDFs as a collapsible
  tree, including **nested subfolders**; open files are highlighted in place.
  Uses the File System Access API (with save-in-place) where available, and falls
  back to `webkitdirectory` elsewhere.
- **Session restore & recents** — open tabs and recent files persist across
  reloads (IndexedDB); an unsaved-edits guard warns before closing.
- **Save**: writes **in place** to the original file when opened via the picker
  or a folder handle (Chromium / desktop app); otherwise downloads an edited
  copy. "Download a copy" is always available.
- **Rename** a document by double-clicking its title — updates the tab, recents
  and download filenames (the file on disk keeps its name; browsers can't
  rename through a file handle).
- Responsive layout (sidebars become drawers on mobile) and an error-recovery
  screen.

## AI assistant

A right-side, collapsible panel backed by a **local** model by default — with a
zero-setup option that needs no server at all.

- **Chat** about the open document (its text is extracted and sent as context).
- **Quick actions**: summarize, key points, explain page — also available from
  the viewer's floating pill, scoped to the page you're reading.
- **Selection actions**: select text in the PDF and a floating assistant button
  appears → rewrite / fix grammar / translate / explain, with the **page the
  selection came from** sent as context.
- **Small-model friendly**: questions that mention a page ("summarize page 3")
  send **only that page**, selection actions skip the full document, and chat
  history is capped — so tight context windows (4k) work; overflow errors come
  back as readable messages with concrete fixes, not raw JSON.
- **Insert** any AI answer into the page as a text box.
- Streaming responses with a typing indicator, persisted chat history,
  connection status, and a **model switcher in the composer**.
- **Providers**:
  - **Built-in (Gemma 4, in-browser)** — the **default**; runs Google's
    **Gemma 4 (E2B)** entirely in the browser via Transformers.js/WebGPU (CPU
    fallback). No Ollama, LM Studio, API key or setup — the model downloads
    once (~2 GB, then cached, with live byte-level progress and stall
    detection) and works offline. Needs WebGPU (Chrome/Edge or the desktop app)
    for the fast path.
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

## Desktop app (Tauri)

The desktop app is a **frameless window** with custom minimize/maximize/close
controls in the app's own title bar. It runs on WebView2 (Chromium), so folder
browsing, save-in-place and WebGPU work there too. Requires the Rust toolchain
and MSVC build tools.

```bash
bun run tauri dev      # run in development (hot reload)
bun run tauri build    # Windows installer (NSIS .exe + .msi) in src-tauri/target/release/bundle/
```

## Tech

- **React 18 + Vite + TypeScript + Tailwind**, base-ui (shadcn-style) primitives.
- **PDFium (WASM)** is the PDF runtime: rendering, the selectable text layer,
  search text, outline, links, form-field reading, metadata — and all in-place
  editing (text rewrite, object move/resize/delete, redaction, form appearance
  regeneration). **pdf-lib** (+ fontkit) assembles documents (merge, split,
  forms, baking annotations on save). **JSZip** for zip exports. (pdf.js has
  been fully removed.)
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

- **Comments are one-way for now**: saving writes them into the PDF as native
  popup annotations (visible in Acrobat/Chrome), but PickPDF doesn't yet
  re-import embedded comments when a file is opened — so they won't reappear in
  PickPDF's own viewer after a save-and-reopen. Round-trip import is planned.
- OCR fetches its language model once from a CDN (cached); the recognition
  itself runs locally, so your document is never uploaded.

See [TODO.md](TODO.md) for the roadmap (a full form-builder UX, true redaction,
and comment round-trip import).

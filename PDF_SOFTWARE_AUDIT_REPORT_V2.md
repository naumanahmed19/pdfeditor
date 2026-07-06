# PDF Workbench Second-Pass Audit

Date: 2026-07-06
Scope: current workspace at `C:\Users\nauma\Desktop\sites\pdfeditor`

## Executive Verdict

This current version is a solid local-first PDF workbench foundation, but it is not yet competitive with mature PDF editors on trust-critical features. It can credibly compete with lightweight web PDF editors for private local viewing, annotation, signing, OCR, merge/split/page organization, and AI-over-document workflows. It is not yet ready to claim parity with Acrobat, Foxit, PDF-XChange, Nitro, PDFgear, or UPDF.

The biggest issue is expectation mismatch. The app and README describe a modest but useful pdf.js/pdf-lib editor. The untracked `landing/` page markets PickPDF with real redaction, compression, crop, comments, secure sharing, and signature workflows that are not present in the current tracked app.

Overall ratings:

- Product direction: good
- Current feature breadth: medium
- Current feature depth vs pro PDF editors: low/medium
- Privacy positioning: strong, but needs sharper disclosure
- Security/compliance readiness: weak
- Code maintainability: medium risk
- Test/release readiness: weak

## Verification

Passed:

- `bun run build`
- `cargo check` in `src-tauri`
- Live UI smoke: first screen renders, sidebar/dropzone/AI panel visible, no hard blank screen.

Build size:

- Main JS: about 1.35 MB before gzip.
- PDF worker: about 1.38 MB.
- `fontkit` chunk: about 717 KB.
- OCR and JSZip are split into separate chunks.

Live UI note:

- Browser dev logs captured repeated `useApp outside provider` errors during dev/HMR, while the UI recovered and rendered. Treat as a dev-runtime stability smell unless reproduced in production preview.

Working tree:

- New audit artifact: `PDF_SOFTWARE_AUDIT_REPORT_V2.md`.
- `landing/` and `.landing-vite*.log` are ignored by `.gitignore`, but were included in this audit because they live in the workspace and affect product/marketing claims.

## Current Implemented Shape

Core stack:

- React 18, Vite, TypeScript, Tailwind.
- Tauri 2 desktop shell.
- `pdfjs-dist` for rendering/text/search.
- `pdf-lib` for save-time annotation baking, page operations, forms, OCR text layer, metadata.
- Tesseract.js for OCR.
- Ollama/LM Studio/custom OpenAI-compatible AI provider.

Tracked app screens:

- Viewer/editor.
- Organize pages.
- Merge PDFs/images.
- Split/extract/export pages as PNG.
- Watermark/page numbers.
- Settings.

Tracked editor tools:

- Text overlay.
- Pseudo edit existing text by whiteout patch plus new text box.
- Highlight.
- Ink.
- Rectangle, ellipse, line.
- Whiteout.
- Image stamp.
- Visual signature.
- Basic form field creation: text, checkbox, radio, dropdown.

Not present in current tracked app:

- True redaction.
- Certificate digital signatures.
- Real content-stream text editing.
- Existing image/object editing.
- Comments/sticky notes.
- Stamps beyond image/signature placement.
- Underline/strikeout/squiggly markup.
- Crop, compress, compare, export-to-text/HTML/DOCX screens.
- Protect/encrypt document UI.
- PDF/A validation/conversion.
- Accessibility/tagged PDF tooling.
- Batch operations.
- In-browser built-in AI model.
- Secure sharing/signature workflow backend.

## What Is Strong

### 1. Local-first architecture

The app does meaningful PDF work client-side and has a Tauri desktop path. This remains the best differentiator versus online tools that require uploads.

### 2. Good core PDF utility coverage

For a lightweight private PDF workbench, the tracked app covers useful everyday jobs:

- Open/search/view/print.
- Annotate.
- Fill and create simple forms.
- Sign visually.
- Merge/split/extract.
- Reorder/rotate/delete/duplicate pages.
- Watermark/page numbering.
- OCR scanned PDFs into searchable PDFs.
- Ask AI about PDF text through configured local/custom endpoints.

This is enough to be valuable for students, admins, and privacy-conscious users who need basic PDF workflows.

### 3. Clear desktop-style shell

The first screen is calm and direct: File/Tools menus, sidebar recents/folder browser, central dropzone, and AI panel. It feels more app-like than many browser PDF toys.

### 4. Forms are a promising lane

Even the minimal form designer is useful. PDF-XChange, Nitro, Acrobat, and Foxit all treat form workflows as serious product territory, so this can become a differentiator if expanded.

### 5. OCR is local after language data fetch

OCR using Tesseract.js is a good privacy-oriented feature, especially for scanned paperwork. The limitation is speed, language configuration, and scan detection polish.

## Top Release Blockers

### P0: Landing page overclaims current capabilities

`landing/index.html` is untracked but currently markets:

- "Real redaction"
- crop/compress/export
- comments/stamps
- secure sharing
- signature workflows
- security tools

The tracked app does not implement most of these. This is the biggest product risk because users will judge the app against the marketing promise.

Fix:

- Either align the app to the landing page, or rewrite the landing page to say "planned" for redaction, sharing, signing workflows, compression, crop, and comments.
- Use one product name consistently. Current app says `PDF Workbench`; landing says `PickPDF`.

### P0: True redaction is absent

Whiteout is explicitly not redaction. Competitors and users treat redaction as destructive removal of sensitive text/graphics, often with search redaction and verification.

Current state:

- Whiteout visually covers content.
- README correctly warns whiteout is not redaction.
- Landing page incorrectly claims real redaction.

Fix:

- Do not market redaction until implemented.
- Implement with PDFium or a specialized redaction path that removes text, image content, annotations, metadata, and allows verification.

### P0: Password handling uses `window.prompt`

`src/lib/pdf.ts` prompts for PDF passwords with `window.prompt`. This is a poor UX/security surface for a desktop PDF app and can expose password text awkwardly depending on platform.

Fix:

- Add a masked in-app password modal.
- Preserve password only as needed for the current document session.
- Distinguish open password vs owner/permissions password if protection is added later.

### P0: PDF operations ignore encryption

`src/lib/pdftools.ts` loads PDFs with `PDFDocument.load(bytes, { ignoreEncryption: true })`.

Risk:

- Structural/save operations can strip or bypass encryption/permissions.
- A protected PDF may be saved back unprotected.
- This undercuts privacy/security claims.

Fix:

- Detect encrypted/protected documents.
- Prevent edits unless permissions allow them.
- Re-encrypt or explicitly warn before saving decrypted output.

### P0: No test infrastructure

There are no scripts for unit, integration, visual, or e2e tests. For a PDF editor, this is serious because regressions show up as corrupted files, broken form fields, bad coordinates, lost pages, or leaked redactions.

Fix:

- Add Playwright smoke tests using the existing `window.__pdfwb` hook.
- Expand the dev hook to expose `openBytes`, `saveCurrent`, current screen/doc state, and last toast/error.
- Add PDF fixture tests around save/reopen.

### P0: Tauri CSP is disabled

`src-tauri/tauri.conf.json` has `"csp": null`.

Risk:

- This is a desktop app that opens untrusted PDFs and renders user-controlled document text.
- It also stores local settings/API keys and chat history.

Fix:

- Add a restrictive CSP.
- Review every place that injects/render document-derived content.

## Important Product Gaps Versus Competitors

### Acrobat

Adobe Acrobat Pro/Studio includes edit/convert/protect/organize/sign, e-sign tracking, web forms, redact, compare, OCR editable scans, AI Assistant/PDF Spaces, and desktop/web/mobile coverage.

PickPDF/PDF Workbench advantage:

- Local-first simplicity.
- No default cloud upload for core editing.
- Potential privacy-first AI via local endpoints.

Gaps:

- True redaction.
- E-sign workflows.
- Office conversion.
- Compare.
- Enterprise/admin/ecosystem.
- Mobile/web integrations.

### Foxit PDF Editor

Foxit markets broad AI-powered editing, OCR, redaction, form management, batch processing, collaboration, and business security.

PickPDF/PDF Workbench advantage:

- Leaner, local-first positioning.

Gaps:

- Batch tools.
- Real redaction and AI redaction.
- Mature content editing.
- Collaboration/review.
- Enterprise trust.

### PDF-XChange Editor

PDF-XChange is the closest desktop-power-user benchmark: OCR, form creation/editing, annotations, signatures, compare, and broad utility depth.

PickPDF/PDF Workbench advantage:

- Cleaner, modern shell.
- Local AI assistant path.

Gaps:

- Form builder depth.
- Enhanced OCR controls.
- Digital signatures.
- Compare.
- Dynamic stamps/comments.
- Long-tail PDF utilities.

### Nitro PDF

Nitro emphasizes edit/convert/combine/annotate/OCR/sign/eSign and business workflows.

PickPDF/PDF Workbench advantage:

- Private local editing path and lower complexity.

Gaps:

- Conversion.
- Secure signing/eSign.
- Business/admin/analytics.
- Mature editing.

### PDFgear, UPDF, Sejda, iLovePDF

Even free/low-cost tools commonly advertise editing, annotation, OCR, page management, compression, conversion, signing, and in some cases AI chat.

PickPDF/PDF Workbench advantage:

- Local-first desktop app can beat cloud web tools on privacy.

Gaps:

- Compression/crop/export/conversion breadth.
- Real text/image editing.
- More annotation types.
- Clearer free/paid positioning.

## Code Findings

### 1. Large central files

Largest files:

- `src/components/viewer/Viewer.tsx`: about 67 KB.
- `src/store.tsx`: about 41 KB.
- `src/lib/pdftools.ts`: about 24 KB.
- `src/components/tools/ToolsScreens.tsx`: about 21 KB.

These are not unmanageable yet, but `Viewer.tsx` and `store.tsx` are already collecting too many responsibilities.

Recommendation:

- Split viewer interaction modes into hooks.
- Split store into document lifecycle, editing, workspace, AI/settings, and persistence.

### 2. Save pipeline is overlay-based

The app is honest in the README: existing text edit is a cover patch plus overlay text. This is useful but not true PDF content editing.

Risks:

- Original text remains extractable unless covered by a non-redaction patch.
- Search/copy may expose the original text.
- Font matching is heuristic.

Recommendation:

- Rename UX from "Edit existing text" to "Replace visually" or implement true content-stream editing through PDFium.

### 3. Form appearance regeneration is best-effort

`form.updateFieldAppearances()` is called in pdf-lib and errors are swallowed.

Risk:

- Some filled fields may render incorrectly in external viewers.

Recommendation:

- Add tests opening saved forms in pdf.js/PDFium.
- Consider PDFium-backed appearance regeneration later.

### 4. OCR heuristic false positives

The app offers OCR when extracted text chars are less than `numPages * 10`.

Risk:

- Blank pages, image-light pages, or form-only documents may be called scanned PDFs.

Recommendation:

- Use image coverage/page object heuristics.
- Suppress on blank PDFs and newly created documents.

### 5. Local persistence needs privacy controls

IndexedDB stores up to 10 PDFs under 80 MB. Chat history and signatures are also kept locally.

Recommendation:

- Add "Clear recent files and cached documents".
- Add "Do not persist documents" privacy toggle.
- Add per-document "Forget this file".
- Add clear chat/signatures controls.

### 6. AI privacy is good direction but incomplete

Settings explain that documents go to the configured endpoint. That is good.

Gaps:

- Default provider is Ollama, but if users switch to custom API, document text can leave the machine.
- API keys are stored in localStorage.
- No built-in browser model in this current version.

Recommendation:

- Make provider privacy explicit at send time.
- Store keys securely in Tauri desktop where possible.
- Add "send current page only" and "selection only" indicators.

### 7. Accessibility needs work

Some icon-only buttons use `title` but lack explicit `aria-label`. The UI is visually clear, but screen reader and keyboard polish is not at pro level.

Recommendation:

- Add labels to icon-only buttons.
- Add focus management in menus/modals.
- Add keyboard-only workflow test.

## Feature Matrix

| Area | Current State | Competitor Expectation | Priority |
| --- | --- | --- | --- |
| Viewing/search | Good | Baseline | Keep |
| Annotation | Basic/good | Comments, stamps, markup variety | P1 |
| Text editing | Visual replacement | True content editing/reflow | P1 |
| Existing image editing | Missing | Move/replace/resize/delete | P1 |
| Forms | Basic | Full form builder, validation, tab order | P1 |
| OCR | Basic local OCR | Languages, page ranges, editable OCR | P1 |
| Redaction | Missing | Destructive text/graphics redaction | P0 |
| Signatures | Visual only | Certificate signing + eSign flows | P1 |
| Security | Weak | Passwords, permissions, secure save | P0 |
| Merge/split/organize | Good | Batch and richer controls | P2 |
| Crop/compress | Not in app | Common expected tools | P1 |
| Compare | Missing | Common pro review feature | P2 |
| Export/convert | PNG/pages only | Word/Excel/PPT/text/images | P1/P2 |
| AI | Local/custom endpoint chat | AI summarize, rewrite, redact, form fill | P1 |
| Tests | Missing | Required for trust | P0 |

## Recommended Roadmap

### Fix Before Marketing More Broadly

1. Rewrite landing copy to match the tracked app.
2. Add masked password modal.
3. Stop saving protected PDFs as decrypted/unprotected output without explicit warning/re-encryption.
4. Add Tauri CSP.
5. Add basic automated tests.
6. Add local data/privacy controls.
7. Fix README mojibake/encoding.

### Build Next For Competitive Credibility

1. True redaction.
2. Crop and compress.
3. Comment/sticky note round-trip.
4. More markup tools: underline, strikeout, squiggly, arrows, stamps.
5. Better form builder.
6. Certificate signature validation/signing.
7. Export text/HTML/DOCX and table extraction.

### Bigger Bets

1. PDFium migration/evaluation.
2. Local browser model option for zero-setup AI.
3. AI form-fill and AI-assisted redaction.
4. Secure share/sign workflows, only once core local editor claims are honest.

## Positioning Recommendation

Do not position this current tracked app as an Acrobat replacement yet.

Best honest positioning:

"A private, local-first PDF workbench for reading, annotating, signing, OCR, forms, and page organization."

Avoid claiming:

- Real redaction.
- Secure e-sign workflows.
- Full PDF security/protection.
- Full content editing.
- Compression/crop/compare/export unless implemented in the tracked app.

## Sources Checked

- Adobe Acrobat: https://www.adobe.com/acrobat.html
- Adobe Acrobat AI Assistant: https://www.adobe.com/acrobat/generative-ai-pdf.html
- Foxit PDF Editor: https://www.foxit.com/pdf-editor/
- PDF-XChange Editor: https://www.pdf-xchange.com/product/pdf-xchange-editor
- Nitro Software: https://www.gonitro.com/
- Nitro OCR guide: https://www.gonitro.com/user-guide/pro/article/ocr-an-existing-pdf
- PDFgear guide: https://www.pdfgear.com/windows-user-guide/introduction-pdfgear.htm
- PDFgear editor: https://www.pdfgear.com/pdf-editor-reader/
- Sejda PDF Editor: https://www.sejda.com/pdf-editor
- iLovePDF Redact PDF: https://www.ilovepdf.com/redact-pdf

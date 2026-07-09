# PickPDF Full Product, Engineering, Market, and SEO Audit

**Audit date:** 9 July 2026  
**Scope:** the current checkout, the running local editor, `https://pickpdf.app`, `https://open.pickpdf.app`, available Windows artifacts, and the current PDF-editor market.  
**Audit type:** read-only except for these report artifacts. Existing source changes were preserved.  
**Confidence:** high for source, build, runtime, HTTP, and artifact findings; low for rankings, traffic, field Core Web Vitals, and conversion because Search Console, production analytics, and CrUX data were not available.

## A. Audit summary

### Verdict

PickPDF is a **promising beta with a strong local-first wedge and broad editor UI**. Release-blocking correctness defects make it **unsafe for privacy-critical PDF work today**. The team must make PDF output trustworthy before expanding the toolbar.

The audit confirmed release-blocking defects that can lose unsaved byte-level edits, corrupt encrypted documents, target the wrong area on 270-degree pages, report failed redaction as successful, preserve hidden cropped content, and strip forms/outlines during page-copy operations. Public download and repository links return 404, available installers lack production trust, and several public claims describe behavior or commercial infrastructure that remains partial or planned.

The credible route to category leadership is narrower than “beat Acrobat everywhere”: **become the fastest, highest-fidelity, private-by-default PDF editor that completes real editing jobs without signup, upload, or watermarks**. PickPDF has the beginnings of that product. It needs a correctness moat, visible privacy proof, and distribution engine before professional/enterprise expansion.

### Directional readiness scorecard

These scores describe readiness to compete with category leaders.

| Area | Score | Assessment |
|---|---:|---|
| Core feature breadth | 67/100 | Strong early breadth: direct text/object work, annotations, forms, OCR, page tools, compare, security, templates, and local AI. |
| PDF correctness and fidelity | 25/100 | Multiple confirmed P0 data-integrity, rotation, redaction, encryption, and structure-preservation defects. |
| Security and privacy engineering | 32/100 | Local processing is a real strength; CSP, headers, link schemes, secret storage, retention controls, and verified redaction are not production-grade. |
| Reliability and performance | 38/100 | Build is healthy, but rendering/history can exhaust the UI and no large-document safety budgets or corpus exist. |
| UX and accessibility | 43/100 | Clean desktop layout and discoverable tools; pointer-heavy editing, weak dialog semantics, small controls, and no tagged-PDF accessibility workflow. |
| SEO and discoverability | 24/100 | Score confidence low: crawl defects, canonical conflicts, orphan pages, thin content, missing authority, and broken conversion links; no GSC/CWV data. |
| Distribution and commercial readiness | 10/100 | No public release path, trusted installer, working checkout/licensing, release automation, or delivered Team infrastructure. |
| Professional and enterprise depth | 18/100 | Missing PKI/e-sign, accessibility remediation, PDF standards/preflight, collaboration, admin, compliance, API/SDK, and integrations. |
| **Overall category-leadership readiness** | **33/100** | **Strong prototype / early beta; not yet safe or distributed enough for a broad launch.** |

### Top three issues

1. **PDF output cannot yet be trusted across core workflows.** Encryption, redaction, rotation, page operations, crop, and dirty-state defects can damage documents or misstate success.
2. **The product promise is ahead of delivered evidence.** Compression, redaction, signed downloads, updates, large-file performance, central seats, and DPA support remain partial or planned.
3. **There is no acquisition-to-install loop.** The public download/repository links return 404, high-intent pages are thin and orphaned, and the app origin creates soft-200 crawl noise.

### Top three opportunities

1. **Own private, local-first editing.** PDFium/WASM, no required account, direct editing, forms, and optional on-device AI form a differentiated base.
2. **Publish a fidelity and privacy benchmark.** A transparent golden corpus for redaction, encryption, fonts, rotations, forms, and 1,000-page files can become both the engineering moat and the strongest authority content.
3. **Turn each search intent into a complete job.** A query-specific page should open the exact editor workflow, finish the task locally, chain the next action, and expose a useful desktop upgrade.

## What works today

- TypeScript typechecking passed.
- The production build passed.
- Vitest passed **79/79 tests across eight files**.
- `npm audit` reported **zero advisories**.
- Rust compiled and `cargo test` passed, although it contains **zero Rust tests**.
- The browser editor successfully created a blank PDF and accepted a placed rich-text object during browser testing.
- The UI exposes a broad, coherent workbench: reader, text/object editing, annotations, reusable signatures, AcroForm filling and design, merge/split/organize, compression, crop, headers/footers/Bates, export, compare, encryption, attachments, templates, and AI.
- The homepage is server-rendered, has one H1, useful screenshots with dimensions/alt text, a valid robots file, and a sitemap.
- Local-first processing is a genuine architectural advantage: the application has no document backend and most PDF work happens in-browser or in the desktop WebView.

The current tests miss the release-critical invariants that failed this audit.

## B. Verified findings

### P0: stop-ship PDF correctness

| Finding | Evidence | Impact | Required fix |
|---|---|---|---|
| Byte-level edits are not marked unsaved | `docHasEdits()` in `src/store.tsx:717-722` checks only annotations, form values, and field ops. Text/object/page/OCR/redaction paths replace bytes. | Close/refresh warnings, dirty dots, and split-view Save can be absent. Applied redactions may never reach the original file. | Track a saved revision/hash and mark every mutation dirty; distinguish crash recovery from saved-to-disk state. |
| Encrypted documents can become unreadable | `src/lib/pdftools.ts:48` uses `ignoreEncryption:true`; `src/lib/pdfium.ts:53` reopens with an empty password. A diagnostic output could not be reopened with the user password or no password. | Protected files can be corrupted or lose protection. | Use the live authenticated handle or owner-decrypt → mutate → validate → re-encrypt. Test permission/version interoperability. |
| 270-degree coordinate mapping is wrong | The branches in `src/lib/pdftools.ts:460-475` and `1804-1818` swap page dimensions. A 600×800 fixture produced `(540,450)` instead of PDFium's `(340,650)`. | Crop, redaction, annotation, OCR, and form placement can affect the wrong region. | Use one canonical PDFium-backed converter and fixture-test 0/90/180/270, non-square pages, and offset CropBoxes. |
| Redaction fails open | `src/lib/pdfium.ts:200-226` skips unloadable pages and ignores a false redaction result; `src/store.tsx:2213-2229` then removes boxes and reports success. | Sensitive content may remain after the user is told it is gone. | Abort on any failure and verify the reopened output through extraction, object inspection, and rendering before removing boxes. |
| Scanned/image redaction is not destructive | `TODO.md:83-88` records that image-only regions are covered while the underlying image remains. The UI says text and images are deleted. | The core privacy promise fails on scanned PDFs. | Remove intersecting image/path content, safely rasterize the affected region/page, or block unsupported redaction with explicit messaging. |
| Page-copy operations strip structures | `src/lib/pdftools.ts:52-130` rebuilds documents with `copyPages`. Diagnostics changed `test-form.pdf` from four fields to zero and removed `/Outlines` from `test-outline.pdf`. | Merge/extract/delete/reorder can drop forms, outlines, named destinations, labels, tags, attachments, signatures, and metadata. | Mutate page trees in place or explicitly preserve/remap catalog structures, then round-trip validate. |
| “Permanent crop” is reversible | `src/lib/pdftools.ts:237-257` sets CropBox/MediaBox; `ToolsScreens.tsx:1105-1114` says the area is removed permanently. | Hidden content remains recoverable by restoring page boxes. | Rename it boundary crop or remove/clamp content and verify output. |

### P1: major security, reliability, and accessibility gaps

| Finding | Evidence | Impact | Required fix |
|---|---|---|---|
| Permission checks are UI-dependent | Split/extract, exports, search/replace, and OCR lack centralized permission enforcement. | Restricted PDFs can be modified or copied through alternate paths. | Enforce permissions inside every mutation/export API. |
| Whole-file history can exhaust memory | Up to 60 complete byte arrays/proxies are retained; dropped entries are not consistently destroyed. | Large files and long sessions can crash. | Use byte budgets/deltas/temp storage and destroy every discarded proxy. |
| Rendering is synchronous and non-cancellable | The async render wrapper does not yield, cancellation is a no-op, full RGBA buffers are duplicated, and no document/pixel limits exist. | Large or malformed PDFs can freeze the UI. | Worker-based tiled rendering, cancellation, and strict resource budgets. |
| CSP and web headers are missing | Tauri sets `csp:null`; live headers lacked HSTS, CSP, frame, MIME, referrer, and permissions policies (automated score 25/100). | Injection and clickjacking impact is harder to contain. | Restrictive CSP plus the six baseline headers on marketing and app origins. |
| Links/endpoints/secrets need hardening | PDF/user link schemes are not strictly allow-listed; custom AI URLs accept arbitrary protocols; API keys are stored in localStorage. | Unsafe launches and secret exposure are possible. | Scheme allow-list, external-launch confirmation, HTTPS except loopback, OS vault on desktop. |
| “Local” retention is opaque | IndexedDB keeps up to ten 80 MB documents; closing does not delete; signatures/chat persist; the cutoff/failures are silent. | Regulated users cannot reason about local retention. | No-retention mode, per-item deletion, clear-all, visible retention, protected secret storage. |
| Accessibility is not production-grade | Dialog semantics/focus traps are missing in custom modals; PDF form controls lack programmatic labels; object editing is pointer-only; placed text is an unlabeled contenteditable; several targets are under 44 px. | Keyboard and screen-reader users are blocked; enterprise/public procurement fails. | Accessible primitives, complete labels, keyboard editing, axe/keyboard E2E, then PDF tagging/remediation. |

## Product gap analysis against category leaders

The market has different leaders. Adobe/Foxit own professional depth and enterprise trust; Smallpdf/iLovePDF own simple task funnels and search distribution; PDFgear owns a strong free/local value story. Adobe exposes accessibility, preflight, standards, OCR, redaction, forms, and bulk e-sign across its current plans ([Adobe comparison](https://www.adobe.com/acrobat/pricing/compare-versions.html)). Foxit combines broad editor parity, enterprise deployment, SDKs, and a formal trust center ([Foxit features](https://www.foxit.com/pdf-editor/pricing/), [Foxit Trust Center](https://www.foxit.com/trust-center/)). Smallpdf reports 40 million monthly users and a multi-platform/integration footprint ([Smallpdf About](https://smallpdf.com/about), [Smallpdf integrations](https://smallpdf.com/blog/smallpdf-apps-and-extensions-for-a-paperless-office)). iLovePDF combines low-cost premium, 25 languages, desktop/mobile/web, and an API ([iLovePDF pricing](https://www.ilovepdf.com/pricing), [iLovePDF security](https://www.ilovepdf.com/help/security)). PDFgear already competes aggressively on free local editing across Windows, macOS, iOS, and Android ([PDFgear product](https://www.pdfgear.com/), [client-side tools](https://www.pdfgear.com/secure-pdf-tools/)).

| Capability | PickPDF now | Category-winning requirement |
|---|---|---|
| Viewing/search/annotations | Broad and visually coherent | Prove fidelity, cancellation, huge-file behavior, attachments/bookmark/comment round-trip, and malformed-file safety. |
| Existing text/object editing | Real PDFium page-object work; a strong differentiator | Paragraph reflow, tables, images/layers, bidi/CJK/font substitution, and a published compatibility corpus. |
| Redaction | Strong intent, unsafe edge behavior | Fail-closed removal of text, images, paths, annotations, metadata, hidden layers, and recoverability verification. |
| OCR | English Tesseract text layer | 20+ languages, auto language detection, deskew/denoise/rotation, editable output, confidence review, benchmarked accuracy. |
| Forms | One of the strongest early areas | Preserve forms through every page operation; auto field detection, calculations/actions, import/export, accessibility, signature workflows. |
| Signatures | Draw/type/upload visual signatures | PKI/PAdES certificate signing, validation, timestamps, audit trail, signer identity, routing, reminders, bulk send. |
| Compression | Image downsampling with controls | Target-size mode, preview, semantic profiles, perceptual quality metric, transparency/color safety, honest lossy/lossless labeling. |
| Conversion | Text/HTML/DOCX/images, approximate layout | High-fidelity Word/Excel/PowerPoint/images/HTML, batch processing, scanned tables, and round-trip evaluation. |
| Standards and print | Bates and basic PDF editing | PDF/A, PDF/X, PDF/E, PDF/VT, PDF 2.0 validation/conversion, preflight, fonts, color/output intents, transparency. |
| Accessibility | UI basics are incomplete; no PDF remediation | WCAG app conformance, tagged PDF, reading order, alt text, tables, form labels, PDF/UA validation, VPAT. |
| AI | Local/remote chat, summarize/rewrite/translate | Grounded citations, multi-document search, safe executable actions, plan/preview/diff/undo, layout-preserving translation. |
| Automation | Individual tools | Reusable workflows, batch jobs, watched folders, CLI, webhooks, API, SDK. |
| Collaboration | None | Review links, threaded comments, presence, approvals, versions, activity history, recipient-driven signature/forms loops. |
| Platforms/distribution | Browser + Windows shell; no public release | Windows/macOS/mobile/PWA/extension, Microsoft/Google/Dropbox/Box connectors, store listings, share sheets, file associations. |
| Enterprise | Mostly marketing/planned | SSO/SCIM, RBAC, domain claim, audit logs, retention/residency, admin analytics, MSI/MDM, SLA, support, DPA/BAA, ISO/SOC 2. |

## SEO and discoverability audit

### Audit summary

The server-rendered marketing site gives crawlers usable HTML. Current SEO maturity is poor. A `site:pickpdf.app` query returned no results during the audit. Search Console must confirm the true index count.

### Confirmed technical/content findings

- The sitemap contains 23 URLs and all returned 200.
- The three guide detail pages canonicalize to `/guides` while remaining in the sitemap. This directly tells crawlers to consolidate them.
- Thirteen commercial routes have no inbound HTML links: eight tool pages, four comparison pages, and the guides hub.
- Tool pages contain roughly 135–165 rendered words, comparisons 108–121, guides 103–111, and Teams about 132, including shared navigation/footer.
- Twenty-two descriptions are below 120 characters, the homepage description is 180, six titles are below 30, and pricing is 67.
- `open.pickpdf.app/robots.txt`, its sitemap path, and arbitrary nonexistent URLs return the same app shell with HTTP 200. The shell has no canonical, description, or noindex.
- Only the homepage has JSON-LD. The baseline `SoftwareApplication`/`Product` block is useful, but there is no sitewide Organization/WebSite graph, guide Article schema, or BreadcrumbList coverage.
- `/llms.txt` returns 404 and AI crawlers are governed only by the wildcard robots rule.
- The homepage lacks a query-descriptive H1; “Where productivity meets privacy” does not identify a PDF editor.
- No About page, named team, author profiles, security contact, company/legal identity, case studies, public benchmark, independent review, or substantive DPA establishes E-E-A-T.
- Live “Download” and “GitHub” links return 404.
- The marketing origin loads Plausible, yet no verified custom conversion goals were found.
- The production marketing router/source and sitemap generator are absent from this tracked checkout; `.gitignore` excludes `landing/`.

### Positive SEO signals

- Valid `robots.txt`, sitemap declaration, HTTPS, 200 responses, and SSR content.
- A substantial 1,300+ word homepage with logical headings.
- Useful product screenshots with dimensions and descriptive alt text.
- Privacy, terms, refund, and DPA URLs exist and are linked, although their content/commitments are incomplete.

### SEO unknowns

- Google/Bing indexed URL counts, exclusions, manual actions, query performance, backlinks, branded/non-branded split, and conversions.
- Field LCP, INP, and CLS. The PageSpeed API rate-limited both attempts, so no CWV value is claimed.
- Whether sitemap `lastmod` values reflect real content changes; every URL used the audit date.

## Trust and claim audit

Several claims should be changed before traffic is scaled:

- **“Reduce file size without quality loss”** conflicts with JPEG re-encoding and downsampling in `src/lib/pdfium.ts:1277+`.
- **“Nothing left behind” / complete redaction** conflicts with image-only regions retaining the underlying image and silent redaction failure paths.
- **“Remove cropped area permanently”** conflicts with page-box-only cropping.
- **“Handles very large files without slowing down”** has no benchmark and conflicts with synchronous rendering, full-byte history, and no resource limits.
- **“Always offline / automatic updates”** conflicts with no service worker in the browser app, runtime model/language downloads, Google Fonts, and no updater plugin.
- **“Signed installer builds”** conflicts with unsigned/test-signed artifacts and failed trust validation.
- **Central seat management, silent rollout, DPA, support, and purchase/refund language** conflict with legal pages repeatedly describing commerce and Team delivery as planned.
- **“No tracking”** is too broad while the marketing site loads Plausible. The correct promise is that document contents remain local by default; remote AI is opt-in and sends selected context to the configured provider; marketing analytics never receives document contents.

## Strategic conclusion

PickPDF should start with one category:

> **The private, local-first PDF editor for people who need real existing-text editing, redaction, forms, and page work without uploading a document.**

To make that position defensible:

1. Make PDF output provably correct across a large public corpus.
2. Make privacy observable through a network-boundary view, precise per-feature disclosures, and fail-closed redaction.
3. Keep the workflow simpler than Acrobat/Foxit while matching web-tool speed.
4. Turn AI into reversible document actions.
5. Build task pages, integrations, and recipient workflows that create repeat acquisition.
6. Add professional standards, signatures, accessibility, and enterprise controls after the core correctness gate passes on each release.

**Fidelity + trust + distribution** will create the durable moat.

## D. Unknowns and follow-ups

The following require production/business access or additional tooling:

- Search Console and Bing Webmaster data.
- Plausible events, funnels, activation, retention, and paid conversion.
- CrUX/PageSpeed field data and real-device performance traces.
- Rust advisory scanning (`cargo-audit` is not installed).
- A representative licensed PDF corpus and fuzz inputs.
- Production certificate, publisher identity, payment/Merchant-of-Record configuration, support obligations, and signed legal agreements.
- User interviews by segment: privacy-sensitive individual, legal/finance operator, student, small team, and enterprise administrator.

## Verification log

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test -- --reporter=verbose` | 79/79 pass |
| `npm run build` | Pass; 2.19 MB main JS, 4.63 MB PDFium WASM, 23.57 MB ONNX runtime WASM |
| `npm audit --json` | 0 advisories |
| `cargo test` | Pass; 0 Rust tests |
| Browser workflow | Local/live app loaded; blank PDF created; text box placed and edited; no immediate console errors |
| Responsive checks | Marketing page fit 375 px; app uses drawers, but the assistant occupies most of a narrow viewport by default |
| Live crawl | 23 sitemap URLs, canonical/internal-link/content/metadata checks completed |
| Security headers | HTTPS pass; six baseline headers missing; automated score 25/100 |
| Broken links | 3 confirmed, including public GitHub and releases URLs |
| Finding verifier | 29 raw, 29 verified, 0 dropped |

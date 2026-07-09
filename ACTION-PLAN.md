# PickPDF Prioritized Action Plan

## Objective

Build PickPDF into the category leader for **private, local-first PDF editing**, then expand into professional and enterprise workflows. The plan is ordered by dependency: correctness and trust first, reliable release/distribution second, growth third, professional breadth fourth.

The north-star metric should be:

> **Successful document jobs per active user**, with no document-integrity or privacy regression.

## Phase 0: stop-ship fixes (0–2 weeks)

### 1. Establish one document-integrity gate

**Impact:** critical  
**Effort:** medium  
**Owner:** PDF engine/state

- Replace `docHasEdits()` with an explicit saved revision/hash.
- Every byte, annotation, form, metadata, protection, OCR, redaction, page, and object mutation must advance the working revision.
- Save must update the saved revision only after the disk/download write succeeds.
- Close, refresh, dirty dots, Discard, split-pane Save, recovery, and autosave must use the same state model.
- Add tests for edit → close, edit → refresh, redact → close, OCR → close, page reorder → close, save failure, and Discard.

**Exit metric:** no mutating command can leave the document visually “clean” before a successful save.

### 2. Replace the encrypted-document pipeline

**Impact:** critical  
**Effort:** high  
**Owner:** PDF engine/security

- Remove `ignoreEncryption:true` from generic helpers.
- Stop reopening protected bytes with an empty password.
- Choose one supported model:
  - mutate through the authenticated PDFium handle, or
  - owner-decrypt to a controlled working copy, mutate, validate, and re-encrypt with the original policy.
- Preserve user/owner password semantics and permissions.
- Test AES-128/AES-256, user/owner password, permissions-only files, malformed encryption dictionaries, save/reopen in Acrobat/Foxit/Chrome/PDFium, and wrong-password behavior.

**Exit metric:** every protected-fixture workflow reopens with the expected password and preserves the expected permission flags.

### 3. Unify coordinate conversion

**Impact:** critical  
**Effort:** medium  
**Owner:** PDF engine

- Replace duplicated 0/90/180/270 formulas with one PDFium-backed transform.
- Cover points, rectangles, matrices, CropBox offsets, MediaBox offsets, and non-square pages.
- Apply the same converter to crop, redaction, form placement, annotation baking, object movement, and OCR.

**Exit metric:** property/fixture tests pass for all rotations and round-trip device → PDF → device within a small tolerance.

### 4. Make redaction fail closed and verifiable

**Impact:** critical  
**Effort:** high  
**Owner:** PDF engine/security

- Treat any page-load, quad, content-generation, or save failure as a complete failure.
- Keep pending redaction boxes until verification passes.
- Remove intersecting text, image, path, annotation, form, metadata, and hidden-layer content where applicable.
- For unsupported image/path cases, block completion with an exact explanation.
- Reopen the output and verify with text extraction, page-object inspection, and raster comparison.
- Add adversarial fixtures: scanned page, vector text, image mask, rotated page, annotations, forms, OCR layer, clipped text, layers, and malformed content streams.

**Exit metric:** 100% of redaction fixtures contain no recoverable target content; a failed verification never produces a success toast.

### 5. Preserve document structures during page operations

**Impact:** critical  
**Effort:** high  
**Owner:** PDF engine

- Replace new-document `copyPages` flows for reorder/delete where in-place page-tree mutation is possible.
- For merge/extract, explicitly map/preserve forms, outlines, named destinations, page labels, metadata, attachments, tags, annotations, optional-content groups, and signatures when semantically valid.
- Define what must be invalidated when pages change, especially digital signatures.
- Validate repository form/outline fixtures and add tagged, signed, portfolio, attachment, and destination fixtures.

**Exit metric:** no undocumented catalog structure disappears from a successful operation.

### 6. Correct crop behavior and copy

**Impact:** critical  
**Effort:** low for copy; high for true destructive crop

- Immediately rename the current mode to “change visible page area.”
- Remove “permanent removal” language until the engine rewrites the content.
- If destructive crop is retained as a feature, clip/rewrite content and verify that objects outside the retained rectangle are unrecoverable.

### 7. Stop overstated public claims

**Impact:** critical  
**Effort:** low  
**Owner:** product/legal/growth

Change or hide these claims until evidence exists:

- “Compression without quality loss” → “lossy image compression with adjustable quality.”
- Complete redaction → clarify supported content and verification.
- Permanent crop → visible-boundary crop.
- “Handles very large files without slowing down” → remove until benchmarked.
- Automatic updates → planned until an updater is shipped.
- Signed installers → remove until production signing validates.
- Central seats, silent deployment, DPA, priority support, and checkout → preview/waitlist until operational.
- “No tracking / nothing leaves” → document processing is local by default; remote AI is opt-in; marketing analytics excludes document contents.

### 8. Repair the public acquisition path

**Impact:** critical  
**Effort:** low–medium  
**Owner:** release/growth

- Replace the 404 GitHub/release CTAs with a real public destination or waitlist.
- Publish production-signed MSI/NSIS artifacts, SHA-256 checksums, versioned release notes, supported OS requirements, privacy note, and rollback instructions.
- Use a real publisher identity and timestamp; automate signature verification before publish.
- Do not expose test-signed or unsigned artifacts as production downloads.

### 9. Fix immediate web/security/SEO blockers

**Impact:** high  
**Effort:** low–medium

- Self-canonicalize the three guide pages or remove them from the sitemap.
- Return real 404s from `open.pickpdf.app` and add `X-Robots-Tag: noindex, nofollow` to the app shell.
- Add HSTS, CSP, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy.
- Add strict URL-scheme allow-lists and safe external-launch confirmation.
- Bring the production marketing router, routes, sitemap generator, and infrastructure into version control.
- Make every tool/comparison/guide reachable through HTML links.

### Phase 0 release gate

Do not open paid checkout or make regulated-industry claims until all conditions pass:

- P0 correctness fixtures green.
- Redaction verification green.
- Protected file interoperability green.
- No structure loss in supported operations.
- Public download succeeds and signature validates.
- Public copy matches delivered capabilities.
- No critical/high known security advisory in JavaScript, Rust, or bundled native/WASM dependencies.

## Phase 1: reliability foundation (weeks 2–6)

### 1. Create the PDF fidelity corpus and CI moat

- Start with 250 curated fixtures; grow toward 5,000–10,000 licensed/synthetic documents.
- Include versions 1.3–2.0, encryption variants, rotations, offset boxes, subset fonts, CJK/RTL, forms, outlines, tags, layers, transparency, attachments, signatures, portfolios, huge images, malformed objects, and scanned pages.
- For each operation, assert invariants across open → render → edit → save → reopen → extract → validate.
- Add pixel baselines with perceptual tolerances and structural assertions with PDFium/qpdf/veraPDF-compatible tooling.
- Add fuzzing for parser boundaries and operation sequences.
- Run the matrix on Windows browser/Tauri; add macOS/Linux browsers as targets expand.

**Metrics:** corpus pass rate ≥99.9%; zero unexplained structure loss; redaction/security invariants 100%.

### 2. Add CI and release governance

- Required checks: typecheck, unit, integration, E2E, a11y, corpus, dependency audit, cargo advisory scan, bundle budget, live-route crawl, security headers, installer signature, SBOM.
- Add coverage thresholds for critical engine/state modules.
- Produce reproducible builds, checksums, SBOM, and signed provenance.
- Use preview deployments for marketing changes and crawl them before merge.

### 3. Make large-file behavior bounded

- Move page rendering/text extraction/OCR to workers.
- Add tiled rendering, true cancellation, page-handle eviction, virtualized thumbnails/text layers, and a byte-budgeted undo history.
- Define maximum pixels/page, pages/document, decompressed image bytes, attachment size, OCR work, and AI context.
- Add graceful recovery and explicit resource-limit messages.

**Metrics:** crash-free sessions ≥99.9%; p75 first-page render ≤1.5 seconds for the agreed benchmark; p75 interaction latency ≤200 ms; memory stays inside a documented budget.

### 4. Add autosave and recovery with privacy controls

- Separate disk save, recovery snapshot, recent-document cache, and version history.
- Add no-retention mode, per-document delete, clear-all, and retention status.
- Do not silently ignore an 80 MB persistence cutoff.
- Store API keys in the OS credential vault on desktop; offer session-only keys on web.
- Encrypt sensitive local caches where feasible and document browser limitations.

### 5. Make the editor UI accessible

- Use accessible dialog primitives and focus traps everywhere.
- Label form inputs and contenteditable surfaces.
- Make object selection/move/resize/delete keyboard-operable.
- Raise mobile/touch targets and test at 360/375/768/1024 widths.
- Add axe, keyboard-only, high-contrast, zoom, and screen-reader smoke tests.

**Metric:** zero serious/critical axe violations in app chrome; all primary jobs complete keyboard-only.

### 6. Instrument privacy-safe product quality

- Opt-in crash/error reports with no document content.
- Local structured logs with a user-controlled export.
- Measure operation success/failure, duration, file size/page count buckets, recovery, and crash-free sessions without file names or contents.
- Publish the telemetry schema and allow complete opt-out.

## Phase 2: win the private-editor wedge (weeks 6–12)

### Product promises to complete

1. **High-fidelity existing-content editing**
   - Finish paragraph reflow, image replace/move/resize/delete, links, tables, bidi/RTL/CJK, and predictable font substitution.
   - Show a preview/diff before destructive layout changes.

2. **Production OCR**
   - Add multi-language packs, auto-detection, deskew, rotation, denoise, confidence review, and selective page OCR.
   - Benchmark accuracy against a reproducible set.

3. **Useful compression**
   - Add target-size mode, side-by-side preview, profiles, transparency/color safeguards, and perceptual-quality reporting.

4. **Honest conversions**
   - Improve layout-preserving DOCX and add tables/CSV/Excel where quality can be measured.
   - Expose accuracy/limitations; avoid promising full fidelity before corpus results support it.

5. **Action-oriented local AI**
   - Replace the 3 GB default with a smaller practical model or explicit opt-in.
   - Add grounded page citations and multi-document search.
   - Implement safe commands such as “redact every account number,” “compress under 5 MB,” or “translate pages 4–8” as plan → preview → apply → diff → undo.
   - Never silently execute destructive actions.

### Trust product

- Publish `/security`, `/privacy-architecture`, `/status`, `/changelog`, `/about`, and `/contact`.
- Show a per-feature data-boundary label: local, downloads model/language data, or sends selected context to a configured endpoint.
- Add a network activity view that demonstrates document bytes are not uploaded.
- Publish the corpus methodology and benchmark dashboard.
- Establish a vulnerability disclosure policy and security contact; commission an independent review when the P0 gate is stable.

### Public beta gate

- 500+ corpus fixtures passing.
- Public, trusted installer and release notes.
- Task completion ≥90% for edit, redact, sign, form fill, merge, split, compress, OCR, and save in moderated tests.
- Median time to first useful result under 60 seconds.
- Support and rollback path operational.

## Phase 3: distribution and growth engine (months 3–6)

### 1. Turn search pages into real product workflows

Each tool page must:

- Be self-canonical and internally linked.
- Explain the exact local-processing boundary.
- Open the editor directly in the matching workflow.
- Include an original screenshot/video, limitations, example PDF, related tools, and a complete answer to the search intent.
- Contain meaningful, human-reviewed content; use 600–1,000+ words only when the intent needs it.
- Track start, successful output, chained task, desktop download, and return.

Fix the existing pages before adding more. Priority cluster:

1. edit PDF
2. redact PDF
3. fill/design forms
4. OCR scanned PDF
5. merge/split/organize
6. compress PDF
7. sign PDF
8. compare PDFs
9. protect/encrypt PDF
10. crop/watermark/page numbers/export

### 2. Build authority content

- Convert README engineering evidence into dated, authored guides.
- Publish redaction-vs-whiteout, subset fonts, AcroForms, PDF permissions, local AI privacy, and OCR-layer explainers.
- Publish balanced, sourced competitor comparisons with methodology and “best for” conclusions.
- Add Organization/WebSite, SoftwareApplication, BreadcrumbList, and TechArticle JSON-LD with stable IDs.
- Add `llms.txt`; explicitly decide search/citation versus model-training crawler policy.
- Do not use commercial FAQPage schema.

### 3. Measure search and conversion

- Verify Google Search Console, Bing Webmaster Tools, and IndexNow.
- Plausible goals: `open_app`, `tool_started`, `tool_success`, `export_success`, `chain_tool`, `download_windows`, `pricing_view`, `checkout_start`, `team_lead`.
- Track cross-domain attribution between marketing, app, and download/checkout.

**Metrics:** ≥95% valid sitemap URLs indexed; zero canonical conflicts/soft 404s; task-page → tool-start and tool-start → success improve weekly; organic activation measured by route/query.

### 4. Distribution surfaces

- Microsoft Store and trusted direct download.
- Browser extension and PWA/offline shell.
- Google Drive/Workspace, OneDrive/Microsoft 365, Dropbox, and Box opening/saving.
- File associations, shell context actions, print-to-PDF, and share sheets.
- macOS desktop after the Windows release process is stable.
- Localize only proven pages/workflows; begin with 3–5 languages, then expand based on demand.

## Phase 4: professional and enterprise expansion (months 6–18)

### Professional parity

- Certificate signing and validation: PKCS#7/PAdES, timestamping, trust chains, change detection, certificate stores/smartcards.
- E-sign workflows: recipients, identity, routing, audit trail, reminders, templates, bulk send.
- Accessibility: auto-tagging, reading order, headings/tables/alt text/forms, PDF/UA and WCAG validation/remediation.
- Standards/prepress: PDF/A/X/E/VT and PDF 2.0 validation/conversion, preflight, embedded fonts, color/output intents, transparency, image resolution.
- Sanitization and safe view: JavaScript/attachment/executable warnings, metadata/hidden-content removal, malformed-PDF isolation.
- Document portfolios/binders, action sequences, watched folders, and batch processing.

### Collaboration and platform moat

- Review links, roles, threaded comments, approvals, version diff, activity history, and multi-document workspaces.
- API and SDK for rendering, editing, OCR, conversion, forms, redaction, and signatures.
- Webhooks, workflow builder, and developer usage/billing.

### Enterprise procurement

- SAML/OIDC SSO, SCIM, RBAC, domain claiming, audit logs, admin analytics, retention/residency controls.
- MSI/MSIX/MDM deployment, on-prem/air-gapped rights, SLAs, invoicing/POs, support operations.
- Subprocessor list, DPA/BAA where applicable, security whitepaper, penetration tests, SBOM/CVE policy.
- Pursue SOC 2 Type II and ISO 27001 after operational controls are real and auditable.

## Commercial ladder

Launch only the tiers that can be delivered:

- **Free web:** common jobs, no watermark, no account, clear local-processing boundaries.
- **Pro desktop:** one-time purchase after the trusted installer, updater policy, licensing, support, and refund flow exist.
- **Team:** annual per-seat only after central seats, deployment, invoicing, support, and signed DPA are operational.
- **Enterprise:** custom terms after SSO/SCIM, audit, residency/retention, SLA, and compliance evidence.
- **Developer:** metered API/SDK once the engine is stable enough to support external integrations.

## Leadership scorecard

Report weekly:

| Dimension | Core metric |
|---|---|
| Correctness | Corpus open/edit/save/reopen pass rate; unexplained structure loss |
| Privacy | Verified local-processing rate; redaction invariant pass; retention opt-out usage |
| Reliability | Crash-free sessions; recovery success; operation failure rate |
| Performance | p50/p75/p95 first page, interaction, operation, export, and peak memory |
| Activation | First useful result under 60 seconds; primary task completion |
| Depth | Users completing two or more chained tools |
| Retention | Weekly/monthly retained job creators |
| Growth | Search impression → tool start → successful output → return/download |
| Trust | Signed-release validation, security review pass, unresolved critical/high vulnerabilities |
| Commercial | Free-to-paid conversion, refunds, support contacts per 1,000 customers |
| Network effects | Review/sign/form recipients who become active creators |

## Realistic ambition

Becoming the broad global “#1 PDF product” is a multi-year company-building effort because incumbents combine decades of format expertise, hundreds of millions of users, integrations, certifications, and distribution. Becoming the **best private local-first editor for real PDF work** is a credible first win.

With a focused senior team, a release-safe beta is plausible after the P0/P1 program; a category-leading privacy wedge can be pursued over the next 6–12 months. Broad professional/enterprise parity is more likely a 12–24+ month program. For a solo developer, the same sequence remains correct, but scope should stay on the private-editor wedge until reliability and distribution compound.

# PickPDF Prioritized Action Plan

**Updated:** 2026-07-12
**Audited snapshot:** `main` and `origin/main` at `da01514`

## Objective

Make PickPDF the most trustworthy local-first PDF editor before expanding into a general Acrobat replacement.

The release metric is:

> **Successful document jobs with zero silent loss, corruption, privacy failure, or false save confirmation.**

Feature count is not the next constraint. File integrity, proof, distribution, and trust are.

## Release gates

Do not call the product production-ready, sell Team delivery, or direct broad traffic to Download until every gate below passes.

| Gate | Current state | Required evidence |
|---|---|---|
| Encrypted edit/save | Fixed in working tree | Owner-authenticated edit/re-encrypt output reopens with both password roles; user-only input remains read-only. Cross-viewer legacy-encryption corpus remains. |
| Redaction | Confirmed nested-image bypass fixed | Text, page/Form images, and contained paths fail closed and are rechecked recursively. Annotation, metadata, and optional-content policy remains broader hardening. |
| Page deletion | Fixed in working tree | Deleted content is absent from decoded streams and the survivor output reopens/renders in Poppler. Safe outline/destination remapping remains. |
| Save completion | Fixed in browser fallback | Anchor download keeps dirty state; only awaited file-handle writes clear it. |
| Create PDF text fidelity | Fails for unsupported Unicode | Multilingual source text converts without silent character replacement and passes render/extraction checks. |
| Golden corpus | Missing | Mandatory CI opens, mutates, saves, reopens, renders, extracts, and validates every fixture. |
| Installer trust | Fails | Current source commit produces production-signed, timestamped, version-consistent artifacts with checksums and SBOM. |
| Public install loop | Fails | Every Download/GitHub CTA resolves to a tested release destination. |
| Claims and legal | Fails | Public copy matches shipped behavior and complete legal/support terms. |
| Security baseline | Fails | Tested CSP plus HSTS, frame, MIME, referrer, and permissions headers on both origins and desktop. |

## Phase 0: close stop-ship defects

### 1. Lock the synchronized snapshot into a release identity

**Owner:** release engineering
**Effort:** small
**Impact:** critical

- Completed for this audit: local `main` now exactly matches `origin/main` at `da01514`, with existing user work preserved.
- Freeze a release candidate and assign one version from a single source.
- Generate the commit, version, build time, dependency lock hash, and feature flags into an artifact manifest.
- Use a signed tag for every public build.

**Exit:** website, source, tests, installers, checksums, release notes, and About dialog all identify the same commit and version.

### 2. Replace encrypted editing with an authenticated plaintext pipeline

**Status:** completed for the confirmed corruption path; retain the legacy/cross-viewer matrix below.

**Owner:** PDF engine/security
**Effort:** large
**Impact:** critical

- Stop passing encrypted bytes to pdf-lib with `ignoreEncryption:true` as if they were plaintext.
- Use the authenticated PDFium document to produce verified decrypted working bytes, or use an encryption-capable library that preserves the security handler correctly.
- Separate user-password and owner-password semantics. Do not silently replace an unknown recipient password.
- Reapply protection only after the edited plaintext validates.
- Reopen saved output with intended passwords and verify permissions, page count, text, forms, outline, attachments, annotations, and render hashes.

Test matrix:

- empty user password plus owner password
- distinct user and owner passwords
- owner-only open
- AES-128, AES-256, and legacy RC4 input
- every permission flag, including document assembly
- overlay edit, text edit, page operation, form fill, OCR, redaction, and signature paths

**Exit:** no encrypted corpus fixture can become unreadable or silently change access semantics.

### 3. Make redaction recursive and independently verifiable

**Status:** completed for nested Form images and unreadable object geometry; continue the broader content-class corpus below.

**Owner:** PDF engine/security
**Effort:** large
**Impact:** critical

- Traverse nested Form XObjects and optional-content groups.
- Treat unreadable object geometry or a failed removal as an error.
- Cover text, raster images, paths, annotations, form appearances, metadata, attachments, thumbnails, and hidden layers.
- If a construct cannot be safely edited, rasterize the affected page at a documented quality or block the operation.
- Verify fresh output through text extraction, object traversal, raw stream scan, and render comparison.
- Keep redaction boxes and original bytes on every failure.

**Exit:** adversarial fixtures cannot recover the secret with text extraction, object extraction, layer toggling, stream inspection, or alternate viewers.

### 4. Sanitize deleted pages and destructive crop output

**Status:** secure page deletion completed through survivor rebuild; outline/destination remapping remains.

**Owner:** PDF engine
**Effort:** medium
**Impact:** critical

- Garbage-collect unreachable page objects after deletion.
- Remap or remove outlines, named destinations, page labels, form fields, attachments, and actions that point to removed pages.
- Add a separate **Secure remove page** operation if ordinary deletion cannot guarantee erasure.
- Keep boundary crop named and described as non-destructive.

**Exit:** deleted-page secrets are absent from all saved streams and every surviving structure remains valid.

### 5. Correct save and download state semantics

**Status:** completed and verified in the browser anchor-fallback path.

**Owner:** application state/platform
**Effort:** small
**Impact:** critical

- Reserve **Save** for an awaited filesystem or desktop write.
- Rename anchor fallback to **Download copy** and keep the document dirty.
- Preserve dirty state when a picker is cancelled, a download is blocked, a write fails, or an edit lands during a write.
- Show the saved path or downloaded-copy status precisely.
- Add browser and Tauri end-to-end tests for every branch.

**Exit:** no failed or unconfirmed write can clear the unsaved-edit warning.

### 6. Build the document-integrity test gate

**Owner:** quality/PDF engine
**Effort:** medium
**Impact:** critical

- Track `test-fixtures/` and define licenses/provenance for every sample.
- Add malformed, huge, encrypted, signed, tagged, layered, scanned, font-heavy, form, portfolio, attachment, rotation, CropBox, and nested-XObject files.
- Add property tests for coordinates and page trees.
- Add corpus and fuzz runs for every parser and mutation entry point.
- Compare output in PDFium, qpdf, veraPDF, Acrobat, and Foxit where licensing permits.
- Run Windows browser/Tauri end-to-end tests, axe, screenshots, and Rust tests in CI.

**Exit:** pull requests cannot merge when file invariants, accessibility, security, or release packaging regress.

### 7. Ship one trustworthy Windows release

**Owner:** release engineering
**Effort:** medium
**Impact:** critical

- Replace the test certificate with a production code-signing identity.
- Sign and timestamp MSI/NSIS artifacts and fail the build on any invalid signature.
- Add reproducible builds, dependency inventory, SBOM, checksums, release notes, malware scan, and clean-VM install/uninstall tests.
- Add updater signing, staged rollout, rollback, file associations, single-instance/open-with behavior, and crash diagnostics with explicit privacy controls.
- Publish the release at a stable first-party URL.

**Exit:** a clean Windows machine installs the exact audited commit without trust errors and can safely update or roll back.

### 8. Correct claims, security headers, and legal delivery

**Owner:** product, legal, web, security
**Effort:** medium
**Impact:** critical

- Remove claims for central seats, silent deployment, PO billing, priority support, delivered DPA, automatic updates, proven huge-file performance, or absolute offline behavior until each exists.
- Mark Pro and Team as preview if checkout, licensing, support, and legal delivery are not live.
- Publish complete Privacy, Terms, Refund, DPA, EULA, Security, and support commitments.
- Add a restrictive CSP and all six baseline headers to both origins and Tauri.
- Add safe link schemes, external-launch confirmation, HTTPS endpoint validation, and OS vault storage for desktop API keys.

**Exit:** every public promise maps to a tested feature, contract, or published measurement.

## Phase 1: harden the solo editor

### 9. Finish page and annotation round-trip fidelity

- Preserve and remap outlines, destinations, labels, forms, tags, attachments, actions, layers, and metadata for every page operation.
- Do not flatten imported annotations into a reduced model without a warning or lossless preservation path.
- Add incremental save where it protects signatures and reduces rewrite risk.
- Warn before any action invalidates an existing signature.

### 10. Centralize authorization

- Move permission enforcement into mutation and export services.
- Model print quality, copy/accessibility extraction, modification classes, annotation, form fill, and document assembly separately.
- Test every operation under every permission combination.

### 11. Put memory and work on budgets

- Replace the 60-step full-file history cap with a byte budget.
- Use deltas or temporary files for large content revisions.
- Dispose every dropped PDFium handle deterministically.
- Workerize rendering, extraction, OCR, compression, and long edits.
- Add cancellation, tiling, virtualization, and page/pixel/file/time limits.
- Define supported limits from measured p75 and worst-case data.

### 12. Make the application accessible

- Use one accessible modal primitive with focus trap, restoration, Escape, title, and description.
- Label all existing PDF form controls and contenteditables.
- Add keyboard selection, movement, resize, ordering, and deletion for page objects and annotations.
- Enforce 44 px targets where practical and visible focus everywhere.
- Run axe, keyboard, high-contrast, zoom, and screen-reader tests in CI.

### 13. Complete local certificate trust

- Use incremental revisions for signing.
- Add ECDSA, OS certificate stores, smartcards, chain building, revocation, timestamps, and LTV.
- Distinguish cryptographic validity, certificate validity, identity trust, document modification, and whole-document coverage.
- Preserve and verify multiple signatures.

### 14. Add explicit local-retention controls

- Provide ephemeral/no-retention mode.
- Add per-document delete, clear-all, chat/signature/model cache controls, and retention duration.
- Show current local storage use and failures.
- Keep protected working copies protected at rest.

### 15. Make Create PDF Unicode-safe

- Replace WinAnsi-only standard fonts with embedded fonts that cover the selected scripts.
- Shape Arabic, Indic, and other complex scripts and preserve bidirectional order.
- Use explicit fallback fonts per text run.
- Detect unsupported characters before conversion and block or obtain informed consent for any lossy result.
- Add multilingual TXT and DOCX fixtures covering Latin extensions, Arabic, CJK, Indic, emoji, and mixed-direction content.

**Exit:** conversion never silently replaces a source character and rendered output matches extracted text for every supported script.

## Phase 2: build a working acquisition loop

### 16. Fix technical SEO and crawl architecture

- Self-canonicalize the three guide detail pages.
- Return real 404s on `open.pickpdf.app` and send `X-Robots-Tag: noindex, nofollow` for the app shell.
- Build linked Tools, Guides, and Comparisons hubs.
- Convert homepage tool tiles into crawlable links.
- Use permanent redirects for canonical HTTP and `www` normalization.
- Add Organization, WebSite, BreadcrumbList, Article, and appropriate SoftwareApplication schema.

### 17. Replace thin pages with complete task experiences

Each tool page should:

- open the exact workflow
- explain what happens locally and what leaves the device
- show inputs, outputs, limitations, and supported cases
- include real screenshots or short demos
- answer task-specific questions
- link to adjacent jobs and the desktop value proposition
- cite a named author and last verified date

Comparison pages should use reproducible tests, not generic feature grids.

### 18. Publish trust and authority evidence

- About, Contact, Security, Trust, Changelog, Authors, Case Studies, and `security.txt`
- public fidelity, redaction, encryption, accessibility, and large-file benchmark methodology
- responsible disclosure and response targets
- named operator/company and support channels
- release notes and independently verifiable artifacts

### 19. Instrument the funnel without instrumenting documents

Track:

- tool page to exact workflow open
- browser editor activation
- download attempt and verified release fetch
- first document job completed
- return use
- Pro interest and Team lead receipt

Never send document names, contents, text, annotations, or editor actions to marketing analytics.

## Phase 3: earn category leadership

### 20. Standards and PDF accessibility

- tagged-PDF creation and repair
- reading order, headings, lists, tables, figures, alt text, language, and form labels
- PDF/UA validation and reports
- validator-backed PDF/A conversion
- PDF/X, PDF/E, PDF/VT, output intents, fonts, transparency, and preflight

### 21. Optional agreement workflows

- recipient routing, roles, templates, authentication, reminders, expiry, bulk send, and audit evidence
- embedded signing, webhooks, APIs, and qualified-signature partners where required
- keep local certificate signing available without an account

### 22. Automation, collaboration, and integrations

- reusable local batch workflows and watched folders
- CLI, REST API, SDK, and webhooks
- shared review links, threaded comments, mentions, assignments, approvals, and version history
- opt-in Microsoft 365, Google Drive, Dropbox, Box, SharePoint, and DMS connectors

### 23. Platforms and enterprise controls

- macOS after Windows release quality is stable
- mobile or an installable high-quality web experience based on measured demand
- SAML/OIDC, SCIM, RBAC, domain claim, audit logs, retention/residency, policy control, MSI/MDM, and air-gapped licensing
- DPA, SLA, support operations, third-party assessment, and compliance evidence

### 24. Action-oriented local AI

- local plan, preview, diff, apply, and undo for document actions
- cited multi-document answers
- PII detection and redaction proposals
- form and table extraction
- auto-form creation
- layout-preserving translation
- evaluation datasets for accuracy, grounding, privacy boundaries, and unsafe actions

## Product metrics

Track these from the first trusted release:

| Metric | Why it matters |
|---|---|
| Successful document-job rate | Measures whether users finish the task. |
| Save/reopen invariant pass rate | Detects file-integrity regressions. |
| Redaction verification pass and blocked rate | Measures both safety and unsupported cases. |
| Crash-free and out-of-memory-free sessions | Validates large-file reliability. |
| p75 first-page render and edit latency | Keeps local processing usable. |
| Download to first completed job | Measures the real acquisition loop. |
| 7-day return rate by job type | Identifies the durable wedge. |
| Support cases per 1,000 completed jobs | Exposes hidden fidelity and UX failures. |

## Immediate execution order

1. Freeze `da01514` or its safety-fix successor as a signed release candidate.
2. Commit the passing regressions for encrypted edit/save, nested-image redaction, deleted-page remanence, and browser save fallback; add the multilingual Create PDF failure next.
3. Fix Unicode Create PDF loss before adding more editing tools.
4. Track the golden corpus and add CI.
5. Build and verify a production-signed installer from the same commit.
6. Publish a working download destination.
7. Correct claims and complete security/legal pages.
8. Fix headers, app-origin crawl behavior, guide canonicals, and internal links.
9. Run an external PDF-security, accessibility, and interoperability review.
10. Publish the benchmark and use it as the basis of PickPDF's local-first position.

Completion means the evidence passes. A merged implementation without the required tests and cross-viewer output is not complete.

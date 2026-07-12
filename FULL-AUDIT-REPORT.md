# PickPDF Re-Audit

**Audit date:** 2026-07-12
**Previous baseline:** 2026-07-09
**Base snapshot:** `main` and `origin/main` at `da01514`
**Fix status:** stop-ship fixes applied in the current working tree

## Executive verdict

PickPDF now scores an estimated **50/100 for category-leadership readiness**, up from the original 33/100 baseline. The current stop-ship fix working tree passes 297 tests, typecheck, production build, and npm audit with zero advisories.

The four confirmed file-safety blockers are fixed in the current working tree:

1. Encrypted editing requires an owner-authenticated plaintext working copy and fails closed otherwise.
2. Redaction recursively removes and verifies images inside nested Form XObjects.
3. Page deletion rebuilds from surviving pages and excludes detached streams.
4. Browser download fallback keeps the document dirty because completion cannot be confirmed.

Distribution is also blocked. Public download and GitHub links return 404, available installers are stale and untrusted, and the site sells capabilities that are absent or described as planned in its own legal copy.

The new Word/text conversion is also lossy: unsupported Unicode is silently replaced with question marks. Its UI warns about layout loss but not character or script loss.

## Audit scope

The audit base is `main` at `da01514`; the four stop-ship fixes are uncommitted working-tree changes on top of that synchronized base. Existing user changes and untracked files were preserved.

The audit covered:

- PDF mutation, save, encryption, redaction, page operations, crop, signatures, permissions, undo, and persistence
- unit, type, build, dependency, and Rust gates on the exact synchronized snapshot
- a real browser workflow that created a blank PDF, opened the editor, and opened the Word/text conversion screen
- current Windows installer trust, timestamps, versions, and source freshness
- live `pickpdf.app` and `open.pickpdf.app` crawling, metadata, canonicals, links, headers, schema, legal copy, and conversion paths
- product gaps against current Adobe, Foxit, Nitro, Smallpdf, iLovePDF, PDFgear, and e-sign market expectations

## Readiness scorecard

| Area | Jul 9 baseline | Main `da01514` | Re-audit assessment |
|---|---:|---:|---|
| Core feature breadth | 67 | 84 | A broad solo editor with several professional editing tools. |
| PDF correctness and fidelity | 25 | 70 | The four confirmed file-safety paths are fixed; Unicode Create PDF loss and broader structure/interoperability coverage remain. |
| Security and privacy engineering | 32 | 45 | Redaction and secure deletion improved; CSP, link safety, secret storage, and verifiable privacy remain weak. |
| Reliability and performance | 38 | 52 | Unit and browser coverage improved; memory, cancellation, large-file limits, and CI remain open. |
| UX and accessibility | 43 | 50 | Editor depth improved; modal, keyboard, labeling, and PDF accessibility work remains substantial. |
| SEO and discoverability | 24 | 24 | No material live SEO defect is fixed. |
| Distribution and commercial readiness | 10 | 8 | Dead CTAs, stale installers, no trusted release, no updater/licensing stack, and claim mismatch. |
| Professional and enterprise depth | 18 | 41 | Certificate signing, PDF/A preflight, OCR, and layers help; standards, workflows, platforms, integrations, and admin systems remain absent. |
| **Overall category-leadership readiness** | **33** | **50** | **Core safety is materially better; distribution, Unicode fidelity, accessibility, and release proof still block leadership.** |

Scores are directional product-readiness judgments, not statistical measurements.

## Prior stop-ship finding status

| Jul 9 finding | Re-audit status | Evidence |
|---|---|---|
| Byte edits were not marked unsaved | **Fixed** | Revision state is now the dirty-state source of truth. Page, OCR, object, text, and redaction mutations bump byte revisions. Dedicated tests cover save races, discard, and undo. |
| Encrypted PDFs could become unreadable | **Fixed** | Mutation loaders reject encrypted bytes. Editing begins only after PDFium owner authentication and decryption; a user-password-only open stays read-only. The re-encrypted regression output reopens with both password roles. |
| 270-degree coordinates were wrong | **Fixed** | One coordinate module now covers every rotation and offset CropBoxes. Regression tests include non-square 270-degree pages. |
| Redaction could silently report success | **Fixed for the confirmed bypass** | Removal and verification recurse through Form XObjects, apply accumulated transforms, and fail on unreadable geometry or removal failure. |
| Image-only redaction was cosmetic | **Fixed for page/Form images** | Overlapping images are removed at page or nested Form ownership level and the saved output is rechecked recursively. |
| Page operations stripped structures | **Partial** | Secure delete now rebuilds survivors and preserves metadata/forms, but outlines, destinations, and page labels are omitted until safe remapping exists. |
| Permanent crop was reversible | **Fixed as a claim issue** | Crop remains a boundary operation, but the UI now states that outside content remains in the file. A secure destructive crop still does not exist. |

Result: the four confirmed stop-ship paths are fixed in the working tree. The broader page-structure, annotation/metadata redaction, and interoperability work remains a release-quality program rather than one defect.

## Stop-ship fixes applied

### 1. Encrypted edit/save now fails closed and reopens safely

All mutation-capable pdf-lib loaders now reject encrypted bytes. Owner-authenticated documents are decrypted through PDFium into a plaintext working copy, edited there, and re-encrypted for disk. User-password-only documents remain read-only until the owner password is supplied.

Regression evidence:

- direct pdf-lib mutation of encrypted bytes is rejected
- owner-decrypt, rotate, re-encrypt completes
- saved output reopens with both user and owner passwords
- rotation and text content survive the round trip

Remaining hardening: add AES-128, legacy RC4, empty-user-password, and cross-viewer corpus fixtures.

### 2. Redaction removal and verification are recursive

The object walker now descends through nested Form XObjects, accumulates affine transforms, removes children from their real owner, and uses the same traversal after saving. Unreadable objects, bounds, matrices, or removal failures abort the operation.

Regression evidence: nested image removal passes, a forced Form removal failure throws, and Poppler renders the redacted output with the image replaced by the black redaction box.

### 3. Page deletion excludes detached page data

`deletePages` now creates a fresh document from survivor indexes. Metadata and surviving interactive fields are restored, while old page objects and streams are never copied.

Regression evidence: the deleted page's unique text is absent from every decoded output stream, surviving text remains, and Poppler reopens and renders the result. The deliberate tradeoff is that outlines, named destinations, and page labels are omitted until safe remapping is implemented.

### 4. Browser fallback keeps dirty state

When the File System Access API is unavailable, the app downloads a copy and returns before `markSaved`, persistence, or editing-session cleanup. The UI explicitly states that the browser cannot confirm the write.

Browser evidence: after editing a blank PDF and clicking Save through the anchor fallback, both Unsaved edits indicators and the Discard action remained visible.

## Remaining current release blocker

### There is no trustworthy release

- `https://pickpdf.app/download` and `/download/windows` return 404.
- The public repository and releases links return 404.
- Jul 8 installers predate audited main `da01514`.
- Artifacts are unsigned, test-signed with `UnknownError`, or inconsistently versioned.
- No tag, release manifest, checksums, SBOM, update path, or rollback identifies a shipped commit.

Release gate: one version source, one audited commit, production code signing, trusted timestamping, checksums, SBOM, release notes, updater, and live download verification.

## Important non-blocking findings

### PDF structures and permissions

- Extract and merge omit outlines, named destinations, and page labels.
- Deleted destinations can dangle.
- Duplicate and imported-page paths do not fully re-register fields.
- Split/extract, several exports, OCR, and search/replace bypass central permission enforcement.
- Signature invalidation behavior is not consistently explained before edits.

### Memory and large-file behavior

- Undo retains up to 60 full byte snapshots and is not byte-budgeted.
- Dropped history entries do not always release every PDF proxy.
- Rendering is synchronous, has a no-op cancel path, and duplicates full RGBA buffers.
- No page, pixel, file, time, or malformed-input budget protects the UI.
- The main build contains a 2.266 MB main JS chunk, a 404.85 KB document-conversion chunk, 4.634 MB PDFium WASM, 23.567 MB ONNX WASM, and a 541 KB worker.

### Security and local privacy

- Tauri still uses `csp:null`.
- Both live origins scored 25/100 in the security-header check.
- PDF and user links lack a strict safe-scheme policy.
- Custom AI endpoints accept arbitrary URLs.
- API keys remain in localStorage.
- IndexedDB retains up to ten documents; closing is not deletion.
- There is no no-retention mode, storage dashboard, or surfaced quota failure.

### Accessibility

About and Confirm dialogs improved. Most other modals still lack complete semantics, focus traps, and restoration. Existing PDF form overlays lack programmatic labels, object editing is pointer-only, placed text uses an unnamed contenteditable, and small targets remain. There is no axe, keyboard end-to-end, or screen-reader suite. PDF tagging, reading-order repair, alt text, table remediation, and PDF/UA validation are absent.

### Certificate signatures

The new RSA `.p12/.pfx` CMS signing and local verification are meaningful. Eight signature tests pass. This is not yet a full professional trust stack. Missing pieces include:

- incremental signing and safe multiple-signature revisions
- OS trust-store chain validation and revocation
- ECDSA, smartcards, and hardware-backed keys
- RFC 3161 timestamps and long-term validation
- explicit warnings before signature-breaking edits
- recipient routing, authentication, evidence records, reminders, and APIs

### Create PDF character fidelity

Word/text conversion draws with standard WinAnsi Helvetica fonts. Unsupported Unicode is sanitized to `?` before output, so Arabic, CJK, Indic, emoji, and other characters can be corrupted without a failed conversion. The screen warns about layout, images, columns, and font loss, but not character loss.

Release gate: embed suitable Unicode fonts, shape complex scripts, preserve fallback per run, warn or fail before any lossy conversion, and test multilingual TXT and DOCX fixtures.

## Current `main` feature delta

The synchronized branch includes the prior upstream editing work plus Create PDF. The stop-ship fix working tree raises the suite to 297 passing tests. Added capabilities include:

- paragraph reflow for in-place text editing
- existing-image replacement
- import and save of supported native annotations
- alignment, distribution, and snapping
- polygon, polyline, and cloud shapes
- optional-content layer visibility controls
- 33 OCR languages
- PDF/A-2b-oriented structural preflight
- blank PDFs and basic image, DOCX, and text conversion

The current build and tests pass, but the newer features have limits that must remain visible:

- growing paragraphs can overlap content below
- annotation import reconstructs a reduced model and can lose rich properties
- layer toggles do not model every locked or application-state rule
- PDF/A preflight is heuristic, not certification or conversion
- OCR processes the whole document in one chosen language
- Word/text conversion replaces unsupported Unicode instead of preserving it

No current commit changes release packaging, public downloads, CI, accessibility, commercial delivery, security headers, collaboration, APIs, integrations, or enterprise administration.

## Live SEO, trust, and conversion re-audit

No material documented live defect was confirmed fixed in the 2026-07-12 refresh.

| Area | Status | Current evidence |
|---|---|---|
| Sitemap and canonicals | Unchanged | 23 URLs return 200; three guide detail pages canonicalize to `/guides`; every `lastmod` is 2026-07-09. |
| App-origin crawl behavior | Unchanged | `/robots.txt`, `/sitemap.xml`, and random paths return the same 730-byte shell with 200 and no `noindex`. |
| Internal links | Unchanged | The sitemap still lists 23 URLs, while a homepage crawl reaches only the core legal/pricing pages. Tool and comparison routes remain disconnected from primary navigation. |
| Content depth | Unchanged | Tools are about 101-129 visible words, comparisons 65-78, guide articles 73-81, Teams 91, and legal pages 102-112 including shared chrome. |
| Metadata | Unchanged | 22/23 descriptions are below 120 characters, six titles are below 30, pricing is 67, and the H1 does not name a PDF editor. |
| Schema and entity trust | Unchanged | Only the homepage has JSON-LD. About, Contact, Security, Trust, Changelog, security.txt, Authors, and Case Studies return 404. |
| Headers | Unchanged | Both origins omit the six baseline security headers. |
| Download and GitHub | Unchanged | `/download`, `/download/windows`, the public repository, and releases path return 404. |
| AI-search support | Unchanged | `llms.txt` and `llms-full.txt` return 404. |
| Conversion measurement | Unchanged | Plausible pageviews load, but no explicit download, open-editor, Pro, or Team-lead event was found. |

Positive signals remain: HTTPS works, HTTP and `www` redirect to the canonical host, all sitemap URLs return 200, marketing 404s behave correctly, social metadata is complete, and titles/descriptions are unique.

PageSpeed returned rate-limit responses, so no Core Web Vitals score is claimed.

## What PickPDF still needs to be category number one

The viable position is narrower than "best PDF product for everyone":

> **The private, verifiable, local-first PDF editor for real document work.**

The fastest path is to make local processing provably safer than cloud-first competitors while keeping common work simpler than Acrobat or Foxit.

| Priority | Gap | Market bar | Required PickPDF outcome |
|---:|---|---|---|
| 1 | Fidelity and save architecture | Professional editors preserve complex files across repeated edits. [Foxit advanced editing](https://www.foxit.com/pdf-editor/advanced-editing/), [Nitro PDF Pro](https://www.gonitro.com/user-guide/mac/article/introduction) | Incremental saves where possible, a public adversarial corpus, cross-viewer round trips, and zero silent structure or privacy loss. |
| 2 | Accessibility and standards | Acrobat repairs tags, reading order, tables, figures, and forms; Foxit covers broad compliance and preflight. [Adobe accessibility](https://helpx.adobe.com/acrobat/using/create-verify-pdf-accessibility.html), [Foxit compliance](https://help.foxit.com/csh/q/product/phantom/id/Home_Compliance_PDFA/language/en-us/version/11.2.0) | Tagged-PDF remediation, PDF/UA, validator-backed PDF/A conversion, PDF/X/E/VT preflight, and accessible form workflows. |
| 3 | Trusted signatures and agreements | E-sign leaders provide routing, identity, evidence, templates, reminders, APIs, and qualified-signature options. [DocuSign features](https://www.docusign.com/products/electronic-signature/features), [Acrobat Sign API](https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/) | Finish local certificate trust first, then add optional recipient workflows, evidence records, webhooks, and embedded signing. |
| 4 | Release trust and platforms | Category leaders ship maintained desktop, mobile, and web products. [iLovePDF features](https://www.ilovepdf.com/features), [PDFgear](https://www.pdfgear.com/) | Reproducible signed Windows releases, updates and rollback, macOS next, then mobile or a strong installable web experience. |
| 5 | Collaboration and automation | Leaders support shared review, DMS/cloud integrations, APIs, and chained workflows. [Adobe Acrobat](https://www.adobe.com/acrobat/features.html), [iLovePDF Business](https://www.ilovepdf.com/business) | Shared reviews, versions, approvals, optional connectors, batch workflows, CLI, REST API, SDK, and webhooks. |
| 6 | Enterprise trust | Buyers expect SSO, SCIM, RBAC, audit logs, policy control, managed deployment, DPA/SLA, and independent assurance. [Smallpdf Trust Center](https://smallpdf.com/trust-center), [DocuSign certifications](https://www.docusign.com/trust/compliance/certifications) | Admin and compliance foundations after the core file-safety gate passes. |
| 7 | Action-oriented local AI | AI leaders can execute document tasks, not only chat. [Adobe smart assistance](https://helpx.adobe.com/acrobat/using/get-smart-assistance-pdf-tools.html), [Nitro PDF Pro 26](https://www.gonitro.com/release-hub/nitro-pdf-pro-26) | Local plan, preview, diff, apply, and undo; cited multi-document answers; PII detection; form/table extraction; layout-preserving translation. |
| 8 | Global product | Competitors localize the interface and support many OCR/translation languages. [iLovePDF press](https://www.ilovepdf.com/press) | Localized UI and support, proven RTL/CJK editing, locale-aware forms and signatures, and language-specific acquisition pages. |

## Recommended sequence

1. Commit and review the four stop-ship fixes with the new regression fixtures.
2. Build a tracked golden corpus and make it a mandatory CI release gate.
3. Publish one signed, versioned Windows release with a working download path.
4. Remove unsupported claims and publish complete trust, security, legal, and operator information.
5. Fix live canonicals, app `noindex`/404 behavior, headers, internal links, and conversion tracking.
6. Improve accessibility, resource limits, permissions, and signature trust.
7. Publish the fidelity/privacy benchmark as the product's proof and acquisition asset.
8. Expand into standards, workflows, platforms, and enterprise only after the safety gate stays green.

## Verification log

| Check | Result |
|---|---|
| Stop-ship working tree `npm test` | 297/297 pass across 28 files |
| Main typecheck and production build | Pass |
| Main `npm audit --json` | 0 advisories |
| `cargo test` | Compiles and passes; 0 Rust tests |
| Branch synchronization | Local `main` and `origin/main` both resolve to `da01514` |
| Browser workflow | Blank PDF edited; anchor fallback downloaded a copy and retained Unsaved edits plus Discard |
| Encryption regression | Owner-decrypt, edit, re-encrypt reopens with user and owner passwords; direct encrypted pdf-lib mutation rejects |
| Redaction regression | Nested Form-XObject image removed; forced nested removal failure aborts; Poppler render verified |
| Page-delete regression | Deleted text absent from all decoded streams; surviving page reopens and renders in Poppler |
| Installer trust | Unsigned or test-signed/UnknownError; all artifacts stale |
| Live sitemap | 23 URLs; canonical, links, metadata, content, and schema checked |
| Security headers | Both origins 25/100; six baseline headers missing |
| Finding verifier | 35 raw, 35 verified, 0 dropped |

## Unknowns requiring access or additional tooling

- Search Console, Bing Webmaster, CrUX, Plausible goals, activation, retention, and purchase data
- private GitHub settings, Actions history, branch protection, and private release state
- Rust dependency advisories because `cargo-audit` is not installed
- production signing identity, payment provider, licensing service, support commitments, and executed legal agreements
- a representative licensed PDF corpus and independent accessibility/security review

The re-audit ledger is in `AUDIT-FINDINGS.json`. Execution order and exit criteria are in `ACTION-PLAN.md`.

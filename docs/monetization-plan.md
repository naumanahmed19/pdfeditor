# PickPDF — Monetization & Go-to-Market Plan

_Working document. Last updated: 2026-07-08._

The plan for turning PickPDF (local-first PDF editor) into a revenue-generating
product without betraying its core promise: **fast, private, on-device, no
subscription for individuals.**

---

## 1. Positioning (the wedge)

PickPDF is not "a cheaper PDF editor." It's **the PDF editor you're _allowed_ to
use with privileged data** — because nothing leaves your device. That reframes it
from a $0 commodity into a compliance/trust tool.

**Core selling points, ranked by willingness-to-pay:**

1. **Privacy by architecture** — nothing uploaded, works offline. A compliance
   guarantee, not a feature. (Legal, finance, healthcare, gov.)
2. **Real redaction** that removes + flattens on save — a liability feature.
3. **True in-place text editing** — the thing free tools fake with whiteout.
4. **On-device AI** — summarize/translate without shipping the doc to a server.
5. **One app, every tool** — no per-operation paywall (vs iLovePDF/Smallpdf).
6. **Pay once, own it** — anti-subscription is itself a marketing hook.

---

## 2. Pricing & monetization model

**Decided:** Free web stays fully featured (funnel + brand). Pro differentiates on
**native desktop advantages, not feature locks.** Money comes from **Team + future
Sign**, not from gating individuals.

| Tier | Price | Model | What it is |
|---|---|---|---|
| **Free** | $0 | forever, no account | The complete editor, in the browser. Every tool. |
| **Pro** | ~$49 (revisit $59) | **one-time, perpetual, 1 user** | Same workbench as a native Windows app: disk save, offline, batch, large files, file associations. |
| **Team** | ~$39 / seat | **annual per-seat** (business plan) | Central seat management, MSI/MSIX deployment, on-prem rights, invoice/PO billing, priority support, signed DPA. |

**"No subscription" is an _individual_ promise** (Free + Pro). Team's annual fee is
a **business licensing & support plan**, not a consumer subscription. Copy on the
site is scoped accordingly so the two never contradict.

**Open pricing decisions:**
- [ ] Final Pro price — $49 vs $59 (Adobe is $240/yr; there's headroom).
- [ ] Do Team seats keep working (perpetual) on non-renewal, or hard-lock? Affects
      whether "we're not Adobe" holds for Team too.

### How we compare (mid-2026 list prices)

| Product | Price | Model | Files leave device? |
|---|---|---|---|
| **PickPDF Pro** | **$49 once** | **perpetual** | **No** |
| iLovePDF Premium | ~$48/yr | subscription | Yes (cloud) |
| Smallpdf Pro | ~$108–180/yr | subscription | Yes (cloud) |
| PDF Expert | $79.99/yr or $199.99 lifetime (Mac only) | sub / one-time | Partly |
| Adobe Acrobat Pro | ~$240/yr | subscription | Yes (cloud) |
| Nitro | ~$250–270 (3-yr, killing perpetual end-2026) | "one-time" | Yes |

Break-even pitch: **"$49 once, not $240 every year — and your files never leave
your machine."** Over 3 years, Adobe costs $720 vs our $49.

### Competing with free (PDFgear etc.)

Don't fight free on price — win where "VC-funded free" is structurally weak:

- **On-device AI** — PDFgear's AI _uploads files to servers_; ours doesn't. Decisive
  for privacy-sensitive users.
- **No telemetry** — PDFgear collects usage data; we collect nothing.
- **Trust/longevity** — free tools funded by investors must monetize you _later_
  (ads, cloud upsells, sale of user base). Paid = aligned incentives.
- **Real redaction + compliance**, and **Team/B2B** (free tools can't be procured,
  can't offer a DPA/support/deployment).

Strategy: don't try to convert casual users (they'll never pay anyone). Win the two
segments free _can't serve_ — **privacy-critical individuals** and **teams/regulated
orgs**.

---

## 3. Product surfaces & architecture

Three distinct surfaces, two web projects + the existing app:

| Project | Stack | Domain | Purpose |
|---|---|---|---|
| **web** | full-stack React (see §4) | `pickpdf.app` (apex) + `/account` | Marketing/SEO **+** billing dashboard |
| **app** | Vite + React (current) | `open.pickpdf.app` | The PDF editor (WASM/PDFium) |
| **desktop** | Tauri (current) | GitHub Releases / MS Store | Native Windows app |
| Billing infra | Merchant of Record (see §5) | — | Payments, tax, licenses, portal |

The editor stays its own project (specialized WASM + Tauri). Marketing + billing
live together in one full-stack framework (shared auth, brand, domain).

### Domain / URL strategy

- `pickpdf.app/` → **marketing landing** (this is the SEO + first-impression page).
- `open.pickpdf.app/` → **the browser editor** (matches the "Open in browser" CTA;
  avoids the `app.pickpdf.app` double-"app" stutter).
- `pickpdf.app/account` (or `account.pickpdf.app`) → **billing dashboard**.
- Desktop download → GitHub Releases / Microsoft Store.
- `pickpdf.net` → **buy defensively (~$10), 301-redirect to `.app`.** Never host
  content on a second domain (splits SEO authority).

**Open:** migrating the live app off the apex requires 301 redirects for existing
deep links.

---

## 4. Framework decision (marketing + billing "web" project)

The current app is a **client-rendered Vite + React SPA** — good for the tool, but
**wrong for SEO and for a billing dashboard**. We need a full-stack framework that
does SSG (marketing) + SSR/protected routes + server functions (billing webhooks).

**Astro is ruled out** now (content-first; fights a real auth dashboard).

**Choose one:**
- **TanStack Start** — stays in our Vite/Bun/Tailwind world, reuse shadcn 1:1,
  fully capable. Younger ecosystem for auth/billing patterns.
- **Next.js** — deepest ecosystem for auth (Auth.js) + payment SDKs + billing
  examples; safest for a money app. Bigger departure from current Vite setup.

**DECIDED: TanStack Start** — stays in Vite/React/Bun/Tailwind, reuse shadcn 1:1,
SSR/SSG + server functions cover SEO pages + billing dashboard + webhooks.

### Recommended stack (web project)

| Layer | Choice | Status |
|---|---|---|
| Framework | **TanStack Start** (SSR/SSG + server fns) | ✅ **decided** |
| Runtime / PM | **Bun** | (current) |
| Language | **TypeScript** | (current) |
| Styling | **Tailwind CSS** + shared tokens | (current) |
| UI | **base-ui + cva + tailwind-merge + lucide-react** | reuse from app |
| Content | **MDX** (Vite plugin) | recommended |
| Auth | **Better Auth** (framework-agnostic, self-hosted) | recommended |
| **Database** | **Neon** (serverless Postgres) | ✅ **decided** |
| ORM | **Drizzle** | recommended |
| Billing | **Lemon Squeezy** (MoR) | ✅ **decided** |
| Email | **Resend** (team invites; receipts via MoR) | recommended |
| Analytics | **Plausible** (cookieless, on-brand) | recommended |
| Errors | **Sentry** | recommended |
| Hosting | **Vercel** (apex) | recommended |

**MoR keeps the DB thin** — Neon stores only: users + sessions (Better Auth), teams
+ seat assignments, and a mapping table (`user/team ↔ MoR customer / subscription /
license IDs`). No cards, prices, invoices, or tax data — those live with the MoR.

---

## 5. Billing approach

**Do NOT hand-build subscriptions, invoices, tax/VAT, or license keys.** Use a
**Merchant of Record (MoR)** so global sales-tax compliance is _their_ legal
liability, not ours.

- **Lemon Squeezy** (a Stripe company) or **Paddle** — MoR: handle global tax/VAT,
  invoices, subscriptions, dunning, fraud, **+ built-in license keys** (perfect for
  Pro perpetual license + desktop activation) and a hosted customer portal.
- **Stripe** — cheaper fees, more control, but _we_ become the merchant and own tax
  compliance. Revisit later at higher volume to reclaim fee margin.

With a MoR, our **custom panel shrinks** to the PickPDF-specific part: **team seat
assignment/reassignment + license overview.** Checkout, invoices, payment methods,
cancellations lean on the provider's hosted portal.

- [ ] **DECISION: Lemon Squeezy / Paddle (recommended) vs Stripe.**

Maps onto tiers: Pro = one-time license key; Team = per-seat subscription; future
Sign = subscription.

---

## 6. SEO content plan (the free funnel)

This is how we acquire users at near-zero ad spend (the PDFgear/iLovePDF playbook).
Built on the marketing framework (§4).

- **Tool pages** (highest volume): `/edit-pdf`, `/redact-pdf`, `/merge-pdf`,
  `/ocr-pdf`, `/split-pdf`, `/compress-pdf` — each ranks for "\<task\> online" and
  CTAs into the app.
- **Comparison pages** (high intent): `/vs-adobe`, `/vs-smallpdf`, `/vs-pdfgear` —
  ammo already gathered in §2.
- **Guides / blog**: `/guides/how-to-redact-a-pdf`, etc.
- **Pricing** (`/pricing`) and **For Teams** (`/for-teams`) — port from the current
  `public/download/index.html`, which becomes the design reference + homepage.

---

## 7. Future product: PickPDF Sign

E-signature (DocuSign-style) is a **separate product with a separate promise** —
inherently networked, so it needs cloud. Keep it from contaminating the editor's
"nothing leaves your device" claim.

- Scope editor's claim precisely: _"Your editing never leaves your device."_
- Give Sign its own promise: **E2E / zero-knowledge encryption**, **self-host /
  on-prem option** (killer for regulated buyers), no data harvesting.
- Sub-brand model: **PickPDF** (editor) + **PickPDF Sign** (signing) under one trust
  umbrella, each stating its own architectural truth.
- **Revenue upside:** Sign is _legitimately_ a recurring service — gives us
  subscription revenue that doesn't contradict the editor's one-time promise.

---

## 8. Phased roadmap

### Phase 0 — Decisions & prerequisites
- [ ] Confirm framework (TanStack Start vs Next.js).
- [ ] Confirm MoR (Lemon Squeezy / Paddle vs Stripe).
- [ ] Confirm final Pro price and Team non-renewal behavior.
- [ ] **Audit: do Pro's native perks actually exist in the Tauri app?** (disk
      save, file associations, batch, large-file handling). The whole individual
      paid pitch depends on these shipping.

### Phase 1 — Web project + marketing site
- [ ] Scaffold the `web` project in the chosen framework (Bun + Tailwind).
- [ ] Extract shared design tokens from the current landing page.
- [ ] Port `public/download/index.html` → homepage + layout/components.
- [ ] Ship `/pricing` and `/for-teams` (already built in the current HTML).
- [ ] Set up domains: apex → marketing, `open.pickpdf.app` → app, redirects.
- [ ] Update "Open in browser" links → `https://open.pickpdf.app/`.
- [ ] Buy + redirect `pickpdf.net`.

### Phase 2 — SEO surface
- [ ] Tool pages (`/edit-pdf`, `/redact-pdf`, `/merge-pdf`, `/ocr-pdf`, …).
- [ ] Comparison pages (`/vs-adobe`, `/vs-smallpdf`, `/vs-pdfgear`).
- [ ] Guides/blog with MDX; sitemap + structured data.

### Phase 3 — Billing & licensing
- [ ] Integrate MoR: products for Pro (one-time + license key) and Team (per-seat).
- [ ] Desktop license activation/validation against the MoR license API.
- [ ] Feature-flag Pro native perks behind a valid license.
- [ ] Build the thin custom dashboard: `/account` — license overview + **team seat
      management** (assign/reassign).
- [ ] Wire checkout webhooks (fulfillment, seat provisioning).

### Phase 4 — Team / B2B motion
- [ ] "For Teams" sales path: contact form, DPA template, invoice/PO flow.
- [ ] MSI/MSIX silent-deployment docs; on-prem/air-gapped install rights.

### Phase 5 — PickPDF Sign (later)
- [ ] Separate product; E2E + self-host architecture; recurring pricing.

---

## 9. Open decisions (consolidated)

- [x] Framework: **TanStack Start** ✅
- [x] MoR: **Lemon Squeezy** ✅
- [x] Database: **Neon** ✅
- [ ] Pro price: **$49** vs **$59**.
- [ ] Team non-renewal: **perpetual last version** vs **hard-lock**.
- [ ] Migrate live app to `open.` subdomain now, or keep at apex interim?
- [ ] Web project location: **separate repo/folder** vs **monorepo (apps/web + apps/editor)**.

## 10. Risks / things to verify

- **Native Pro perks must actually exist** — the individual paid pitch is 100% built
  on desktop-only advantages. Audit the Tauri app before advertising them.
- **Individual Pro conversion will be soft** (web does everything free). Real revenue
  is **Team + Sign**; the trust block ("why pay") is there to lift individual
  conversion but shouldn't be the primary bet.
- **Design drift** between the two web projects — mitigate with shared tokens/components.
- **App migration** off the apex needs 301s to avoid breaking bookmarks/SEO.

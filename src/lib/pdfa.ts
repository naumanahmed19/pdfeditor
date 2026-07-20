import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
} from "pdf-lib";
import type { PDFContext } from "pdf-lib";

/**
 * PDF/A-2b-oriented preflight. This is a dict-level heuristic check with
 * pdf-lib — NOT a certified validator (veraPDF-class validation needs full
 * content-stream, color-space and XMP-schema analysis). The UI must present
 * results as a preflight, never as certification.
 *
 * Deliberately NOT checked (out of scope for this baseline):
 * - Document Info vs XMP metadata consistency, XMP schema conformance.
 * - LZW / crypt filters inside content streams.
 * - Device-dependent color spaces vs OutputIntent matching.
 * - Content-stream operators (BX/EX, undefined operators, rendering intents).
 * - Font glyph coverage / ToUnicode completeness (2u territory).
 */

export type PdfaSeverity = "error" | "warning" | "info";

export interface PdfaFinding {
  /** Stable rule id, e.g. "fonts-embedded". */
  id: string;
  /** Short rule title for the checklist row. */
  title: string;
  /** Severity the finding carries WHEN it fails. */
  severity: PdfaSeverity;
  passed: boolean;
  /** Human explanation of the result (pass or fail). */
  detail: string;
  /** Offending item names/locations, when cheap to collect. */
  items?: string[];
}

export interface PdfaReport {
  findings: PdfaFinding[];
  errors: number;
  warnings: number;
  infos: number;
  /** True when no error-severity rule failed. */
  ready: boolean;
  verdict: string;
  /** Whether this is PickPDF's heuristic check or an authoritative veraPDF run. */
  source: "preflight" | "verapdf";
  profileName?: string;
  validatorVersion?: string;
}

/* ---------------- dict-walking helpers ---------------- */

function resolve(ctx: PDFContext, v: PDFObject | undefined): PDFObject | undefined {
  if (!v) return undefined;
  return v instanceof PDFRef ? ctx.lookup(v) : v;
}

function dictAt(ctx: PDFContext, container: PDFDict | undefined, key: string): PDFDict | undefined {
  const v = resolve(ctx, container?.get(PDFName.of(key)));
  if (v instanceof PDFDict) return v;
  // Streams (e.g. XObjects) carry their own dict.
  if (v instanceof PDFStream) return v.dict;
  return undefined;
}

function arrayAt(ctx: PDFContext, container: PDFDict | undefined, key: string): PDFArray | undefined {
  const v = resolve(ctx, container?.get(PDFName.of(key)));
  return v instanceof PDFArray ? v : undefined;
}

function nameAt(ctx: PDFContext, container: PDFDict | undefined, key: string): string | undefined {
  const v = resolve(ctx, container?.get(PDFName.of(key)));
  return v instanceof PDFName ? v.decodeText() : undefined;
}

function numberAt(ctx: PDFContext, container: PDFDict | undefined, key: string): number | undefined {
  const v = resolve(ctx, container?.get(PDFName.of(key)));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/** Strip the ABCDEF+ subset prefix so reports show the real face name. */
function baseFontName(ctx: PDFContext, fontDict: PDFDict): string {
  const raw = nameAt(ctx, fontDict, "BaseFont") ?? "(unnamed font)";
  return raw.replace(/^[A-Z]{6}\+/, "");
}

/**
 * Visit the page's resource dict plus the resources of its form XObjects,
 * one level deep. Deeper nesting is rare and not worth unbounded recursion.
 */
function visitResources(
  ctx: PDFContext,
  resources: PDFDict | undefined,
  visit: (resources: PDFDict) => void,
  depth = 1,
): void {
  if (!resources) return;
  visit(resources);
  if (depth <= 0) return;
  const xobjects = dictAt(ctx, resources, "XObject");
  if (!xobjects) return;
  for (const [, value] of xobjects.entries()) {
    const obj = resolve(ctx, value);
    if (!(obj instanceof PDFStream)) continue;
    if (nameAt(ctx, obj.dict, "Subtype") !== "Form") continue;
    visitResources(ctx, dictAt(ctx, obj.dict, "Resources"), visit, depth - 1);
  }
}

/** All annotation dicts of a page. */
function pageAnnots(ctx: PDFContext, pageDict: PDFDict): PDFDict[] {
  const arr = arrayAt(ctx, pageDict, "Annots");
  if (!arr) return [];
  const out: PDFDict[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const a = resolve(ctx, arr.get(i));
    if (a instanceof PDFDict) out.push(a);
  }
  return out;
}

/* ---------------- rule checks ---------------- */

interface WalkState {
  unembeddedFonts: Set<string>;
  transparency: Set<string>;
  aaLocations: Set<string>;
  forbiddenAnnots: Set<string>;
  annotsMissingAp: Set<string>;
  fileAttachmentPages: Set<number>;
}

function checkFonts(ctx: PDFContext, resources: PDFDict, state: WalkState): void {
  const fonts = dictAt(ctx, resources, "Font");
  if (!fonts) return;
  for (const [, value] of fonts.entries()) {
    const font = resolve(ctx, value);
    if (!(font instanceof PDFDict)) continue;
    const subtype = nameAt(ctx, font, "Subtype");
    // Type3 glyphs are content streams inside the file — nothing to embed.
    if (subtype === "Type3") continue;
    // Composite fonts keep the descriptor on the descendant CIDFont.
    let target: PDFDict = font;
    if (subtype === "Type0") {
      const descendants = arrayAt(ctx, font, "DescendantFonts");
      const first = descendants && descendants.size() > 0 ? resolve(ctx, descendants.get(0)) : undefined;
      if (first instanceof PDFDict) target = first;
    }
    const descriptor = dictAt(ctx, target, "FontDescriptor");
    const embedded =
      !!descriptor &&
      (descriptor.has(PDFName.of("FontFile")) ||
        descriptor.has(PDFName.of("FontFile2")) ||
        descriptor.has(PDFName.of("FontFile3")));
    if (!embedded) state.unembeddedFonts.add(baseFontName(ctx, font));
  }
}

function checkTransparency(ctx: PDFContext, resources: PDFDict, pageNo: number, state: WalkState): void {
  const extg = dictAt(ctx, resources, "ExtGState");
  if (extg) {
    for (const [, value] of extg.entries()) {
      const gs = resolve(ctx, value);
      if (!(gs instanceof PDFDict)) continue;
      const strokeAlpha = numberAt(ctx, gs, "CA");
      const fillAlpha = numberAt(ctx, gs, "ca");
      if (strokeAlpha !== undefined && strokeAlpha < 1) {
        state.transparency.add(`page ${pageNo}: stroke alpha ${strokeAlpha}`);
      }
      if (fillAlpha !== undefined && fillAlpha < 1) {
        state.transparency.add(`page ${pageNo}: fill alpha ${fillAlpha}`);
      }
      const smask = resolve(ctx, gs.get(PDFName.of("SMask")));
      if (smask && !(smask instanceof PDFName && smask.decodeText() === "None")) {
        state.transparency.add(`page ${pageNo}: soft mask in graphics state`);
      }
      const bm = resolve(ctx, gs.get(PDFName.of("BM")));
      const bmName =
        bm instanceof PDFName
          ? bm.decodeText()
          : bm instanceof PDFArray && bm.size() > 0 && bm.get(0) instanceof PDFName
            ? (bm.get(0) as PDFName).decodeText()
            : undefined;
      if (bmName && bmName !== "Normal" && bmName !== "Compatible") {
        state.transparency.add(`page ${pageNo}: blend mode /${bmName}`);
      }
    }
  }
  const xobjects = dictAt(ctx, resources, "XObject");
  if (xobjects) {
    for (const [, value] of xobjects.entries()) {
      const obj = resolve(ctx, value);
      if (!(obj instanceof PDFStream)) continue;
      if (nameAt(ctx, obj.dict, "Subtype") !== "Image") continue;
      if (obj.dict.has(PDFName.of("SMask"))) {
        state.transparency.add(`page ${pageNo}: image with soft mask`);
      }
    }
  }
}

const FORBIDDEN_ANNOT_SUBTYPES = new Set(["Sound", "Movie", "Screen", "3D"]);
// Popup annotations are pure viewer chrome — PDF/A does not require an /AP.
const AP_EXEMPT_SUBTYPES = new Set(["Popup", "Link"]);

function checkAnnotations(ctx: PDFContext, pageDict: PDFDict, pageNo: number, state: WalkState): void {
  for (const annot of pageAnnots(ctx, pageDict)) {
    const subtype = nameAt(ctx, annot, "Subtype") ?? "(unknown)";
    if (FORBIDDEN_ANNOT_SUBTYPES.has(subtype)) {
      state.forbiddenAnnots.add(`page ${pageNo}: /${subtype}`);
    }
    if (subtype === "FileAttachment") state.fileAttachmentPages.add(pageNo);
    if (annot.has(PDFName.of("AA"))) state.aaLocations.add(`page ${pageNo}: /${subtype} annotation`);
    if (!AP_EXEMPT_SUBTYPES.has(subtype) && !annot.has(PDFName.of("AP"))) {
      state.annotsMissingAp.add(`page ${pageNo}: /${subtype}`);
    }
  }
}

/* ---------------- report assembly ---------------- */

function finding(
  id: string,
  title: string,
  severity: PdfaSeverity,
  passed: boolean,
  detail: string,
  items?: string[],
): PdfaFinding {
  const sorted = items && items.length ? [...items].sort() : undefined;
  return { id, title, severity, passed, detail, ...(sorted ? { items: sorted } : {}) };
}

const MAX_ITEMS = 25;

function capped(items: Set<string>): string[] {
  const arr = [...items];
  if (arr.length <= MAX_ITEMS) return arr;
  return [...arr.slice(0, MAX_ITEMS), `… and ${arr.length - MAX_ITEMS} more`];
}

export async function checkPdfA(bytes: Uint8Array): Promise<PdfaReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const catalog: PDFDict = doc.catalog;
  const findings: PdfaFinding[] = [];

  // -- Encryption ------------------------------------------------------------
  const encrypted = doc.isEncrypted || !!ctx.trailerInfo.Encrypt;
  findings.push(
    finding(
      "encryption",
      "No encryption",
      "error",
      !encrypted,
      encrypted
        ? "The document has an /Encrypt dictionary. PDF/A files must not be encrypted — remove password protection first."
        : "The document is not encrypted.",
    ),
  );

  // -- Per-page walks (fonts, transparency, annotations, page /AA) -----------
  const state: WalkState = {
    unembeddedFonts: new Set(),
    transparency: new Set(),
    aaLocations: new Set(),
    forbiddenAnnots: new Set(),
    annotsMissingAp: new Set(),
    fileAttachmentPages: new Set(),
  };

  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const pageNo = i + 1;
    const pageDict = page.node;
    const resources = resolve(ctx, pageDict.get(PDFName.of("Resources")));
    visitResources(ctx, resources instanceof PDFDict ? resources : undefined, (res) => {
      checkFonts(ctx, res, state);
      checkTransparency(ctx, res, pageNo, state);
    });
    checkAnnotations(ctx, pageDict, pageNo, state);
    if (pageDict.has(PDFName.of("AA"))) state.aaLocations.add(`page ${pageNo}: page actions`);
  });

  findings.push(
    finding(
      "fonts-embedded",
      "All fonts embedded",
      "error",
      state.unembeddedFonts.size === 0,
      state.unembeddedFonts.size
        ? `${state.unembeddedFonts.size} font(s) are not embedded. PDF/A requires every font program inside the file so it renders identically forever.`
        : "Every font referenced by the pages carries an embedded font program.",
      state.unembeddedFonts.size ? capped(state.unembeddedFonts) : undefined,
    ),
  );

  findings.push(
    finding(
      "transparency",
      "Transparency usage",
      "info",
      state.transparency.size === 0,
      state.transparency.size
        ? "Transparency (alpha, soft masks or blend modes) is in use. PDF/A-2 allows it, but blending must be resolvable against the OutputIntent color space — verify the output looks right in an archival viewer."
        : "No transparency (alpha, soft masks, non-Normal blend modes) was detected in page resources.",
      state.transparency.size ? capped(state.transparency) : undefined,
    ),
  );

  // -- JavaScript / actions ---------------------------------------------------
  const names = dictAt(ctx, catalog, "Names");
  const jsTree = names ? dictAt(ctx, names, "JavaScript") : undefined;
  if (jsTree) state.aaLocations.add("document: /Names /JavaScript name tree");
  if (catalog.has(PDFName.of("AA"))) state.aaLocations.add("document: catalog additional actions");
  const openAction = resolve(ctx, catalog.get(PDFName.of("OpenAction")));
  if (openAction instanceof PDFDict && nameAt(ctx, openAction, "S") === "JavaScript") {
    state.aaLocations.add("document: /OpenAction runs JavaScript");
  }
  findings.push(
    finding(
      "no-javascript",
      "No JavaScript or auto-actions",
      "error",
      state.aaLocations.size === 0,
      state.aaLocations.size
        ? "Document-level JavaScript or additional-action (/AA) entries were found. PDF/A forbids executable content."
        : "No JavaScript name tree, /AA entries or JavaScript open actions were found.",
      state.aaLocations.size ? capped(state.aaLocations) : undefined,
    ),
  );

  // -- Embedded files ----------------------------------------------------------
  const embeddedFilesTree = names ? dictAt(ctx, names, "EmbeddedFiles") : undefined;
  const embeddedItems = new Set<string>();
  if (embeddedFilesTree) embeddedItems.add("document: /Names /EmbeddedFiles tree");
  for (const p of state.fileAttachmentPages) embeddedItems.add(`page ${p}: FileAttachment annotation`);
  findings.push(
    finding(
      "no-embedded-files",
      "No embedded files",
      "error",
      embeddedItems.size === 0,
      embeddedItems.size
        ? "Embedded file attachments were found. PDF/A-2b forbids them (PDF/A-2u and PDF/A-3 permit attachments — target one of those instead, or remove the attachments)."
        : "No embedded file streams or FileAttachment annotations.",
      embeddedItems.size ? capped(embeddedItems) : undefined,
    ),
  );

  // -- XFA forms ---------------------------------------------------------------
  const acroForm = dictAt(ctx, catalog, "AcroForm");
  const hasXfa = !!acroForm && acroForm.has(PDFName.of("XFA"));
  findings.push(
    finding(
      "no-xfa",
      "No XFA forms",
      "error",
      !hasXfa,
      hasXfa
        ? "The AcroForm dictionary carries an /XFA entry. XML Forms Architecture is forbidden in PDF/A — flatten or convert the form."
        : "No XFA form data.",
    ),
  );

  // -- XMP metadata --------------------------------------------------------------
  const metadata = resolve(ctx, catalog.get(PDFName.of("Metadata")));
  const hasXmp = metadata instanceof PDFStream;
  findings.push(
    finding(
      "xmp-metadata",
      "XMP metadata stream",
      "error",
      hasXmp,
      hasXmp
        ? "The catalog references an XMP metadata stream. (Whether it declares a pdfaid conformance level is not verified here.)"
        : "No /Metadata XMP stream in the catalog. PDF/A requires XMP metadata including a pdfaid:part / pdfaid:conformance declaration.",
    ),
  );

  // -- OutputIntent -----------------------------------------------------------------
  const outputIntents = arrayAt(ctx, catalog, "OutputIntents");
  const hasIntent = !!outputIntents && outputIntents.size() > 0;
  findings.push(
    finding(
      "output-intent",
      "OutputIntent (ICC profile)",
      "error",
      hasIntent,
      hasIntent
        ? "The catalog declares at least one OutputIntent. (The embedded ICC profile itself is not validated here.)"
        : "No /OutputIntents entry. PDF/A requires an OutputIntent with an embedded ICC profile so colors are device-independent.",
    ),
  );

  // -- Forbidden annotation subtypes ---------------------------------------------------
  findings.push(
    finding(
      "annotation-subtypes",
      "No forbidden annotation types",
      "error",
      state.forbiddenAnnots.size === 0,
      state.forbiddenAnnots.size
        ? "Sound, Movie, Screen or 3D annotations were found — multimedia annotations are forbidden in PDF/A."
        : "No Sound, Movie, Screen or 3D annotations.",
      state.forbiddenAnnots.size ? capped(state.forbiddenAnnots) : undefined,
    ),
  );

  findings.push(
    finding(
      "annotation-appearances",
      "Annotations have appearances",
      "warning",
      state.annotsMissingAp.size === 0,
      state.annotsMissingAp.size
        ? `${state.annotsMissingAp.size} annotation(s) have no /AP appearance stream, so archival viewers may render them differently (Popup and Link annotations are exempt).`
        : "Every visible annotation carries an /AP appearance stream (Popup and Link annotations are exempt).",
      state.annotsMissingAp.size ? capped(state.annotsMissingAp) : undefined,
    ),
  );

  // -- verdict ------------------------------------------------------------------------
  const errors = findings.filter((f) => !f.passed && f.severity === "error").length;
  const warnings = findings.filter((f) => !f.passed && f.severity === "warning").length;
  const infos = findings.filter((f) => !f.passed && f.severity === "info").length;
  const ready = errors === 0;
  const verdict = ready
    ? warnings + infos > 0
      ? `No blocking issues found for PDF/A-2b — ${warnings + infos} item(s) to review.`
      : "No blocking issues found for PDF/A-2b."
    : `Not PDF/A-ready: ${errors} error${errors === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`;

  return { findings, errors, warnings, infos, ready, verdict, source: "preflight" };
}

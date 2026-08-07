import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { PdfDoc } from "./lib/pdf";
import { toast } from "sonner";
import type {
  Annotation,
  AnnotationMap,
  AppSettings,
  ExistingFieldOp,
  FolderNode,
  FontFamilyKind,
  MarkSymbol,
  SavedSignature,
  Screen,
  SearchMatch,
  SearchOptions,
  ToolKind,
} from "./types";
import {
  loadPdf,
  searchDocumentAdvanced,
  extractAllText,
  setPasswordPrompter,
  hasRasterImages,
} from "./lib/pdf";
import { OCR_LANGUAGE_OPTIONS, normalizeOcrLanguage } from "./lib/ocrLanguages";
import {
  DEFAULT_SEARCH_OPTIONS,
  buildSearchIndex,
  compileSearch,
  findInIndex,
  replaceHitInText,
  snippetAround,
} from "./lib/search";
import { pickFolder, readNode } from "./lib/folder";
import { addOcrTextLayer, bakeAnnotations } from "./lib/pdftools";
import type {
  FontInfo,
  LineStyle as PdfiumLineStyle,
  Matrix as PdfiumMatrix,
  ObjectStyle as PdfiumObjectStyle,
  PageObject,
  ReflowSpec,
  TextObject,
  TextRunEdit,
} from "./lib/pdfium";
import { DEFAULT_SETTINGS } from "./lib/ai";
import {
  recipeAfterOwnerUnlock,
  recipeForOpenedDoc,
  type EncryptRecipe,
} from "./lib/reprotect";
import { isHandheldDevice } from "./lib/device";
import { downloadBytes, uid } from "./lib/utils";
import {
  getStoredDoc,
  listStoredDocs,
  markDocClosed,
  persistAnnotations,
  persistDoc,
  removeStoredDocs,
  touchStoredDoc,
  MAX_PERSIST_BYTES,
  type PersistResult,
} from "./lib/persist";
import { applyAccent, type AccentId } from "./lib/accents";
import { editPdfsInBackground } from "./lib/pdfEditWorker";
import { appendPdfEdit } from "./lib/pdfEditJournal";
import type { PdfEditOperation } from "./lib/pdfEditTypes";
import { previewTextRuns } from "./lib/textRunPreview";
import { fileSourceKey, legacyBytesSourceKey } from "./lib/fileIdentity";
import {
  type DocRevision,
  bumpBytesRevision,
  bumpRevision,
  freshRevision,
  hasUnsavedByteEdits,
  hasUnsavedChanges,
  markSaved,
} from "./lib/revision";

const SETTINGS_KEY = "pickpdf-settings";
const API_KEY_SESSION_KEY = "pickpdf-api-key-session";
const SIGNATURES_KEY = "pickpdf-signatures";
const THEME_KEY = "pickpdf-theme";
const ACCENT_KEY = "pickpdf-accent";

export interface PendingStamp {
  dataUrl: string;
  aspect: number; // height / width
}

/** What a click with the edit-text tool opens in the inline editor. */
export type EditTextScope = "line" | "paragraph" | "block";

/** How a document must be re-protected when its bytes are written to disk. */
export type ProtectionRecipe =
  | EncryptRecipe
  /** PickPDF wrapper: plain inner document + AES-GCM payload behind `password`. */
  | { kind: "wrapper"; password: string };

/** Thrown by protectForDisk when the user declines writing an UNPROTECTED
 *  copy of a document that was password-protected when it was opened. Save
 *  and download catch it and abort quietly (no error toast, no fallback). */
class ProtectionDeclinedError extends Error {
  constructor() {
    super("Cancelled — the file was not written");
    this.name = "ProtectionDeclinedError";
  }
}

/** A pending in-app password prompt (rendered by PasswordModal). */
export interface PasswordRequest {
  title: string;
  message: string;
  /** Shown in destructive style, e.g. "Wrong password — try again." */
  error?: string;
}

/** A pending in-app confirmation (rendered by ConfirmModal) — replaces
 *  window.confirm so confirms use the shared dialog styling. */
export interface ConfirmRequest {
  title: string;
  message: string;
  /** Confirm button label, e.g. "Close anyway". Defaults to "Continue". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** "danger" renders the confirm button in destructive style. */
  tone?: "default" | "danger";
  /** Optional dropdown between message and buttons (e.g. OCR language).
   *  Changes report immediately via onChange — the request object stays
   *  inert, so cancelling never rolls a selection back. */
  select?: {
    label: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    onChange: (value: string) => void;
  };
}

/** Per-document measurement calibration: real-world units per PDF point
 *  (e.g. scale 0.5, unit "cm" means 1pt reads as 0.5 cm). */
export interface MeasureScale {
  scale: number;
  unit: string;
}

/** The document's base bytes + its parsed PDFium document at a point in history. */
interface BaseState {
  bytes: Uint8Array;
  /**
   * The live proxy for these bytes, when one is retained (open + legacy reset
   * paths that loadPdf a fresh doc). In-place content edits mutate the single
   * live `doc.pdf` directly and store bytes only (pdf undefined); undo/redo
   * reload from bytes when they cross a content boundary. Never rendered
   * directly for a content step — see undo/redo.
   */
  pdf?: PdfDoc;
}

interface OpenDoc {
  id: string;
  name: string;
  sourceKey?: string;
  /** Used to unload the least-recently-used clean document engines. */
  lastAccessed: number;
  bytes: Uint8Array;
  pdf: PdfDoc;
  annotations: AnnotationMap;
  history: AnnotationMap[];
  /**
   * Base bytes/pdf aligned index-for-index with `history`. Annotation-only
   * steps reuse the same reference (no copy, no reload); a real in-place text
   * edit pushes a new base. This unifies undo across overlay edits and true
   * content-stream edits on one timeline.
   */
  bytesHistory: BaseState[];
  historyIndex: number;
  currentPage: number;
  /** AcroForm field values entered by the user, keyed by field name. */
  formValues: Record<string, unknown>;
  /** Measurement calibration (real-world units per PDF point). Null/absent =
   *  uncalibrated: measurements read in raw PDF points. */
  measureScale?: MeasureScale | null;
  /** Pending move/rename/delete edits to existing AcroForm fields. */
  fieldOps: Record<string, ExistingFieldOp>;
  /** Exact editable state at the last successful save/open. */
  savedState: {
    bytes: Uint8Array;
    annotations: AnnotationMap;
    formValues: Record<string, unknown>;
    fieldOps: Record<string, ExistingFieldOp>;
  };
  /**
   * Dirty-tracking revision state (see src/lib/revision.ts): every mutation —
   * overlay or byte-level — bumps it; a successful save records what was
   * written. THE source of truth for "has unsaved changes".
   */
  rev: DocRevision;
}

function formValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function pageForFormValue(d: OpenDoc, fieldName: string): number {
  for (const [page, list] of Object.entries(d.annotations)) {
    if (
      list.some((ann) => ann.kind === "formfield" && ann.fieldName === fieldName)
    ) {
      return Number(page);
    }
  }
  const op = Object.values(d.fieldOps).find((x) => x.fieldName === fieldName);
  return op?.pageIndex ?? d.currentPage;
}

function searchTextSources(
  d: OpenDoc,
  query: string,
  options: SearchOptions,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const addTextMatches = (
    page: number,
    source: SearchMatch["source"],
    text: string,
    idPrefix: string,
    extra: Pick<SearchMatch, "annotationId" | "fieldName"> = {},
  ) => {
    if (!text) return;
    const index = buildSearchIndex([{ itemIndex: 0, text }]);
    const hits = findInIndex(index, query, options);
    if ("error" in hits) throw new Error(hits.error);
    hits.forEach((hit, ordinal) => {
      matches.push({
        id: `${idPrefix}:${ordinal}:${hit.start}:${hit.end}`,
        page,
        source,
        snippet: snippetAround(index.text, hit.start, hit.end),
        text: hit.text,
        ranges: hit.ranges,
        replaceable: true,
        start: hit.start,
        end: hit.end,
        ordinal,
        ...extra,
      });
    });
  };

  if (options.includeAnnotations) {
    for (const [pageKey, list] of Object.entries(d.annotations)) {
      const page = Number(pageKey);
      for (const ann of list) {
        if (ann.kind === "text") {
          addTextMatches(page, "annotation-text", ann.text, `ann:${ann.id}`, {
            annotationId: ann.id,
          });
        } else if (ann.kind === "note") {
          addTextMatches(page, "note-text", ann.text, `note:${ann.id}`, {
            annotationId: ann.id,
          });
        }
      }
    }
  }

  if (options.includeFormValues) {
    for (const [fieldName, value] of Object.entries(d.formValues)) {
      const text = formValueText(value);
      addTextMatches(
        pageForFormValue(d, fieldName),
        "form-value",
        text,
        `form:${fieldName}`,
        { fieldName },
      );
    }
  }

  return matches;
}

function orderedTextObjects(objs: TextObject[]): TextObject[] {
  const sorted = objs.filter((o) => o.text).sort((a, b) => b.top - a.top || a.left - b.left);
  const lines: TextObject[][] = [];
  for (const obj of sorted) {
    const line = lines[lines.length - 1];
    const h = obj.top - obj.bottom;
    if (line && Math.abs(obj.top - line[0].top) <= Math.max(2, h * 0.5)) {
      line.push(obj);
    } else {
      lines.push([obj]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.left - b.left);
  return lines.flat();
}

function planTextObjectReplacements(
  objs: TextObject[],
  query: string,
  replacement: string,
  options: SearchOptions,
  ordinals?: Set<number>,
): { edits: TextRunEdit[]; count: number; error?: string } {
  const ordered = orderedTextObjects(objs);
  const index = buildSearchIndex(
    ordered.map((obj) => ({ itemIndex: obj.index, text: obj.text })),
  );
  const hits = findInIndex(index, query, options);
  if ("error" in hits) return { edits: [], count: 0, error: hits.error };
  const compiled = compileSearch(query, options);
  if ("error" in compiled) return { edits: [], count: 0, error: compiled.error };

  const byIndex = new Map(objs.map((obj) => [obj.index, obj.text]));
  let count = 0;
  for (let ordinal = hits.length - 1; ordinal >= 0; ordinal--) {
    if (ordinals && !ordinals.has(ordinal)) continue;
    const hit = hits[ordinal];
    const ranges = hit.ranges.filter((r) => r.itemIndex != null);
    if (!ranges.length) continue;
    const nextText = compiled.replacementFor(hit, replacement);
    ranges.forEach((range, rangeIndex) => {
      const itemIndex = range.itemIndex!;
      const current = byIndex.get(itemIndex);
      if (current == null) return;
      const insert = rangeIndex === 0 ? nextText : "";
      byIndex.set(
        itemIndex,
        current.slice(0, range.start) + insert + current.slice(range.end),
      );
    });
    count += 1;
  }

  const edits = objs
    .map((obj) => ({ objectIndex: obj.index, text: byIndex.get(obj.index) ?? obj.text }))
    .filter((edit, i) => edit.text !== objs[i].text);
  return { edits, count };
}

export interface TabInfo {
  id: string;
  name: string;
  hasEdits: boolean;
}

export interface RecentFile {
  id: string;
  name: string;
  sourceKey?: string;
  lastOpened: number;
  open: boolean;
}

interface AppStore {
  theme: "light" | "dark";
  toggleTheme: () => void;
  accent: AccentId;
  setAccent: (a: AccentId) => void;

  screen: Screen;
  setScreen: (s: Screen) => void;

  /** Open documents as tabs; all doc-scoped fields below refer to the active tab. */
  tabs: TabInfo[];
  activeTabId: string | null;
  /** True until startup has finished restoring the last active document. */
  sessionRestoring: boolean;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;

  /** Editor panes for split view. Empty = single view (uses activeTabId). */
  panes: Array<{ id: string; docId: string }>;
  activePaneId: string | null;
  /** Live pane sizes (percent) from the resizable split — so the header tabs
   *  stay aligned with the resized content panes. */
  paneSizes: number[];
  setPaneSizes: (sizes: number[]) => void;
  /** Split the current document into a new pane (VS Code style). */
  splitView: () => void;
  /** Open a document in a new pane. */
  openInPane: (docId: string) => void;
  /** Make a pane the focused (editable) one. */
  focusPane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  exitSplit: () => void;
  /** Bake + print a specific document. */
  printDoc: (docId: string) => Promise<void>;
  /** Read a specific open document by id. */
  docById: (id: string) => {
    id: string;
    name: string;
    pdf: PdfDoc;
    numPages: number;
  } | null;

  docName: string | null;
  renameDoc: (name: string) => void;
  docBytes: Uint8Array | null;
  /** Stable identity of the active document — unchanged across content edits. */
  docId: string | null;
  pdf: PdfDoc | null;
  numPages: number;
  docVersion: number;
  /** In-place content-edit revision (existing-object move/resize/delete/recolor);
   *  bump repaints the live page without a remount. */
  contentRev: number;

  openFile: (file: File, handle?: unknown) => Promise<string | null>;
  openBytes: (bytes: Uint8Array, name: string) => Promise<string | null>;
  /** Open via the File System Access picker when available (enables save-in-place). */
  requestOpen: () => Promise<void>;
  registerFileHandle: (id: string, handle: unknown) => void;
  /** True when the active tab was opened with a writable file handle. */
  activeHasHandle: boolean;
  /** Save in place when a handle exists, otherwise download a copy. */
  saveCurrent: () => Promise<void>;
  recentFiles: RecentFile[];
  /** True until the first recent-files load completes (drives sidebar skeleton). */
  recentLoading: boolean;
  openRecent: (id: string) => Promise<void>;
  removeRecent: (id: string) => Promise<void>;
  clearRecent: () => Promise<void>;
  closeDocument: () => void;

  /** Opened folder tree (PDFs only, nested folders included). */
  folderRoot: FolderNode | null;
  folderBusy: boolean;
  openFolder: () => Promise<void>;
  closeFolder: () => void;
  openTreeFile: (node: FolderNode) => Promise<void>;
  /** Bake pending annotations, then run a structural pdf-lib op on the bytes. */
  applyBytesOp: (
    op: (bytes: Uint8Array) => Promise<Uint8Array>,
    label: string,
  ) => Promise<void>;
  bakeToBytes: () => Promise<Uint8Array | null>;
  downloadCurrent: () => Promise<void>;
  printCurrent: () => Promise<void>;
  printWith: (pageIndexes: number[] | null, scale: number) => Promise<void>;

  /** In-place text editing via PDFium (replaces the whiteout+overlay hack). */
  getPageTextObjects: (pageIndex: number) => Promise<TextObject[]>;
  applyTextEdit: (
    pageIndex: number,
    objectIndex: number,
    newText: string,
  ) => Promise<void>;
  applyTextRuns: (
    pageIndex: number,
    runs: TextRunEdit[],
    style: PdfiumLineStyle,
  ) => Promise<PdfEditCommitResult>;
  applyTextReflow: (
    pageIndex: number,
    spec: ReflowSpec,
  ) => Promise<PdfEditCommitResult>;
  getTextFontInfo: (
    pageIndex: number,
    objectIndex: number,
  ) => Promise<FontInfo | null>;

  /** Object editing via PDFium: move/resize/delete existing text & images. */
  getPageObjects: (pageIndex: number) => Promise<PageObject[]>;
  applyObjectTransform: (
    pageIndex: number,
    objectIndex: number,
    m: PdfiumMatrix,
  ) => Promise<void>;
  removeObjectAt: (pageIndex: number, objectIndex: number) => Promise<void>;
  applyObjectStyle: (
    pageIndex: number,
    objectIndex: number,
    style: PdfiumObjectStyle,
  ) => Promise<void>;

  /** Number of pending redaction boxes across the active document. */
  redactCount: number;
  /** Destructively apply every pending redaction box (via PDFium) and remove
   *  the boxes. Irreversible content removal — confirms first. */
  applyRedactions: () => Promise<void>;

  /** True when the active document is encrypted (in-app copy needs a password). */
  activeEncrypted: boolean;
  /** True when the active document will be written protected on save — it's
   *  encrypted, or was protected this session (in-app copy stays editable). */
  activeProtected: boolean;
  /** True when the active document is locked to PickPDF (wrapper + AES-GCM);
   *  saving keeps the lock, other viewers see only a notice page. */
  activeWrapped: boolean;
  /** Bake edits, encrypt with AES-256 and save/download the protected file.
   *  Real two-password model: `userPassword` gates opening (may be "" for a
   *  restrictions-only file), `ownerPassword` gates full permissions, and
   *  `permissions` is the OR'd PDF_PERMISSIONS bits granted to user-password
   *  holders. The open copy stays unlocked for further editing. */
  protectDocument: (opts: {
    userPassword: string;
    ownerPassword: string;
    permissions: number;
    /** Lock to PickPDF: other viewers show a notice page; the real document
     *  travels inside as an AES-256-GCM payload. */
    pickpdfOnly?: boolean;
  }) => Promise<void>;
  /** Decrypt the open document in place (undoable); save then writes the
   *  unlocked file. Requires owner rights — prompts for the permissions
   *  password when needed. */
  removePassword: () => Promise<void>;
  /** What the active document's permissions allow US to do. All-true unless
   *  the doc is encrypted and owner rights aren't held (honored like every
   *  compliant viewer: restrictions apply until unlocked). */
  docPermissions: {
    print: boolean;
    copy: boolean;
    modify: boolean;
    annotate: boolean;
    fillForms: boolean;
    /** True when restrictions are currently in force (encrypted + owner locked). */
    restricted: boolean;
  };
  /** Unlock full permissions with the owner password and create a safe,
   *  decrypted working copy. Returns success. */
  unlockPermissions: (ownerPassword: string) => Promise<boolean>;
  /** Document-security dialog visibility (openable from the menu, the toolbar
   *  badge, or an on-open notification). */
  securityModalOpen: boolean;
  setSecurityModalOpen: (v: boolean) => void;

  /** Sign-with-certificate dialog visibility (File menu / Signatures panel). */
  signModalOpen: boolean;
  setSignModalOpen: (v: boolean) => void;

  /** Pending password prompt rendered by PasswordModal (null = closed). */
  passwordPrompt: PasswordRequest | null;
  /** Settle the pending prompt: the entered password, or null = cancelled. */
  answerPassword: (value: string | null) => void;

  /** Pending confirmation rendered by ConfirmModal (null = closed). */
  confirmPrompt: ConfirmRequest | null;
  /** Ask the user to confirm an action; resolves false on cancel/dismiss. */
  requestConfirm: (req: ConfirmRequest) => Promise<boolean>;
  /** Settle the pending confirmation. */
  answerConfirm: (ok: boolean) => void;

  /** OCR the active document into a searchable text layer. */
  ocrBusy: boolean;
  runOcrText: () => Promise<void>;
  /** OCR recognition language (Tesseract traineddata code, e.g. "eng"). */
  ocrLanguage: string;
  setOcrLanguage: (code: string) => void;

  currentPage: number;
  setCurrentPage: (p: number) => void;
  scrollToPage: (p: number) => void;
  scale: number;
  setScale: (s: number) => void;
  /** null = manual zoom via `scale`. */
  fitMode: "width" | "page" | null;
  setFitMode: (m: "width" | "page" | null) => void;
  /** Two-page spread layout in the main viewer. */
  spread: boolean;
  setSpread: (v: boolean) => void;
  /** Print dialog (page range + scale) visibility. */
  printModalOpen: boolean;
  setPrintModalOpen: (v: boolean) => void;

  /** Edit mode gates the editor toolbar and annotation interactivity. */
  editMode: boolean;
  setEditMode: (v: boolean) => void;

  tool: ToolKind;
  setTool: (t: ToolKind) => void;
  toolColor: string;
  /** Highlighter has its own color memory (pastel palette). */
  highlightColor: string;
  setHighlightColor: (c: string) => void;
  /** Highlighter mode: "text" drags over text (like the markup tools), "area"
   *  free-draws a box over any region. */
  highlightMode: "text" | "area";
  setHighlightMode: (m: "text" | "area") => void;
  /** Edit-text scope: what a click opens in the inline editor — one visual
   *  line, the detected paragraph, or the whole contiguous text block. */
  editTextScope: EditTextScope;
  setEditTextScope: (s: EditTextScope) => void;
  /** Text-markup (underline / strikeout / squiggly) ink color. */
  markupColor: string;
  setMarkupColor: (c: string) => void;
  setToolColor: (c: string) => void;
  /** Text boxes have their own color memory, defaulting to black. */
  fontColor: string;
  setFontColor: (c: string) => void;
  /** Fill color for new rect/ellipse shapes; null = no fill. */
  toolFill: string | null;
  setToolFill: (c: string | null) => void;
  /** Check / cross tool: which symbol to stamp, and its color. */
  markSymbol: MarkSymbol;
  setMarkSymbol: (s: MarkSymbol) => void;
  markColor: string;
  setMarkColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  fontSize: number;
  setFontSize: (s: number) => void;
  fontFamily: FontFamilyKind;
  setFontFamily: (f: FontFamilyKind) => void;
  fontBold: boolean;
  setFontBold: (v: boolean) => void;
  fontItalic: boolean;
  setFontItalic: (v: boolean) => void;
  fontUnderline: boolean;
  setFontUnderline: (v: boolean) => void;
  fontStrike: boolean;
  setFontStrike: (v: boolean) => void;
  textAlign: "left" | "center" | "right";
  setTextAlign: (a: "left" | "center" | "right") => void;
  /** Line-height multiplier for new text boxes. */
  lineHeight: number;
  setLineHeight: (v: number) => void;
  /** Letter spacing (PDF points) for new text boxes. */
  letterSpacing: number;
  setLetterSpacing: (v: number) => void;

  annotations: AnnotationMap;
  /** Unsaved changes of ANY kind — overlay edits or committed byte edits. */
  hasAnnotations: boolean;
  /** Overlay edits (annotations / form values / field ops). */
  hasOverlayEdits: boolean;
  /** Byte-level edits committed since the last save (text edits, page ops,
   *  OCR, redactions…). */
  hasByteEdits: boolean;
  addAnnotation: (page: number, ann: Annotation) => void;
  addAnnotations: (page: number, anns: Annotation[]) => void;
  updateAnnotation: (page: number, ann: Annotation) => void;
  removeAnnotation: (page: number, id: string) => void;
  /** Restore the exact state from the last successful save/open. */
  clearAnnotations: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  selected: { page: number; id: string } | null;
  setSelected: (s: { page: number; id: string } | null) => void;

  /** Copy the selected annotation (and its group partners, e.g. a callout's
   *  arrow + text) to the internal clipboard. Returns true when copied. */
  copySelectedAnnotation: () => boolean;
  /** Paste the internal clipboard onto the current page, slightly offset. */
  pasteAnnotationClipboard: () => void;
  /** Duplicate the selected annotation (and group partners) in place. */
  duplicateSelectedAnnotation: () => void;

  /** Id of a text annotation that should open its editor immediately. */
  editRequestId: string | null;
  setEditRequestId: (id: string | null) => void;

  pendingStamp: PendingStamp | null;
  setPendingStamp: (s: PendingStamp | null) => void;

  /** AcroForm values of the active tab. */
  formValues: Record<string, unknown>;
  setFormValue: (name: string, value: unknown) => void;

  /** Measurement calibration of the active tab (units per PDF point). */
  measureScale: MeasureScale | null;
  /** Set (or clear) the calibration; existing measure annotations are
   *  re-labelled in the same step. */
  setMeasureScale: (s: MeasureScale | null) => void;
  /** True while the next distance line is a calibration reference, not a
   *  measurement. */
  measureCalibrating: boolean;
  setMeasureCalibrating: (v: boolean) => void;
  /** Pending "this line is ___ units" dialog (opened after the calibration
   *  line is drawn); ptLength is the drawn line's length in PDF points. */
  calibrateRequest: { ptLength: number } | null;
  setCalibrateRequest: (r: { ptLength: number } | null) => void;

  /** Pending edits to existing form fields (active tab). */
  fieldOps: Record<string, ExistingFieldOp>;
  upsertFieldOp: (
    base: Pick<ExistingFieldOp, "key" | "fieldName" | "pageIndex" | "origRect">,
    patch: Partial<ExistingFieldOp>,
  ) => void;
  selectedField: Pick<
    ExistingFieldOp,
    "key" | "fieldName" | "pageIndex" | "origRect"
  > | null;
  setSelectedField: (
    f: Pick<ExistingFieldOp, "key" | "fieldName" | "pageIndex" | "origRect"> | null,
  ) => void;

  /** Form-builder mode: field palette + docked properties + field outline. */
  formBuilder: boolean;
  setFormBuilder: (v: boolean) => void;
  /** Live preview inside the builder — new fields render as fillable inputs. */
  formPreview: boolean;
  setFormPreview: (v: boolean) => void;
  /** Values typed into the live preview, keyed by field name (transient). */
  previewValues: Record<string, unknown>;
  setPreviewValue: (name: string, v: unknown) => void;

  /** Multi-selected annotation ids (one page at a time; includes `selected`). */
  multiSelected: { page: number; ids: string[] } | null;
  setMultiSelected: (s: { page: number; ids: string[] } | null) => void;
  /** Shift-click: toggle an annotation in/out of the multi-selection. */
  toggleMultiSelected: (page: number, id: string) => void;
  /** Move several annotations at once (one undo step). */
  translateAnnotations: (page: number, ids: string[], dx: number, dy: number) => void;
  /** Replace several annotations on a page at once (one undo step). */
  updateAnnotations: (page: number, anns: Annotation[]) => void;
  /** Remove several annotations at once (one undo step). */
  removeAnnotations: (page: number, ids: string[]) => void;
  /** Transient offset previewing a multi-selection drag in progress. */
  groupDrag: { page: number; ids: string[]; dx: number; dy: number } | null;
  setGroupDrag: (
    g: { page: number; ids: string[]; dx: number; dy: number } | null,
  ) => void;
  /** Alignment guides shown while a field is dragged (form builder). */
  snapGuides: { page: number; v: number[]; h: number[] } | null;
  setSnapGuides: (g: { page: number; v: number[]; h: number[] } | null) => void;
  /** Snapping & grid preferences (form builder). */
  snapEnabled: boolean;
  setSnapEnabled: (v: boolean) => void;
  gridEnabled: boolean;
  setGridEnabled: (v: boolean) => void;
  gridSize: number;
  setGridSize: (n: number) => void;
  /** Move a new form field up/down within its page's tab order. */
  reorderFormField: (page: number, id: string, dir: -1 | 1) => void;

  searchQuery: string;
  searchOptions: SearchOptions;
  searchMatches: SearchMatch[];
  activeMatch: number;
  searchError: string | null;
  runSearch: (q: string, options?: Partial<SearchOptions>) => Promise<number>;
  setSearchOptions: (options: Partial<SearchOptions>) => void;
  gotoMatch: (i: number) => void;
  replaceMatch: (replacement: string, index?: number) => Promise<void>;
  replaceAll: (replacement: string) => Promise<void>;
  clearSearch: () => void;

  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
  /** Queue a prompt for the AI panel (opens it); the panel sends it. */
  aiAsk: { id: string; prompt: string } | null;
  askAi: (prompt: string) => void;

  /** Mobile slide-over sidebar (thumbnails/outline/recent). */
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  /** True when the viewport is below the desktop breakpoint (<1024px). */
  isMobile: boolean;

  settings: AppSettings;
  setSettings: (s: AppSettings) => void;

  signatures: SavedSignature[];
  addSignature: (dataUrl: string) => void;
  removeSignature: (id: string) => void;

  signatureModalOpen: boolean;
  setSignatureModalOpen: (v: boolean) => void;
}

const Ctx = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

/**
 * Subscription API for selector-based store access. The provider keeps the
 * current store in a ref and notifies subscribers after each commit; consumers
 * read it through React's own useSyncExternalStore, so they re-render only when
 * their SELECTED slice changes — even though the store object itself is rebuilt
 * every render. This context value is created once and never changes, so
 * reading it (unlike reading the main Ctx) never itself forces a re-render.
 */
interface StoreApi {
  subscribe: (cb: () => void) => () => void;
  getStore: () => AppStore;
}

const StoreApiCtx = createContext<StoreApi | null>(null);

/**
 * Read a slice of the store. The component re-renders only when `selector`'s
 * result changes (compared with `isEqual`, default Object.is). Prefer this over
 * `useApp()` in components that don't need the whole store — especially
 * peripheral chrome (sidebar, title bar, AI panel) that would otherwise
 * re-render on every unrelated editing update.
 *
 * Return a primitive or a stable reference; a selector that builds a fresh
 * object each call needs a shallow `isEqual` (see `shallowEqual`) or it will
 * re-render every time.
 */
export function useAppSelector<T>(
  selector: (s: AppStore) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const api = useContext(StoreApiCtx);
  if (!api) throw new Error("useAppSelector outside provider");
  return useSyncExternalStoreWithSelector(
    api.subscribe,
    api.getStore,
    api.getStore,
    selector,
    isEqual,
  );
}

/** Shallow-equality helper for selectors that return an object of fields. */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}


function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

/**
 * THE document-integrity gate: any unsaved change, overlay OR byte-level.
 * Byte-level commits (page ops, OCR, in-place text edits, redactions…) clear
 * the overlay maps, so this must NOT be inferred from them — it is revision
 * tracking (src/lib/revision.ts), bumped by every mutation and reset only by
 * a successful save.
 */
function docHasEdits(d: OpenDoc): boolean {
  return hasUnsavedChanges(d.rev);
}

/**
 * Overlay-only edits (annotations / form values / field ops) — the part of
 * the unsaved state that still needs BAKING into the bytes, and the only part
 * Discard can actually remove.
 */
function docHasOverlayEdits(d: OpenDoc): boolean {
  return (
    Object.values(d.annotations).some((l) => l.length > 0) ||
    Object.keys(d.formValues).length > 0 ||
    Object.keys(d.fieldOps).length > 0
  );
}

// PDF permission bits (spec table 22), named once so the decoder below is the
// single place that maps bits → capabilities (no scattered magic numbers).
const PERM_PRINT = 4;
const PERM_MODIFY = 8;
const PERM_COPY = 16;
const PERM_ANNOTATE = 32;
const PERM_FILL_FORMS = 256;
const PERM_PRINT_HQ = 2048;

/** What a document lets US do. `restricted` is true only when the doc is
 *  encrypted and owner rights aren't held; otherwise everything is allowed. */
export interface DocPermissions {
  print: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  restricted: boolean;
}

const ALL_ALLOWED: DocPermissions = {
  print: true,
  copy: true,
  modify: true,
  annotate: true,
  fillForms: true,
  restricted: false,
};

/** Decode a document's effective permissions — the ONE decoder used by the
 *  on-open notice, the toolbar/print/form gates and the security dialog. */
function permissionsOf(pdf: PdfDoc): DocPermissions {
  if (!pdf.isEncrypted() || pdf.isOwnerUnlocked()) return ALL_ALLOWED;
  const p = pdf.getUserPermissions();
  return {
    print: (p & PERM_PRINT) !== 0 || (p & PERM_PRINT_HQ) !== 0,
    copy: (p & PERM_COPY) !== 0,
    // PickPDF's editing stack uses pdf-lib for several mutations. pdf-lib
    // cannot decrypt standard security handlers, so passing encrypted bytes
    // through it would corrupt the file. Keep encrypted working bytes
    // read-only until the owner password has been authenticated and PDFium
    // has produced a verified plaintext working copy.
    modify: false,
    annotate: false,
    fillForms: false,
    restricted: true,
  };
}

/** Human-readable list of what the document forbids (for the on-open notice). */
function summarizeRestrictions(perms: DocPermissions): string[] {
  const denied: string[] = [];
  if (!perms.print) denied.push("printing");
  if (!perms.copy) denied.push("copying text");
  if (!perms.modify) denied.push("editing");
  if (!perms.annotate) denied.push("annotating");
  if (!perms.fillForms) denied.push("filling forms");
  return denied;
}

const HISTORY_CAP = 60;
const MAX_WARM_DOCS = 6;

/**
 * Append a new undo step. Trims any redone tail, carries the current base
 * (bytes/pdf) forward unless a new one is supplied (an in-place text edit),
 * and keeps `history`/`bytesHistory` aligned. Returns the doc patch.
 */
function pushHistory(
  d: OpenDoc,
  nextAnnotations: AnnotationMap,
  nextBase?: BaseState,
): Partial<OpenDoc> {
  const trimHist = d.history.slice(0, d.historyIndex + 1);
  const trimBase = d.bytesHistory.slice(0, d.historyIndex + 1);
  const base =
    nextBase ??
    trimBase[trimBase.length - 1] ?? { bytes: d.bytes, pdf: d.pdf };
  const history = [...trimHist, nextAnnotations].slice(-HISTORY_CAP);
  const bytesHistory = [...trimBase, base].slice(-HISTORY_CAP);
  return {
    annotations: nextAnnotations,
    history,
    bytesHistory,
    historyIndex: history.length - 1,
    bytes: base.bytes,
    // Keep the current live proxy when a base carries none (bytes-only steps
    // from in-place content edits) — never blank out doc.pdf.
    pdf: base.pdf ?? d.pdf,
    // Every push is a mutation; a new base means a committed byte-level edit.
    rev: nextBase ? bumpBytesRevision(d.rev) : bumpRevision(d.rev),
  };
}

interface PendingPdfEdits {
  operations: PdfEditOperation[];
  latestBytes: Uint8Array;
  /** True when the optimistic live proxy cannot exactly represent the worker
   * result (font recreation or paragraph reflow), so it must be replaced. */
  requiresReload: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  cancelled: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

/** Immediate visual status plus the worker's eventual persistence boundary. */
interface PdfEditCommitResult {
  /** True when the live PDF renderer already shows the complete result. */
  previewed: boolean;
  /** Resolves after regenerated bytes and any replacement renderer are ready. */
  settled: Promise<void>;
}

/** Append a background PDF edit without retaining another live PDFium proxy in
 * every history slot. Undo can reload the stored bytes; the new proxy is only
 * the document's current renderer. */
function pushBackgroundContentEdit(
  d: OpenDoc,
  nextBytes: Uint8Array,
  nextPdf: PdfDoc,
  bumpRevision = true,
): Partial<OpenDoc> {
  const trimHist = d.history.slice(0, d.historyIndex + 1);
  const trimBase = d.bytesHistory.slice(0, d.historyIndex + 1);
  const history = [...trimHist, d.annotations].slice(-HISTORY_CAP);
  const bytesHistory = [...trimBase, { bytes: nextBytes }].slice(-HISTORY_CAP);
  return {
    bytes: nextBytes,
    pdf: nextPdf,
    history,
    bytesHistory,
    historyIndex: history.length - 1,
    rev: bumpRevision ? bumpBytesRevision(d.rev) : d.rev,
  };
}

/** Destroy every distinct pdf proxy a doc still references, except `keep`. */
function destroyDocProxies(d: OpenDoc, keep?: PdfDoc) {
  const seen = new Set<PdfDoc>();
  const kill = (p?: PdfDoc) => {
    if (!p || p === keep || seen.has(p)) return;
    seen.add(p);
    p.destroy().catch(() => {});
  };
  kill(d.pdf);
  for (const b of d.bytesHistory) kill(b.pdf);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem(THEME_KEY) as "light" | "dark") || "light",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const [accent, setAccent] = useState<AccentId>(
    () => (localStorage.getItem(ACCENT_KEY) as AccentId) || "neutral",
  );
  useEffect(() => {
    applyAccent(accent, theme);
    localStorage.setItem(ACCENT_KEY, accent);
  }, [accent, theme]);

  const [screen, setScreen] = useState<Screen>("viewer");
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  // Optimistic content edits collect here. The live PdfDoc previews them
  // immediately; one worker rewrite begins after a short idle window.
  const pendingPdfEdits = useRef(new Map<string, PendingPdfEdits>());
  const flushPdfEditsRef = useRef<(id: string) => Promise<void>>(async () => {});
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [panes, setPanes] = useState<Array<{ id: string; docId: string }>>([]);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [paneSizes, setPaneSizes] = useState<number[]>([]);
  const MAX_PANES = 4;
  const [docVersion, setDocVersion] = useState(0);
  // Bumped when undo/redo or another operation needs pages to repaint without
  // changing the viewer React key (and therefore without a scroll jump).
  const [contentRev, setContentRev] = useState(0);

  const active = docs.find((d) => d.id === activeTabId) ?? null;

  const updateDoc = useCallback(
    (id: string, patch: Partial<OpenDoc> | ((d: OpenDoc) => Partial<OpenDoc>)) => {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) }
            : d,
        ),
      );
    },
    [],
  );

  /** Async flush continuations sometimes need the committed bytes before the
   * next React render. Keep the ref mirror in sync for those boundaries only. */
  const updateDocImmediately = useCallback(
    (id: string, patch: Partial<OpenDoc> | ((d: OpenDoc) => Partial<OpenDoc>)) => {
      const next = docsRef.current.map((d) =>
        d.id === id
          ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) }
          : d,
      );
      docsRef.current = next;
      setDocs(next);
    },
    [],
  );

  const [scale, setScale] = useState(1.1);
  const [fitMode, setFitMode] = useState<"width" | "page" | null>("width");
  const [spread, setSpread] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  // Modeless editing: "read" (text selection, links) is simply the state
  // where no tool is armed. editMode is derived — kept on the store because
  // many gates ("is any editing UI active?") still read it.
  const [tool, setTool] = useState<ToolKind>("read");
  // "read" and "pan" are both non-editing viewing modes.
  const editMode = tool !== "read" && tool !== "pan";
  const setEditModeState = useCallback((v: boolean) => {
    setTool((t) => (v ? (t === "read" || t === "pan" ? "select" : t) : "read"));
  }, []);
  const [toolColor, setToolColor] = useState("#e11d48");
  const [fontColor, setFontColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#facc15");
  const [highlightMode, setHighlightMode] = useState<"text" | "area">("text");
  const [editTextScope, setEditTextScope] = useState<EditTextScope>("line");
  const [markupColor, setMarkupColor] = useState("#dc2626");
  // Fill color for new rect/ellipse shapes; null = no fill (outline only).
  const [toolFill, setToolFill] = useState<string | null>(null);
  const [markSymbol, setMarkSymbol] = useState<MarkSymbol>("check");
  const [markColor, setMarkColor] = useState("#16a34a");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState<FontFamilyKind>("helvetica");
  const [fontBold, setFontBold] = useState(false);
  const [fontItalic, setFontItalic] = useState(false);
  const [fontUnderline, setFontUnderline] = useState(false);
  const [fontStrike, setFontStrike] = useState(false);
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">("left");
  const [lineHeight, setLineHeight] = useState(1.25);
  const [letterSpacing, setLetterSpacing] = useState(0);

  const [selected, setSelected] = useState<{ page: number; id: string } | null>(null);
  const [selectedField, setSelectedField] = useState<Pick<
    ExistingFieldOp,
    "key" | "fieldName" | "pageIndex" | "origRect"
  > | null>(null);

  /* ---------------- form builder ---------------- */

  const [formBuilder, setFormBuilderState] = useState(false);
  const [formPreview, setFormPreview] = useState(false);
  const [previewValues, setPreviewValuesState] = useState<Record<string, unknown>>({});
  const setPreviewValue = useCallback((name: string, v: unknown) => {
    setPreviewValuesState((prev) => ({ ...prev, [name]: v }));
  }, []);

  const [multiSelected, setMultiSelected] = useState<{
    page: number;
    ids: string[];
  } | null>(null);
  const [groupDrag, setGroupDrag] = useState<{
    page: number;
    ids: string[];
    dx: number;
    dy: number;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{
    page: number;
    v: number[];
    h: number[];
  } | null>(null);

  // Snap/grid preferences survive restarts (small quality-of-life memory).
  const [snapEnabled, setSnapEnabledState] = useState(
    () => localStorage.getItem("pdfwb.formSnap") !== "0",
  );
  const setSnapEnabled = useCallback((v: boolean) => {
    setSnapEnabledState(v);
    localStorage.setItem("pdfwb.formSnap", v ? "1" : "0");
  }, []);
  const [gridEnabled, setGridEnabledState] = useState(
    () => localStorage.getItem("pdfwb.formGrid") === "1",
  );
  const setGridEnabled = useCallback((v: boolean) => {
    setGridEnabledState(v);
    localStorage.setItem("pdfwb.formGrid", v ? "1" : "0");
  }, []);
  const [gridSize, setGridSizeState] = useState(
    () => Number(localStorage.getItem("pdfwb.formGridSize")) || 12,
  );
  const setGridSize = useCallback((n: number) => {
    const size = Math.max(4, Math.min(72, Math.round(n)));
    setGridSizeState(size);
    localStorage.setItem("pdfwb.formGridSize", String(size));
  }, []);

  // OCR recognition language survives restarts. A ref mirrors the state so
  // runOcrText reads the value picked in its confirm dialog, not the one the
  // closure captured before the dialog opened.
  const [ocrLanguage, setOcrLanguageState] = useState(() =>
    normalizeOcrLanguage(localStorage.getItem("pdfwb.ocrLang")),
  );
  const ocrLanguageRef = useRef(ocrLanguage);
  const setOcrLanguage = useCallback((code: string) => {
    const lang = normalizeOcrLanguage(code);
    ocrLanguageRef.current = lang;
    setOcrLanguageState(lang);
    localStorage.setItem("pdfwb.ocrLang", lang);
  }, []);

  /** Shift-click membership toggle. The last-clicked id becomes the primary
   *  selection so the properties panel follows the click. */
  const toggleMultiSelected = useCallback(
    (page: number, id: string) => {
      let ids =
        multiSelected && multiSelected.page === page
          ? [...multiSelected.ids]
          : selected && selected.page === page
            ? [selected.id]
            : [];
      ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      if (!ids.length) {
        setMultiSelected(null);
        setSelected(null);
        return;
      }
      setMultiSelected({ page, ids });
      setSelected({ page, id: ids.includes(id) ? id : ids[ids.length - 1] });
    },
    [multiSelected, selected],
  );

  // A multi-selection is only meaningful while its primary member is selected
  // and its ids still exist — reconcile after deletes, undo, tab switches.
  useEffect(() => {
    if (!multiSelected) return;
    if (
      !selected ||
      selected.page !== multiSelected.page ||
      !multiSelected.ids.includes(selected.id)
    ) {
      setMultiSelected(null);
      return;
    }
    const list = active?.annotations[multiSelected.page] ?? [];
    const alive = multiSelected.ids.filter((id) => list.some((a) => a.id === id));
    if (alive.length !== multiSelected.ids.length) {
      setMultiSelected(alive.length > 1 ? { ...multiSelected, ids: alive } : null);
    }
  }, [multiSelected, selected, active]);
  const [editRequestId, setEditRequestId] = useState<string | null>(null);
  const [pendingStamp, setPendingStamp] = useState<PendingStamp | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptionsState] = useState<SearchOptions>(
    DEFAULT_SEARCH_OPTIONS,
  );
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  // AI panel opens by default on desktop, stays closed on mobile.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1024,
  );
  const [aiOpen, setAiOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1024,
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024,
  );

  const [aiAsk, setAiAsk] = useState<{ id: string; prompt: string } | null>(null);
  const askAi = useCallback(
    (prompt: string) => {
      setAiOpen(true);
      if (isMobile) setSidebarOpen(false);
      setAiAsk({ id: uid(), prompt });
    },
    [isMobile],
  );

  useEffect(() => {
    let prevWidth = window.innerWidth;
    const onResize = () => {
      const w = window.innerWidth;
      setIsMobile(w < 1024);
      // Crossing from desktop into the mobile breakpoint auto-closes the left
      // sidebar so the page keeps its room; it can still be reopened manually.
      if (w < 1024 && prevWidth >= 1024) setSidebarOpen(false);
      prevWidth = w;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  // Measurement calibration flow: armed flag + the pending "known length" dialog.
  const [measureCalibrating, setMeasureCalibrating] = useState(false);
  const [calibrateRequest, setCalibrateRequest] = useState<{
    ptLength: number;
  } | null>(null);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [signModalOpen, setSignModalOpen] = useState(false);

  // --- In-app password dialog (replaces window.prompt everywhere) ----------
  // Promise-based: flows await requestPassword(); the PasswordModal renders
  // from `passwordPrompt` and settles the promise via answerPassword().
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordRequest | null>(
    null,
  );
  const passwordResolver = useRef<((v: string | null) => void) | null>(null);
  const requestPassword = useCallback(
    (req: PasswordRequest): Promise<string | null> =>
      new Promise((resolve) => {
        // A dangling earlier request (shouldn't happen) resolves as cancelled.
        passwordResolver.current?.(null);
        passwordResolver.current = resolve;
        setPasswordPrompt(req);
      }),
    [],
  );
  const answerPassword = useCallback((value: string | null) => {
    setPasswordPrompt(null);
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    resolve?.(value);
  }, []);

  // Promise-based confirm, mirroring requestPassword: flows await
  // requestConfirm(); the ConfirmModal renders from `confirmPrompt` and
  // settles the promise via answerConfirm(). Replaces window.confirm.
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  const requestConfirm = useCallback(
    (req: ConfirmRequest): Promise<boolean> =>
      new Promise((resolve) => {
        // A dangling earlier request (shouldn't happen) resolves as cancelled.
        confirmResolver.current?.(false);
        confirmResolver.current = resolve;
        setConfirmPrompt(req);
      }),
    [],
  );
  const answerConfirm = useCallback((ok: boolean) => {
    setConfirmPrompt(null);
    const resolve = confirmResolver.current;
    confirmResolver.current = null;
    resolve?.(ok);
  }, []);
  // Standard encrypted PDFs (lib/pdf.ts loadPdf) prompt through the same
  // dialog instead of window.prompt (which would show the password in
  // plain text).
  useEffect(() => {
    setPasswordPrompter(({ message, isRetry }) =>
      requestPassword({
        title: "Password required",
        message,
        error: isRetry ? "Wrong password — try again." : undefined,
      }),
    );
  }, [requestPassword]);

  const [settings, setSettingsState] = useState<AppSettings>(() => {
    const loaded = loadJson(SETTINGS_KEY, DEFAULT_SETTINGS);
    // API credentials are session-only. Migrate keys saved by older versions
    // into sessionStorage and immediately scrub the persistent settings record.
    let apiKey = loaded.customApiKey;
    try {
      apiKey = sessionStorage.getItem(API_KEY_SESSION_KEY) ?? apiKey;
      if (apiKey) sessionStorage.setItem(API_KEY_SESSION_KEY, apiKey);
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...loaded, customApiKey: "" }),
      );
    } catch {
      // Keep the value in memory for this run even if browser storage is denied.
    }
    const safeLoaded = { ...loaded, customApiKey: apiKey };
    // The built-in on-device model is desktop-only — its weights OOM-crash a
    // mobile tab. On phones/tablets, fall back to a remote Custom API so a fresh
    // user (who defaults to "browser") isn't left pointing at an unusable model.
    if (isHandheldDevice() && safeLoaded.provider === "browser") {
      return { ...safeLoaded, provider: "openai_compatible" };
    }
    return safeLoaded;
  });
  const setSettings = useCallback((s: AppSettings) => {
    setSettingsState(s);
    try {
      if (s.customApiKey) sessionStorage.setItem(API_KEY_SESSION_KEY, s.customApiKey);
      else sessionStorage.removeItem(API_KEY_SESSION_KEY);
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...s, customApiKey: "" }),
      );
    } catch {
      /* settings remain available in memory for this session */
    }
  }, []);

  const [signatures, setSignatures] = useState<SavedSignature[]>(() =>
    loadJson<SavedSignature[]>(SIGNATURES_KEY, []),
  );
  const addSignature = useCallback((dataUrl: string) => {
    setSignatures((prev) => {
      const next = [{ id: uid(), dataUrl, createdAt: Date.now() }, ...prev].slice(0, 8);
      localStorage.setItem(SIGNATURES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const removeSignature = useCallback((id: string) => {
    setSignatures((prev) => {
      const next = prev.filter((s) => s.id !== id);
      localStorage.setItem(SIGNATURES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /* ---------------- annotations (active tab) ---------------- */

  const pushAnnotations = useCallback(
    (next: AnnotationMap) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => pushHistory(d, next));
    },
    [activeTabId, updateDoc],
  );

  const annotations = active?.annotations ?? {};

  const addAnnotation = useCallback(
    (page: number, ann: Annotation) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) =>
        pushHistory(d, {
          ...d.annotations,
          [page]: [...(d.annotations[page] ?? []), ann],
        }),
      );
    },
    [activeTabId, updateDoc],
  );

  const addAnnotationsMany = useCallback(
    (page: number, anns: Annotation[]) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) =>
        pushHistory(d, {
          ...d.annotations,
          [page]: [...(d.annotations[page] ?? []), ...anns],
        }),
      );
    },
    [activeTabId, updateDoc],
  );

  const updateAnnotation = useCallback(
    (page: number, ann: Annotation) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) =>
        pushHistory(d, {
          ...d.annotations,
          [page]: (d.annotations[page] ?? []).map((a) => (a.id === ann.id ? ann : a)),
        }),
      );
    },
    [activeTabId, updateDoc],
  );

  const removeAnnotation = useCallback(
    (page: number, id: string) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const list = d.annotations[page] ?? [];
        const target = list.find((a) => a.id === id);
        return pushHistory(d, {
          ...d.annotations,
          [page]: list.filter(
            (a) => a.id !== id && !(target?.groupId && a.groupId === target.groupId),
          ),
        });
      });
      setSelected(null);
    },
    [activeTabId, updateDoc],
  );

  /* --- annotation clipboard (copy / paste / duplicate) --- */

  // Internal clipboard: a snapshot of one annotation plus its group partners
  // (highlight quads, a callout's arrow + text box). Not the OS clipboard.
  const annClipboard = useRef<Annotation[] | null>(null);
  const pasteSeq = useRef(0);

  /** The selected annotation(s) plus everything sharing their groupIds. */
  const selectedGroup = useCallback((): Annotation[] => {
    if (!active || !selected) return [];
    const list = active.annotations[selected.page] ?? [];
    // Multi-selection: every member plus group partners, in page order.
    if (
      multiSelected &&
      multiSelected.page === selected.page &&
      multiSelected.ids.length > 1
    ) {
      const ids = new Set(multiSelected.ids);
      const groups = new Set<string>();
      for (const a of list) if (ids.has(a.id) && a.groupId) groups.add(a.groupId);
      return list.filter(
        (a) => ids.has(a.id) || (a.groupId && groups.has(a.groupId)),
      );
    }
    const target = list.find((a) => a.id === selected.id);
    if (!target) return [];
    return target.groupId
      ? list.filter((a) => a.groupId === target.groupId)
      : [target];
  }, [active, selected, multiSelected]);

  /** Fresh ids (and fresh groupIds, preserving the grouping structure —
   *  a multi-selection can span several groups), offset so the copy is
   *  visible. */
  const cloneAnnotations = (anns: Annotation[], offset: number): Annotation[] => {
    const groupMap = new Map<string, string>();
    const freshGroup = (g: string) => {
      let next = groupMap.get(g);
      if (!next) {
        next = uid();
        groupMap.set(g, next);
      }
      return next;
    };
    return anns.map((a) => ({
      ...structuredClone(a),
      id: uid(),
      groupId: a.groupId ? freshGroup(a.groupId) : undefined,
      x: a.x + offset,
      y: a.y + offset,
    }));
  };

  const copySelectedAnnotation = useCallback((): boolean => {
    const group = selectedGroup();
    if (!group.length) return false;
    annClipboard.current = group.map((a) => structuredClone(a));
    pasteSeq.current = 0;
    return true;
  }, [selectedGroup]);

  const pasteAnnotationClipboard = useCallback(() => {
    const src = annClipboard.current;
    if (!src?.length || !activeTabId || !active) return;
    pasteSeq.current += 1;
    const clones = cloneAnnotations(src, 12 * pasteSeq.current);
    const page = active.currentPage;
    updateDoc(activeTabId, (d) =>
      pushHistory(d, {
        ...d.annotations,
        [page]: [...(d.annotations[page] ?? []), ...clones],
      }),
    );
    setSelected({ page, id: clones[clones.length - 1].id });
    setMultiSelected(
      clones.length > 1 ? { page, ids: clones.map((c) => c.id) } : null,
    );
  }, [activeTabId, active, updateDoc]);

  const duplicateSelectedAnnotation = useCallback(() => {
    const group = selectedGroup();
    if (!group.length || !activeTabId || !selected) return;
    const clones = cloneAnnotations(group, 12);
    const page = selected.page;
    updateDoc(activeTabId, (d) =>
      pushHistory(d, {
        ...d.annotations,
        [page]: [...(d.annotations[page] ?? []), ...clones],
      }),
    );
    setSelected({ page, id: clones[clones.length - 1].id });
    setMultiSelected(
      clones.length > 1 ? { page, ids: clones.map((c) => c.id) } : null,
    );
  }, [selectedGroup, activeTabId, selected, updateDoc]);

  /* --- batch operations (multi-select, form builder) --- */

  const translateAnnotations = useCallback(
    (page: number, ids: string[], dx: number, dy: number) => {
      if (!activeTabId || !ids.length || (!dx && !dy)) return;
      const idSet = new Set(ids);
      updateDoc(activeTabId, (d) =>
        pushHistory(d, {
          ...d.annotations,
          [page]: (d.annotations[page] ?? []).map((a) =>
            idSet.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a,
          ),
        }),
      );
    },
    [activeTabId, updateDoc],
  );

  const updateAnnotationsBatch = useCallback(
    (page: number, anns: Annotation[]) => {
      if (!activeTabId || !anns.length) return;
      const byId = new Map(anns.map((a) => [a.id, a]));
      updateDoc(activeTabId, (d) =>
        pushHistory(d, {
          ...d.annotations,
          [page]: (d.annotations[page] ?? []).map((a) => byId.get(a.id) ?? a),
        }),
      );
    },
    [activeTabId, updateDoc],
  );

  const removeAnnotationsBatch = useCallback(
    (page: number, ids: string[]) => {
      if (!activeTabId || !ids.length) return;
      updateDoc(activeTabId, (d) => {
        const list = d.annotations[page] ?? [];
        const idSet = new Set(ids);
        const groups = new Set<string>();
        for (const a of list) if (idSet.has(a.id) && a.groupId) groups.add(a.groupId);
        return pushHistory(d, {
          ...d.annotations,
          [page]: list.filter(
            (a) => !idSet.has(a.id) && !(a.groupId && groups.has(a.groupId)),
          ),
        });
      });
      setSelected(null);
      setMultiSelected(null);
    },
    [activeTabId, updateDoc],
  );

  /** Swap a form field with its neighbor among the page's form fields — the
   *  annotation array order IS the tab order (widgets are appended to the
   *  page's /Annots in this order on save). */
  const reorderFormField = useCallback(
    (page: number, id: string, dir: -1 | 1) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const list = [...(d.annotations[page] ?? [])];
        const fields = list
          .map((a, i) => ({ a, i }))
          .filter((x) => x.a.kind === "formfield");
        const pos = fields.findIndex((x) => x.a.id === id);
        const swap = pos + dir;
        if (pos < 0 || swap < 0 || swap >= fields.length) return {};
        const i = fields[pos].i;
        const j = fields[swap].i;
        [list[i], list[j]] = [list[j], list[i]];
        return pushHistory(d, { ...d.annotations, [page]: list });
      });
    },
    [activeTabId, updateDoc],
  );

  // Restore the exact state captured at the last successful open/save. This
  // handles both lightweight overlays and content already committed into the
  // PDF bytes, even when an optimistic worker edit is still in flight.
  const clearAnnotations = useCallback(async () => {
    if (!activeTabId) return;
    const id = activeTabId;
    const pending = pendingPdfEdits.current.get(id);
    if (pending) {
      pending.cancelled = true;
      if (pending.timer) clearTimeout(pending.timer);
      pendingPdfEdits.current.delete(id);
      pending.resolve();
    }
    const current = docsRef.current.find((doc) => doc.id === id);
    if (!current) return;
    try {
      const saved = current.savedState;
      const nextPdf = await loadPdf(saved.bytes);
      const latest = docsRef.current.find((doc) => doc.id === id);
      if (!latest) {
        nextPdf.destroy().catch(() => {});
        return;
      }
      destroyDocProxies(latest, nextPdf);
      updateDocImmediately(id, (d) => ({
        bytes: saved.bytes,
        pdf: nextPdf,
        annotations: saved.annotations,
        history: [saved.annotations],
        bytesHistory: [{ bytes: saved.bytes, pdf: nextPdf }],
        historyIndex: 0,
        formValues: saved.formValues,
        fieldOps: saved.fieldOps,
        rev: markSaved(d.rev),
      }));
      setSelected(null);
      setContentRev((v) => v + 1);
      if (
        !protectionInfo.current.has(id) &&
        !encryptedAtOpen.current.has(id)
      ) {
        void persistDoc({
          id,
          name: latest.name,
          sourceKey: latest.sourceKey,
          bytes: saved.bytes,
          annotations: saved.annotations,
          lastOpened: Date.now(),
          open: true,
        });
      }
    } catch (error) {
      toast.error(
        `Discard failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      throw error;
    }
  }, [activeTabId, updateDocImmediately]);

  // Restore an aligned (annotations + base bytes) history step.
  //
  // Older history entries may come from the former live-mutation path, so a
  // retained proxy cannot always be trusted for a content boundary:
  //  • same base bytes as now  → only annotations changed, keep the live pdf;
  //  • a distinct retained proxy → legacy reset step, swap it in;
  //  • otherwise               → reload the one live pdf from the step's bytes.
  // Reloads are a whole-doc parse, but undo/redo is rare — the common forward
  // edit stays reparse-free.
  const restoreStep = useCallback(
    async (doc: OpenDoc, target: number) => {
      // No-op steps (undo at the bottom, redo at the top) must not touch the
      // doc — bumping the revision would mark a clean document dirty.
      if (target === doc.historyIndex) return;
      const base = doc.bytesHistory[target] ?? { bytes: doc.bytes, pdf: doc.pdf };
      const annotations = doc.history[target] ?? {};
      if (base.bytes === doc.bytes) {
        updateDoc(doc.id, {
          historyIndex: target,
          annotations,
          rev: bumpRevision(doc.rev),
        });
      } else if (base.pdf && base.pdf !== doc.pdf) {
        updateDoc(doc.id, {
          historyIndex: target,
          annotations,
          bytes: base.bytes,
          pdf: base.pdf,
          // Crossing a content boundary swaps the base bytes — track it so a
          // post-undo Discard can't declare the doc clean against stale bytes.
          rev: bumpBytesRevision(doc.rev),
        });
        setContentRev((v) => v + 1);
      } else {
        const nextPdf = await loadPdf(base.bytes);
        const prev = doc.pdf;
        updateDoc(doc.id, {
          historyIndex: target,
          annotations,
          bytes: base.bytes,
          pdf: nextPdf,
          rev: bumpBytesRevision(doc.rev),
        });
        setContentRev((v) => v + 1);
        // Free the outgoing proxy unless a history base still references it
        // (those are freed together on close via destroyDocProxies).
        if (prev && prev !== nextPdf && !doc.bytesHistory.some((b) => b.pdf === prev)) {
          prev.destroy().catch(() => {});
        }
      }
      setSelected(null);
    },
    [updateDoc],
  );

  const undo = useCallback(() => {
    if (!active) return;
    const id = active.id;
    void flushPdfEditsRef.current(id).then(() => {
      const current = docsRef.current.find((doc) => doc.id === id);
      if (current) {
        return restoreStep(current, Math.max(0, current.historyIndex - 1));
      }
    });
  }, [active, restoreStep]);

  const redo = useCallback(() => {
    if (!active) return;
    const id = active.id;
    void flushPdfEditsRef.current(id).then(() => {
      const current = docsRef.current.find((doc) => doc.id === id);
      if (current) {
        return restoreStep(
          current,
          Math.min(current.history.length - 1, current.historyIndex + 1),
        );
      }
    });
  }, [active, restoreStep]);

  const hasAnnotations = useMemo(
    () => (active ? docHasEdits(active) : false),
    [active],
  );
  /** Overlay edits Discard can remove (annotations / form values / field ops). */
  const hasOverlayEdits = useMemo(
    () => (active ? docHasOverlayEdits(active) : false),
    [active],
  );
  /** Byte-level edits committed since the last save — not discardable. */
  const hasByteEdits = useMemo(
    () => (active ? hasUnsavedByteEdits(active.rev) : false),
    [active],
  );

  /* ---------------- documents & tabs ---------------- */

  const resetTransient = useCallback(() => {
    setSelected(null);
    setSelectedField(null);
    setPendingStamp(null);
    setSearchQuery("");
    setSearchMatches([]);
    setActiveMatch(0);
    setMultiSelected(null);
    setGroupDrag(null);
    setSnapGuides(null);
    setFormBuilderState(false);
    setFormPreview(false);
    setPreviewValuesState({});
    // A changed/opened document starts in read mode, not carrying over the
    // previous doc's edit session. (Templates re-arm editing after opening.)
    setTool("read");
  }, []);

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const recoverableIds = useRef(new Set<string>());
  const [folderRoot, setFolderRoot] = useState<FolderNode | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const docHandles = useRef(new Map<string, any>());
  const openingSources = useRef(new Map<string, Promise<string | null>>());
  const runOcrRef = useRef<(() => Promise<void>) | null>(null);
  /** Docs opened from (or saved as) a PickPDF-locked wrapper: how to re-wrap
   *  on save. `permissions`/`ownerPassword` re-apply inner restrictions. */
  // How each open doc must be RE-PROTECTED whenever its bytes go to disk or
  // IndexedDB. The single source of truth so save/download/persist never leak
  // a decrypted copy or silently drop protection. Set only after a protect (or
  // an unwrap) actually succeeds; cleared on remove-protection and close.
  const protectionInfo = useRef(new Map<string, ProtectionRecipe>());
  /** Docs that were STANDARD-ENCRYPTED when opened. Should one of these ever
   *  reach a write path with no recipe in protectionInfo (e.g. a
   *  restrictions-only file whose owner password was never entered, so there
   *  is nothing to re-encrypt with), protectForDisk demands explicit consent
   *  before writing plain bytes instead of silently stripping protection.
   *  Cleared on close and on an explicit remove-protection. */
  const encryptedAtOpen = useRef(new Set<string>());
  /** Reactive mirror of protectionInfo's keys (refs don't trigger renders). */
  const [protectedIds, setProtectedIds] = useState<ReadonlySet<string>>(new Set());
  const markProtected = useCallback((docId: string, on: boolean) => {
    setProtectedIds((prev) => {
      if (on === prev.has(docId)) return prev;
      const next = new Set(prev);
      if (on) next.add(docId);
      else next.delete(docId);
      return next;
    });
  }, []);
  /** Docs already warned about the autosave size cutoff — the notice shows
   *  once per document, not on every edit. */
  const autosaveLimitNotified = useRef(new Set<string>());
  /**
   * Persistence deliberately skips documents over `MAX_PERSIST_BYTES` — tell
   * the user once per document instead of silently losing crash recovery.
   */
  const noteAutosaveSkipped = useCallback(
    (id: string, result: PersistResult) => {
      if (result !== "too-large" || autosaveLimitNotified.current.has(id)) return;
      autosaveLimitNotified.current.add(id);
      toast.info(
        `This document is larger than ${Math.round(MAX_PERSIST_BYTES / (1024 * 1024))} MB — autosave and crash recovery are disabled for it.`,
        {
          description: "Your edits still work normally; save to keep them.",
          duration: 8000,
        },
      );
    },
    [],
  );
  /**
   * Persist working bytes for a doc — but never write a decrypted copy of a
   * protected document to IndexedDB. Its restore record stays the protected
   * form written at open/protect/save time, so a session restore re-prompts
   * for the password instead of silently opening a decrypted copy.
   */
  const persistWorking = useCallback(
    (id: string, name: string, bytes: Uint8Array) => {
      // encryptedAtOpen covers recipe-less protected docs (restrictions-only
      // files): their working bytes are decrypted, and persisting them would
      // hand a session restore an unprotected copy.
      if (protectionInfo.current.has(id) || encryptedAtOpen.current.has(id))
        return;
      const current = docsRef.current.find((doc) => doc.id === id);
      void persistDoc({
        id,
        name,
        sourceKey: current?.sourceKey,
        bytes,
        ...(current?.annotations ? { annotations: current.annotations } : {}),
        lastOpened: Date.now(),
        open: true,
      }).then((result) => noteAutosaveSkipped(id, result));
    },
    [noteAutosaveSkipped],
  );

  // Overlay-annotation autosave: bytes-only persistence would lose imported
  // (and freshly authored) markup on a session restore, so annotation changes
  // debounce into the doc's stored record. Protected docs are excluded — their
  // record keeps the protected on-disk form and never stores overlay content.
  useEffect(() => {
    if (!active) return;
    if (
      protectionInfo.current.has(active.id) ||
      encryptedAtOpen.current.has(active.id)
    )
      return;
    const { id, annotations } = active;
    const t = setTimeout(() => {
      void persistAnnotations(id, annotations);
    }, 1200);
    return () => clearTimeout(t);
    // Keyed on the map identity — every overlay edit replaces it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.annotations]);

  const refreshRecent = useCallback(async () => {
    const stored = await listStoredDocs();
    recoverableIds.current = new Set(stored.map((item) => item.id));
    setRecentFiles((previous) => {
      const previousById = new Map(previous.map((item) => [item.id, item]));
      const storedById = new Map(stored.map((item) => [item.id, item]));
      const live = docsRef.current.map((doc) => {
        const saved = storedById.get(doc.id);
        const optimistic = previousById.get(doc.id);
        return {
          id: doc.id,
          name: doc.name,
          sourceKey: doc.sourceKey,
          lastOpened: saved?.lastOpened ?? optimistic?.lastOpened ?? Date.now(),
          open: true,
        };
      });
      const liveIds = new Set(live.map((item) => item.id));
      const candidates = [
        ...live,
        ...stored
          .filter((item) => !liveIds.has(item.id))
          .map((item) => ({
            id: item.id,
            name: item.name,
            sourceKey: item.sourceKey,
            lastOpened: item.lastOpened,
            open: item.open,
          })),
      ];
      const seen = new Set<string>();
      const deduplicated = candidates.filter((item) => {
        const identity = item.sourceKey ?? `record:${item.id}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
      // Activity changes timestamps, not layout. Preserve every existing row's
      // visual position and add genuinely new records ahead of that stable
      // order. Active styling is driven separately by `activeTabId`.
      const byId = new Map(deduplicated.map((item) => [item.id, item]));
      const previousIds = new Set(previous.map((item) => item.id));
      return [
        ...deduplicated.filter((item) => !previousIds.has(item.id)),
        ...previous.flatMap((item) => {
          const refreshed = byId.get(item.id);
          return refreshed ? [refreshed] : [];
        }),
      ];
    });
  }, []);

  // Keep only a small warm set of parsed PDF engines. Every open document
  // remains in `recentFiles`; selecting an unloaded entry restores it lazily
  // from its verified recovery snapshot. Dirty/protected/visible documents
  // are never evicted.
  useEffect(() => {
    const excess = docs.length - MAX_WARM_DOCS;
    if (excess <= 0) return;
    const visible = new Set([
      ...(activeTabId ? [activeTabId] : []),
      ...panes.map((pane) => pane.docId),
    ]);
    const candidates = docs
      .filter(
        (doc) =>
          !visible.has(doc.id) &&
          recoverableIds.current.has(doc.id) &&
          !docHasEdits(doc) &&
          !pendingPdfEdits.current.has(doc.id) &&
          !protectionInfo.current.has(doc.id) &&
          !encryptedAtOpen.current.has(doc.id),
      )
      .sort((a, b) => a.lastAccessed - b.lastAccessed)
      .slice(0, excess);
    if (!candidates.length) return;
    const evicted = new Set(candidates.map((doc) => doc.id));
    for (const doc of candidates) destroyDocProxies(doc);
    setDocs((prev) => prev.filter((doc) => !evicted.has(doc.id)));
  }, [docs, activeTabId, panes, recentFiles, protectedIds]);

  const activateLoadedDoc = useCallback(
    (id: string) => {
      const accessedAt = Date.now();
      setDocs((prev) =>
        prev.map((doc) =>
          doc.id === id ? { ...doc, lastAccessed: accessedAt } : doc,
        ),
      );
      setRecentFiles((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, lastOpened: accessedAt, open: true }
            : item,
        ),
      );
      void touchStoredDoc(id, accessedAt);
      if (panes.length > 0) {
        const inPane = panes.find((p) => p.docId === id);
        if (inPane) {
          setActivePaneId(inPane.id);
        } else if (activePaneId) {
          setPanes((prev) =>
            prev.map((p) => (p.id === activePaneId ? { ...p, docId: id } : p)),
          );
        }
      }
      if (id !== activeTabId) {
        setActiveTabId(id);
        setDocVersion((v) => v + 1);
        resetTransient();
      }
      setScreen("viewer");
    },
    [panes, activePaneId, activeTabId, resetTransient],
  );

  const docIdForHandle = useCallback(async (handle: any): Promise<string | null> => {
    if (!handle || typeof handle.isSameEntry !== "function") return null;
    for (const [id, existing] of docHandles.current) {
      if (!existing || typeof existing.isSameEntry !== "function") continue;
      try {
        if (await handle.isSameEntry(existing)) return id;
      } catch {
        /* a revoked handle simply cannot participate in identity matching */
      }
    }
    return null;
  }, []);

  const openBytesInternal = useCallback(
    async (
      bytes: Uint8Array,
      name: string,
      id?: string,
      persist = true,
      storedAnnotations?: AnnotationMap,
      sourceKey?: string,
    ): Promise<string | null> => {
      if (sourceKey) {
        const existing = docsRef.current.find((doc) => doc.sourceKey === sourceKey);
        if (existing) {
          activateLoadedDoc(existing.id);
          return existing.id;
        }
      }
      try {
        let pdfDoc = await loadPdf(bytes);
        let realBytes = bytes;
        let wrapperPw: string | null = null;
        let openedStandardEncryption: {
          recipe: EncryptRecipe | null;
          ownerUnlocked: boolean;
        } | null = null;

        // PickPDF-locked wrapper? The visible page is just a notice; the real
        // document is an AES-256-GCM payload attached to it. Prompt and unwrap.
        const payload = pdfDoc.getAttachment("pickpdf-protected.bin");
        if (payload) {
          const { decryptPayload, isProtectedPayload } = await import(
            "./lib/protected"
          );
          if (isProtectedPayload(payload)) {
            for (let attempt = 0; ; attempt++) {
              const input = await requestPassword({
                title: "Locked to PickPDF",
                message: `“${name}” is locked to PickPDF. Enter its password to open it.`,
                error: attempt > 0 ? "Wrong password — try again." : undefined,
              });
              if (input === null) {
                await pdfDoc.destroy();
                // A cancelled unlock must not leave the doc lingering as "open"
                // in persistence — otherwise it can't be closed from the
                // sidebar and its dialog re-appears on every session restore.
                // Demote the persisted record to recently-closed.
                if (id) void markDocClosed(id).then(refreshRecent);
                return null;
              }
              try {
                realBytes = await decryptPayload(payload, input);
                wrapperPw = input;
                break;
              } catch {
                if (attempt >= 3) {
                  await pdfDoc.destroy();
                  toast.error("Too many wrong password attempts");
                  if (id) void markDocClosed(id).then(refreshRecent);
                  return null;
                }
              }
            }
            await pdfDoc.destroy();
            pdfDoc = await loadPdf(realBytes);
          }
        }

        // Standard encryption must be removed through an authenticated
        // PDFium owner session before any editor path sees the bytes. pdf-lib's
        // `ignoreEncryption` option is not decryption and can corrupt output.
        // A user-password-only open therefore stays read-only until the owner
        // password is supplied in Document security.
        if (!wrapperPw && pdfDoc.isEncrypted()) {
          const ownerUnlocked = pdfDoc.isOwnerUnlocked();
          openedStandardEncryption = {
            recipe: recipeForOpenedDoc({
              password: pdfDoc.password,
              ownerUnlocked,
              userPermissions: pdfDoc.getUserPermissions(),
            }),
            ownerUnlocked,
          };
          if (ownerUnlocked) {
            const { decryptPdf } = await import("./lib/pdfium");
            const plainBytes = await decryptPdf(realBytes, pdfDoc.password);
            await pdfDoc.destroy();
            realBytes = plainBytes;
            pdfDoc = await loadPdf(realBytes);
          }
        }

        // Round-trip: absorb the file's standard markup annotations (ours
        // from a previous save, or Acrobat/Foxit ones) into the editable
        // overlay, stripping the source dicts so nothing renders twice.
        // `storedAnnotations` seeds the overlay on session restore — those
        // stored bytes are already stripped, so the import finds nothing and
        // this stays idempotent. Skipped while encrypted (the reprotect flow
        // owns those bytes); annotimport itself refuses signed documents.
        const overlaySeed: AnnotationMap = {};
        for (const [p, list] of Object.entries(storedAnnotations ?? {})) {
          if (list.length) overlaySeed[Number(p)] = [...list];
        }
        // Persisted plain documents already have their source annotations
        // stripped and their editable overlay stored separately. Re-running
        // pdf-lib's full-document import here delays large sidebar opens for
        // work that cannot find anything. Protected, new, and legacy records
        // omit storedAnnotations and still take the import path below.
        if (!pdfDoc.isEncrypted() && storedAnnotations === undefined) {
          try {
            const { importAnnotations } = await import("./lib/annotimport");
            const imported = await importAnnotations(realBytes);
            if (imported) {
              for (const [p, list] of Object.entries(imported.annotations)) {
                const k = Number(p);
                overlaySeed[k] = [...(overlaySeed[k] ?? []), ...list];
              }
              await pdfDoc.destroy();
              realBytes = imported.cleanedBytes;
              pdfDoc = await loadPdf(realBytes);
              toast.info(
                `${imported.count} ${imported.count === 1 ? "annotation" : "annotations"} imported for editing`,
                {
                  description:
                    "The document's highlights, comments and shapes are now editable objects. Saving writes them back as real annotations.",
                  duration: 6000,
                },
              );
            }
          } catch {
            /* best-effort — the doc opens with its annotations read-only, as before */
          }
        }

        const doc: OpenDoc = {
          id: id ?? uid(),
          name,
          sourceKey,
          lastAccessed: Date.now(),
          bytes: realBytes,
          pdf: pdfDoc,
          annotations: overlaySeed,
          history: [overlaySeed],
          bytesHistory: [{ bytes: realBytes, pdf: pdfDoc }],
          historyIndex: 0,
          currentPage: 0,
          formValues: {},
          fieldOps: {},
          savedState: {
            bytes: realBytes,
            annotations: overlaySeed,
            formValues: {},
            fieldOps: {},
          },
          rev: freshRevision(),
        };
        if (wrapperPw) {
          protectionInfo.current.set(doc.id, {
            kind: "wrapper",
            password: wrapperPw,
          });
          markProtected(doc.id, true);
          toast.success("PickPDF-locked document opened", {
            description: "Saving will keep it locked to PickPDF.",
            duration: 6000,
          });
        }
        // Standard-encrypted document: every edit path operates on decrypted
        // bytes and cannot re-emit the original encryption, so capture how to
        // re-protect it NOW, while the entered password is known. With a
        // recipe registered, protectForDisk re-encrypts every save/download;
        // without one (no password was typed — a restrictions-only file that
        // opens with an empty password), the write paths instead ask for
        // explicit consent before emitting an unprotected copy.
        if (openedStandardEncryption) {
          encryptedAtOpen.current.add(doc.id);
          const recipe = openedStandardEncryption.recipe;
          if (recipe) {
            protectionInfo.current.set(doc.id, recipe);
            markProtected(doc.id, true);
          }
        }
        const openedAt = Date.now();
        setDocs((prev) => [...prev.filter((d) => d.id !== doc.id), doc]);
        // The document is live now, so reflect it in the sidebar immediately.
        // IndexedDB persistence can take seconds for a large byte array and is
        // deliberately kept off the visible-open critical path.
        setRecentFiles((prev) => [
          {
            id: doc.id,
            name: doc.name,
            sourceKey: doc.sourceKey,
            lastOpened: openedAt,
            open: true,
          },
          ...prev.filter(
            (recent) =>
              recent.id !== doc.id &&
              (!doc.sourceKey || recent.sourceKey !== doc.sourceKey),
          ),
        ]);
        setActiveTabId(doc.id);
        // In split view, show the newly opened document in the focused pane —
        // panes render from panes[].docId, so without this the new doc becomes
        // the active tab but is visible in neither pane (mirrors openRecent).
        if (activePaneId) {
          setPanes((prev) =>
            prev.map((p) => (p.id === activePaneId ? { ...p, docId: doc.id } : p)),
          );
        }
        setDocVersion((v) => v + 1);
        resetTransient();
        setScreen("viewer");
        // Tell the user up front when a document is protected and what it
        // restricts — otherwise the silently-disabled tools feel broken.
        if (openedStandardEncryption) {
          const denied = summarizeRestrictions(permissionsOf(pdfDoc));
          if (!openedStandardEncryption.ownerUnlocked) {
            toast.warning("Protected document — some actions are restricted", {
              description: `Not allowed: ${denied.join(", ")}. Unlock with the permissions password via File → Document security.`,
              action: {
                label: "Unlock",
                onClick: () => setSecurityModalOpen(true),
              },
              duration: 10000,
            });
          } else {
            toast.info("This document is encrypted", {
              description: protectionInfo.current.has(doc.id)
                ? "You hold full permissions on it. Saving keeps it password-protected."
                : "You hold full permissions on it.",
              duration: 5000,
            });
          }
        }
        if (persist) {
          // Protected docs persist their original protected form (restore
          // re-prompts and re-imports after unlock) and never store the
          // overlay — note text in IndexedDB would leak the locked content.
          // Plain docs persist the stripped bytes + the overlay, so the
          // imported annotations survive a session restore.
          const isProtected = wrapperPw !== null || openedStandardEncryption !== null;
          void persistDoc({
            id: doc.id,
            name,
            sourceKey,
            bytes: isProtected ? bytes : realBytes,
            ...(isProtected ? {} : { annotations: overlaySeed }),
            lastOpened: openedAt,
            open: true,
          }).then((result) => {
            noteAutosaveSkipped(doc.id, result);
            // A file that is too large for persistence (or hit a transient
            // storage error) is still open in this session and must stay in
            // the sidebar. Successful writes can reconcile/prune recents in
            // the background without delaying the optimistic entry above.
            if (result === "stored") return refreshRecent();
          });
        }
        // Offer OCR only for a genuine scan: essentially no extractable text
        // AND actual raster image content. A blank/vector page has neither, so
        // it must not be misdiagnosed as scanned.
        void extractAllText(pdfDoc)
          .then(async (textPages) => {
            const chars = textPages.reduce((n, p) => n + p.full.trim().length, 0);
            if (chars >= pdfDoc.numPages * 10) return;
            if (!(await hasRasterImages(pdfDoc))) return;
            toast("This looks like a scanned PDF", {
              description:
                "Run OCR to make its text searchable, selectable and AI-readable.",
              action: {
                label: "Run OCR",
                onClick: () => void runOcrRef.current?.(),
              },
              duration: 12000,
            });
          })
          .catch(() => {});
        return doc.id;
      } catch (err) {
        if ((err as Error)?.message === "Password required") {
          // Cancelled a standard-encrypted doc's unlock prompt — don't leave it
          // lingering as "open" (mirrors the wrapper-cancel path above).
          if (id) void markDocClosed(id).then(refreshRecent);
        } else {
          toast.error(
            `Could not open PDF: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
        return null;
      }
    },
    [
      resetTransient,
      refreshRecent,
      markProtected,
      requestPassword,
      noteAutosaveSkipped,
      activePaneId,
      activateLoadedDoc,
    ],
  );

  const openBytes = useCallback(
    (bytes: Uint8Array, name: string) => openBytesInternal(bytes, name),
    [openBytesInternal],
  );

  const openFile = useCallback(
    async (file: File, handle?: unknown): Promise<string | null> => {
      const handleMatch = await docIdForHandle(handle);
      if (handleMatch && docsRef.current.some((doc) => doc.id === handleMatch)) {
        activateLoadedDoc(handleMatch);
        return handleMatch;
      }

      const sourceKey = fileSourceKey(file);
      const existing = docsRef.current.find((doc) => doc.sourceKey === sourceKey);
      if (existing) {
        if (handle) docHandles.current.set(existing.id, handle);
        activateLoadedDoc(existing.id);
        return existing.id;
      }

      // A clean inactive document may have had its PDF engine unloaded. Its
      // session record still owns the source identity, so restore that record
      // instead of creating a duplicate document ID.
      const storedMatch = (await listStoredDocs()).find(
        (doc) => doc.open && doc.sourceKey === sourceKey,
      );
      if (storedMatch) {
        const stored = await getStoredDoc(storedMatch.id);
        if (stored) {
          if (handle) docHandles.current.set(stored.id, handle);
          return openBytesInternal(
            stored.bytes,
            stored.name,
            stored.id,
            true,
            stored.annotations,
            stored.sourceKey ?? sourceKey,
          );
        }
      }

      const pending = openingSources.current.get(sourceKey);
      if (pending) {
        const id = await pending;
        if (id && handle) docHandles.current.set(id, handle);
        if (id) activateLoadedDoc(id);
        return id;
      }

      const opening = (async () => {
        const buf = new Uint8Array(await file.arrayBuffer());
        return openBytesInternal(buf, file.name, undefined, true, undefined, sourceKey);
      })();
      openingSources.current.set(sourceKey, opening);
      try {
        const id = await opening;
        if (id && handle) docHandles.current.set(id, handle);
        return id;
      } finally {
        if (openingSources.current.get(sourceKey) === opening) {
          openingSources.current.delete(sourceKey);
        }
      }
    },
    [activateLoadedDoc, docIdForHandle, openBytesInternal],
  );

  const openFolder = useCallback(async () => {
    setFolderBusy(true);
    try {
      const root = await pickFolder();
      if (root) setFolderRoot(root);
    } catch (err) {
      toast.error(
        `Could not open folder: ${err instanceof Error ? err.message : "error"}`,
      );
    } finally {
      setFolderBusy(false);
    }
  }, []);

  const closeFolder = useCallback(() => setFolderRoot(null), []);

  const registerFileHandle = useCallback((id: string, handle: unknown) => {
    docHandles.current.set(id, handle);
  }, []);

  const openTreeFile = useCallback(
    async (node: FolderNode) => {
      if (node.kind !== "file") return;
      try {
        const { file, handle } = await readNode(node);
        await openFile(file, handle);
      } catch (err) {
        toast.error(
          `Could not open ${node.name}: ${err instanceof Error ? err.message : "error"}`,
        );
      }
    },
    [openFile],
  );

  const requestOpen = useCallback(async () => {
    const picker = (window as any).showOpenFilePicker;
    if (!picker) {
      document.getElementById("global-open-input")?.click();
      return;
    }
    try {
      const handles = await picker.call(window, {
        multiple: true,
        types: [
          { description: "PDF documents", accept: { "application/pdf": [".pdf"] } },
        ],
      });
      for (const handle of handles) {
        const file = await handle.getFile();
        await openFile(file, handle);
      }
    } catch {
      /* user cancelled the picker */
    }
  }, [openFile]);

  // Peek whether stored bytes need a password to open — WITHOUT prompting for
  // one. Covers both lock types so session restore can defer the dialog:
  //   • standard-encrypted PDFs (non-empty user password) — PdfDoc.load throws
  //     PasswordError; we must NOT use loadPdf() here, which would prompt.
  //   • PickPDF-locked wrappers — open fine, but carry the encrypted payload.
  // A doc encrypted with an EMPTY user password (owner-only restrictions) opens
  // without a prompt, so it returns false and restores normally.
  const needsPasswordToOpen = useCallback(async (bytes: Uint8Array) => {
    const engine = await import("./lib/engine");
    let pdfDoc: PdfDoc;
    try {
      pdfDoc = await engine.PdfDoc.load(bytes, "");
    } catch (err) {
      // Encrypted with a real user password — defer to lazy unlock.
      return err instanceof engine.PasswordError;
    }
    try {
      const payload = pdfDoc.getAttachment("pickpdf-protected.bin");
      if (!payload) return false;
      const { isProtectedPayload } = await import("./lib/protected");
      return isProtectedPayload(payload);
    } catch {
      return false;
    } finally {
      await pdfDoc.destroy();
    }
  }, []);

  // Restore the last session: open ONLY the most-recently-active document into
  // the viewer. The other still-"open" docs stay as sidebar entries and load
  // lazily when the user activates them. Opening every one would flash the
  // viewer through each in turn and, with many tabs, load dozens of PDFs into
  // memory on startup.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      try {
        const stored = await listStoredDocs();
      // Metadata is cheap: render the complete session immediately. Reading
      // and parsing the active PDF happens afterward and must not hold the
      // sidebar in its loading state.
      await refreshRecent();
      setRecentLoading(false);
        const active = stored
          .filter((d) => d.open)
          .sort((a, b) => b.lastOpened - a.lastOpened)[0];
        const activeDoc = active ? await getStoredDoc(active.id) : undefined;
      // Skip auto-open when the active doc is locked (PickPDF wrapper or
      // standard-encrypted) — it would pop a password dialog on startup. It
      // unlocks lazily when the user activates it.
        if (activeDoc && !(await needsPasswordToOpen(activeDoc.bytes))) {
          await openBytesInternal(
            activeDoc.bytes,
            activeDoc.name,
            activeDoc.id,
            true,
            activeDoc.annotations,
            activeDoc.sourceKey ?? legacyBytesSourceKey(activeDoc.name, activeDoc.bytes),
          );
        }
      } catch (error) {
        // A damaged/unavailable recent-files database must not leave the whole
        // application in a permanent startup state.
        console.error("Could not restore the previous session:", error);
        setRecentLoading(false);
      } finally {
        // AiPanel is keyed by activeTabId to keep chats document-scoped. Do not
        // let it start work until that id is stable, otherwise session restore
        // remounts the panel and aborts the first model request.
        setSessionRestoring(false);
      }
    })();
  }, [openBytesInternal, refreshRecent, needsPasswordToOpen]);

  const openRecent = useCallback(
    async (id: string) => {
      const existing = docs.find((d) => d.id === id);
      if (existing) {
        activateLoadedDoc(existing.id);
        return;
      }
      const stored = await getStoredDoc(id);
      if (!stored) {
        toast.error("File is no longer available");
        void refreshRecent();
        return;
      }
      await openBytesInternal(
        stored.bytes,
        stored.name,
        stored.id,
        true,
        stored.annotations,
        stored.sourceKey ?? legacyBytesSourceKey(stored.name, stored.bytes),
      );
    },
    [docs, activateLoadedDoc, openBytesInternal, refreshRecent],
  );

  const removeRecent = useCallback(
    async (id: string) => {
      const target = recentFiles.find((recent) => recent.id === id);
      if (!target || target.open) return;
      setRecentFiles((prev) => prev.filter((recent) => recent.id !== id));

      // Remove hidden legacy duplicates for the same source too, otherwise a
      // duplicate record could reappear on the next refresh.
      const stored = await listStoredDocs();
      const ids = stored
        .filter((doc) => {
          if (doc.open) return false;
          return target.sourceKey
            ? doc.sourceKey === target.sourceKey
            : doc.id === id;
        })
        .map((doc) => doc.id);
      const removed = await removeStoredDocs(ids.length ? ids : [id]);
      if (!removed) {
        toast.error("Could not remove the recent item");
        await refreshRecent();
      }
    },
    [recentFiles, refreshRecent],
  );

  const clearRecent = useCallback(async () => {
    if (!recentFiles.some((recent) => !recent.open)) return;
    setRecentFiles((prev) => prev.filter((recent) => recent.open));
    const stored = await listStoredDocs();
    const removed = await removeStoredDocs(
      stored.filter((doc) => !doc.open).map((doc) => doc.id),
    );
    if (!removed) {
      toast.error("Could not clear recent items");
      await refreshRecent();
    }
  }, [recentFiles, refreshRecent]);

  const switchTab = useCallback(
    (id: string) => activateLoadedDoc(id),
    [activateLoadedDoc],
  );

  const closeTab = useCallback(
    async (id: string) => {
      const doc = docs.find((d) => d.id === id);
      if (!doc) {
        // Phantom entry: persisted as open but never loaded (e.g. a protected
        // doc whose password prompt was cancelled). Still let the user clear it
        // from the sidebar and drop any stale protection state.
        protectionInfo.current.delete(id);
        encryptedAtOpen.current.delete(id);
        markProtected(id, false);
        docHandles.current.delete(id);
        void markDocClosed(id).then(refreshRecent);
        return;
      }
      if (docHasEdits(doc)) {
        const ok = await requestConfirm({
          title: "Unsaved edits",
          message: `“${doc.name}” has unsaved edits. Close it anyway?`,
          confirmLabel: "Close anyway",
          tone: "danger",
        });
        if (!ok) return;
      }
      const pending = pendingPdfEdits.current.get(id);
      if (pending && !pending.running) {
        if (pending.timer) clearTimeout(pending.timer);
        pendingPdfEdits.current.delete(id);
        pending.resolve();
      }
      doc.pdf.destroy().catch(() => {});
      setDocs((prev) => {
        const idx = prev.findIndex((d) => d.id === id);
        const next = prev.filter((d) => d.id !== id);
        if (id === activeTabId) {
          const neighbor = next[idx] ?? next[idx - 1] ?? null;
          setActiveTabId(neighbor?.id ?? null);
        }
        return next;
      });
      // Drop panes that referenced the closed doc; collapse if < 2 remain.
      setPanes((prev) => {
        const next = prev.filter((p) => p.docId !== id);
        if (next.length < 2) {
          setActivePaneId(null);
          return [];
        }
        return next;
      });
      setDocVersion((v) => v + 1);
      resetTransient();
      docHandles.current.delete(id);
      // Drop the cleartext protection secret + its reactive flag; don't leave a
      // closed document's password resident for the rest of the session.
      protectionInfo.current.delete(id);
      encryptedAtOpen.current.delete(id);
      markProtected(id, false);
      void markDocClosed(id).then(refreshRecent);
    },
    [docs, activeTabId, resetTransient, refreshRecent, markProtected, requestConfirm],
  );

  const closeAllTabs = useCallback(async () => {
    const openIds = new Set([
      ...recentFiles.filter((recent) => recent.open).map((recent) => recent.id),
      ...docs.map((doc) => doc.id),
    ]);
    if (openIds.size === 0) return;

    const editedDocs = docs.filter(docHasEdits);
    if (editedDocs.length > 0) {
      const label = editedDocs.length === 1 ? "document has" : "documents have";
      const ok = await requestConfirm({
        title: "Unsaved edits",
        message: `${editedDocs.length} ${label} unsaved edits. Close all documents anyway?`,
        confirmLabel: "Close all",
        tone: "danger",
      });
      if (!ok) return;
    }

    for (const id of openIds) {
      const pending = pendingPdfEdits.current.get(id);
      if (pending && !pending.running) {
        if (pending.timer) clearTimeout(pending.timer);
        pendingPdfEdits.current.delete(id);
        pending.resolve();
      }
      docHandles.current.delete(id);
      protectionInfo.current.delete(id);
      encryptedAtOpen.current.delete(id);
      markProtected(id, false);
    }
    for (const doc of docs) doc.pdf.destroy().catch(() => {});

    setDocs([]);
    setActiveTabId(null);
    setPanes([]);
    setActivePaneId(null);
    setRecentFiles((prev) =>
      prev.map((recent) =>
        openIds.has(recent.id) ? { ...recent, open: false } : recent,
      ),
    );
    setDocVersion((version) => version + 1);
    resetTransient();

    await Promise.all([...openIds].map((id) => markDocClosed(id)));
    await refreshRecent();
  }, [docs, recentFiles, markProtected, requestConfirm, resetTransient, refreshRecent]);

  const closeDocument = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const splitView = useCallback(() => {
    if (!activeTabId) return;
    setPanes((prev) => {
      if (prev.length === 0) {
        const p1 = uid();
        const p2 = uid();
        setActivePaneId(p1);
        return [
          { id: p1, docId: activeTabId },
          { id: p2, docId: activeTabId },
        ];
      }
      if (prev.length >= MAX_PANES) return prev;
      return [...prev, { id: uid(), docId: activeTabId }];
    });
    setScreen("viewer");
  }, [activeTabId]);

  const openInPane = useCallback(
    (docId: string) => {
      if (!docs.some((d) => d.id === docId) || !activeTabId) return;
      setPanes((prev) => {
        if (prev.length === 0) {
          const p1 = uid();
          const p2 = uid();
          setActivePaneId(p1);
          return [
            { id: p1, docId: activeTabId },
            { id: p2, docId },
          ];
        }
        if (prev.length >= MAX_PANES) return prev;
        return [...prev, { id: uid(), docId }];
      });
      setScreen("viewer");
    },
    [docs, activeTabId],
  );

  const focusPane = useCallback(
    (paneId: string) => {
      const pane = panes.find((item) => item.id === paneId);
      if (!pane) return;
      setActivePaneId(paneId);
      activateLoadedDoc(pane.docId);
    },
    [panes, activateLoadedDoc],
  );

  const closePane = useCallback((paneId: string) => {
    setPanes((prev) => {
      const next = prev.filter((p) => p.id !== paneId);
      if (next.length < 2) {
        const remain = next[0] ?? prev.find((p) => p.id !== paneId);
        if (remain) setActiveTabId(remain.docId);
        setActivePaneId(null);
        return [];
      }
      if (paneId === activePaneId) {
        setActivePaneId(next[0].id);
        setActiveTabId(next[0].docId);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaneId]);

  const exitSplit = useCallback(() => {
    setPanes([]);
    setActivePaneId(null);
  }, []);

  const printDoc = useCallback(
    async (docId: string) => {
      const d = docs.find((x) => x.id === docId);
      if (!d) return;
      if (!permissionsOf(d.pdf).print) {
        toast.error("This document's permissions don't allow printing.");
        return;
      }
      let bytes = d.bytes;
      // Bake only when OVERLAY edits exist — committed byte-level edits are
      // already in d.bytes, and baking is read-only (must not bump revisions).
      if (docHasOverlayEdits(d)) {
        bytes = await bakeAnnotations(d.bytes, d.annotations, d.formValues, d.fieldOps);
      }
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      iframe.src = url;
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
        }, 60_000);
      };
      document.body.appendChild(iframe);
    },
    [docs],
  );

  const docById = useCallback(
    (id: string) => {
      const d = docs.find((x) => x.id === id);
      if (!d) return null;
      return { id: d.id, name: d.name, pdf: d.pdf, numPages: d.pdf.numPages };
    },
    [docs],
  );

  const setFormValue = useCallback(
    (name: string, value: unknown) => {
      if (!activeTabId) return;
      // Honor the fill-forms permission — announced restrictions must actually
      // bind, not just grey out the form-designer tools.
      const perms = docPermissionsRef.current;
      if (perms.restricted && !perms.fillForms) {
        toast.error(
          "This document's permissions don't allow filling form fields. Unlock with the permissions password (File → Document security).",
        );
        return;
      }
      updateDoc(activeTabId, (d) => ({
        formValues: { ...d.formValues, [name]: value },
        rev: bumpRevision(d.rev),
      }));
    },
    [activeTabId, updateDoc],
  );

  const setMeasureScale = useCallback(
    (s: MeasureScale | null) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        // Labels derive from each annotation's stored scale/unit at render
        // time, so recalibration must rewrite them (one undoable step) —
        // otherwise old measurements would keep reading in stale units.
        const scale = s?.scale ?? 1;
        const unit = s?.unit ?? "pt";
        let changed = false;
        const next: AnnotationMap = {};
        for (const [page, list] of Object.entries(d.annotations)) {
          next[Number(page)] = list.map((a) => {
            if (a.kind !== "measure" || (a.scale === scale && a.unit === unit)) {
              return a;
            }
            changed = true;
            return { ...a, scale, unit };
          });
        }
        return changed
          ? { measureScale: s, ...pushHistory(d, next) }
          : { measureScale: s };
      });
    },
    [activeTabId, updateDoc],
  );

  const upsertFieldOp = useCallback(
    (
      base: Pick<ExistingFieldOp, "key" | "fieldName" | "pageIndex" | "origRect">,
      patch: Partial<ExistingFieldOp>,
    ) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const existing = d.fieldOps[base.key] ?? base;
        const merged = { ...existing, ...patch };
        // An op that changes nothing anymore can be dropped.
        const isNoop = !merged.newRect && !merged.deleted && !merged.newName;
        // Dropping an op that was never stored changes nothing — don't dirty.
        if (isNoop && !(base.key in d.fieldOps)) return {};
        const next = { ...d.fieldOps };
        if (isNoop) delete next[base.key];
        else next[base.key] = merged as ExistingFieldOp;
        return { fieldOps: next, rev: bumpRevision(d.rev) };
      });
    },
    [activeTabId, updateDoc],
  );

  const bakeToBytes = useCallback(async (): Promise<Uint8Array | null> => {
    if (!active) return null;
    await flushPdfEditsRef.current(active.id);
    const current = docsRef.current.find((doc) => doc.id === active.id);
    if (!current) return null;
    // Byte-level edits are already committed to active.bytes — only overlay
    // edits still need baking. Read-only: never bumps the revision.
    if (!docHasOverlayEdits(current)) return current.bytes;
    return bakeAnnotations(
      current.bytes,
      current.annotations,
      current.formValues,
      current.fieldOps,
    );
  }, [active]);

  const applyBytesOp = useCallback(
    async (op: (bytes: Uint8Array) => Promise<Uint8Array>, label: string) => {
      if (!active) return;
      const id = active.id;
      // Structural ops (rotate/delete/reorder pages) mutate document content
      // and require a verified plaintext working copy for protected files.
      // Honor the modify permission like the edit tools.
      if (docPermissionsRef.current.restricted && !docPermissionsRef.current.modify) {
        toast.error(
          "This document's permissions don't allow changing its pages. Unlock with the permissions password (File → Document security).",
        );
        return;
      }
      try {
        await flushPdfEditsRef.current(id);
        const current = docsRef.current.find((doc) => doc.id === id);
        if (!current) return;
        let base = current.bytes;
        if (docHasOverlayEdits(current)) {
          base = await bakeAnnotations(
            current.bytes,
            current.annotations,
            current.formValues,
            current.fieldOps,
          );
          toast.info("Pending edits were saved into the document first.");
        }
        const nextBytes = await op(base);
        const nextPdf = await loadPdf(nextBytes);
        destroyDocProxies(current, nextPdf);
        updateDoc(id, (d) => ({
          bytes: nextBytes,
          pdf: nextPdf,
          annotations: {},
          history: [{}],
          bytesHistory: [{ bytes: nextBytes, pdf: nextPdf }],
          historyIndex: 0,
          formValues: {},
          fieldOps: {},
          // A committed byte-level edit: the doc no longer matches the file
          // on disk even though the overlay maps were just cleared.
          rev: bumpBytesRevision(d.rev),
        }));
        setDocVersion((v) => v + 1);
        setSelected(null);
        persistWorking(id, current.name, nextBytes);
        toast.success(label);
      } catch (err) {
        toast.error(
          `${label} failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    },
    [active, updateDoc, persistWorking],
  );

  /** Read the editable text runs on a page (via PDFium), for hit-testing. */
  const getPageTextObjects = useCallback(
    async (pageIndex: number) => {
      if (!active) return [];
      return active.pdf.getTextObjects(pageIndex);
    },
    [active],
  );

  /** Read the movable objects (text + images) on a page, for the object tool.
   *  Reads from the LIVE document handle — no whole-document reparse. */
  const getPageObjects = useCallback(
    async (pageIndex: number) => {
      if (!active) return [];
      return active.pdf.getPageObjects(pageIndex);
    },
    [active],
  );

  /** Flush one document's optimistic journal. New operations arriving while a
   * worker is busy join the same drain and the live preview remains untouched
   * until the final byte snapshot is ready. */
  const flushPendingPdfEdits = useCallback(
    (id: string): Promise<void> => {
      const state = pendingPdfEdits.current.get(id);
      if (!state) return Promise.resolve();
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.running) return state.promise;
      state.running = true;
      void (async () => {
        try {
          for (;;) {
            if (state.cancelled) return;
            const operations = state.operations;
            state.operations = [];
            if (operations.length) {
              state.latestBytes = await editPdfsInBackground(
                state.latestBytes,
                operations,
              );
              if (state.cancelled) return;
              continue;
            }

            const current = docsRef.current.find((doc) => doc.id === id);
            if (!current) {
              pendingPdfEdits.current.delete(id);
              state.resolve();
              return;
            }
            // Object moves/styles/deletes and basic text replacement already
            // exist exactly in the live proxy. Commit only the bytes: swapping
            // and repainting that proxy would add a visible post-edit hitch.
            if (!state.requiresReload) {
              startTransition(() => {
                updateDocImmediately(id, (d) =>
                  pushBackgroundContentEdit(d, state.latestBytes, d.pdf, false),
                );
              });
              pendingPdfEdits.current.delete(id);
              persistWorking(id, current.name, state.latestBytes);
              state.resolve();
              return;
            }

            const nextPdf = await loadPdf(state.latestBytes);
            if (state.cancelled) {
              nextPdf.destroy().catch(() => {});
              return;
            }
            // An edit may have landed while the fresh proxy was loading. Keep
            // the optimistic proxy visible and continue the same journal.
            if (state.operations.length) {
              nextPdf.destroy().catch(() => {});
              continue;
            }
            const previousPdf = current.pdf;
            updateDocImmediately(id, (d) =>
              pushBackgroundContentEdit(d, state.latestBytes, nextPdf, false),
            );
            if (
              previousPdf !== nextPdf &&
              !current.bytesHistory.some((baseState) => baseState.pdf === previousPdf)
            ) {
              previousPdf.destroy().catch(() => {});
            }
            pendingPdfEdits.current.delete(id);
            setContentRev((v) => v + 1);
            persistWorking(id, current.name, state.latestBytes);
            state.resolve();
            return;
          }
        } catch (cause) {
          if (state.cancelled) return;
          pendingPdfEdits.current.delete(id);
          const error = cause instanceof Error ? cause : new Error(String(cause));
          const current = docsRef.current.find((doc) => doc.id === id);
          if (current) {
            try {
              const restoredPdf = await loadPdf(current.bytes);
              const previewPdf = current.pdf;
              updateDoc(id, { pdf: restoredPdf });
              previewPdf.destroy().catch(() => {});
              setContentRev((v) => v + 1);
            } catch {
              // Keep the original error: it is the actionable failure.
            }
          }
          state.reject(error);
          toast.error(`Couldn't finish the PDF edit: ${error.message}`);
        }
      })();
      return state.promise;
    },
    [persistWorking, updateDoc, updateDocImmediately],
  );
  flushPdfEditsRef.current = flushPendingPdfEdits;

  /** Record a logical edit now and regenerate the PDF after a short idle. The
   * returned promise resolves immediately: UI controls never wait on PDFium. */
  const queuePdfEdit = useCallback(
    (operation: PdfEditOperation): Promise<void> => {
      if (!active) return Promise.resolve();
      const id = active.id;
      let state = pendingPdfEdits.current.get(id);
      if (!state) {
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((ok, fail) => {
          resolve = ok;
          reject = fail;
        });
        // Flush failures are reported by the store; prevent an unobserved idle
        // flush from becoming an unhandled rejection.
        void promise.catch(() => {});
        state = {
          operations: [],
          latestBytes: active.bytes,
          requiresReload: false,
          timer: null,
          running: false,
          cancelled: false,
          promise,
          resolve,
          reject,
        };
        pendingPdfEdits.current.set(id, state);
      }
      state.operations = appendPdfEdit(state.operations, operation);
      state.requiresReload ||=
        operation.type === "reflowTextLines" ||
        (operation.type === "styleTextRuns" &&
          (!!operation.style.font ||
            !!operation.style.fontScale ||
            !!operation.style.synthBold ||
            !!operation.style.synthItalic ||
            operation.runs.some((run) => run.text === "")));
      if (state.timer) clearTimeout(state.timer);
      if (!state.running) {
        state.timer = setTimeout(() => {
          state!.timer = null;
          void flushPendingPdfEdits(id);
        }, 450);
      }
      // Dirty state and undo-boundary ownership begin at interaction time. Any
      // retained proxy for current history bytes must be detached before the
      // live proxy is optimistically mutated further.
      updateDoc(id, (d) => ({
        bytesHistory: d.bytesHistory.map((base) =>
          base.pdf === d.pdf ? { bytes: base.bytes } : base,
        ),
        rev: bumpBytesRevision(d.rev),
      }));
      return Promise.resolve();
    },
    [active, flushPendingPdfEdits, updateDoc],
  );

  const redactCount = active
    ? Object.values(active.annotations)
        .flat()
        .filter((a) => a.kind === "redact").length
    : 0;

  /**
   * Destructively apply every pending redaction box: PDFium strips the covered
   * content from the page, paints a black box, then reopens the saved bytes to
   * verify nothing extractable remains (redactRegions throws otherwise —
   * failing closed). Only after verification are the boxes removed and the
   * base bytes swapped onto the undo timeline (still reversible via Ctrl+Z
   * within the session, but the saved file no longer holds the content). On
   * any failure the pending boxes are KEPT and the document is left unchanged.
   */
  const applyRedactions = useCallback(async () => {
    if (!active) return;
    const id = active.id;
    const boxes = Object.values(active.annotations)
      .flat()
      .filter((a) => a.kind === "redact");
    if (!boxes.length) {
      toast.info("Draw one or more redaction boxes first.");
      return;
    }
    const ok = await requestConfirm({
      title: `Apply ${boxes.length} redaction ${boxes.length === 1 ? "box" : "boxes"}?`,
      message:
        "Permanently deleted from the document: text under each box (including form-field text), any image a box touches (the whole image is removed), and vector graphics fully inside a box. A black box is painted over each area, and the result is verified before it is kept.\n\n" +
        "Not removed: comments/annotations and document metadata — review those separately if they may contain sensitive content.",
      confirmLabel: "Apply redactions",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { applyRedactions: apply } = await import("./lib/pdftools");
      const nextBytes = await apply(active.bytes, active.annotations);
      // Verification passed inside redactRegions — only now drop the applied
      // redaction boxes, keeping every other annotation.
      const nextPdf = await loadPdf(nextBytes);
      const nextAnns: AnnotationMap = {};
      for (const [page, list] of Object.entries(active.annotations)) {
        const kept = list.filter((a) => a.kind !== "redact");
        if (kept.length) nextAnns[Number(page)] = kept;
      }
      updateDoc(id, (d) =>
        pushHistory(d, nextAnns, { bytes: nextBytes, pdf: nextPdf }),
      );
      setSelected(null);
      persistWorking(id, active.name, nextBytes);
      toast.success(
        `Redacted ${boxes.length} ${boxes.length === 1 ? "region" : "regions"} — verified: no extractable text or images remain in the redacted areas`,
      );
    } catch (err) {
      // Fail closed: the document was not changed and the boxes stay pending.
      toast.error(
        `${err instanceof Error ? err.message : "Redaction failed: unknown error"}. The document was NOT changed and your redaction boxes were kept.`,
      );
    }
  }, [active, updateDoc, persistWorking, requestConfirm]);

  /**
   * True in-place text edit: rewrite the content-stream text object via PDFium,
   * keeping its font/size/color/position — no whiteout, no overlay copy, and
   * the original text is genuinely replaced.
   */
  const applyTextEdit = useCallback(
    async (pageIndex: number, objectIndex: number, newText: string) => {
      if (!active) return;
      await queuePdfEdit({
        type: "editTextObject",
        pageIndex,
        objectIndex,
        newText,
      });
      active.pdf.previewSetText(pageIndex, objectIndex, newText);
      setContentRev((v) => v + 1);
      // A text edit is one completed interaction, not a drag stream: persist
      // it immediately instead of paying the generic 450 ms batching delay.
      void flushPendingPdfEdits(active.id);
    },
    [active, flushPendingPdfEdits, queuePdfEdit],
  );

  /**
   * In-place edit of a whole visual line: per-run text changes plus line-wide
   * color / size / synthesized bold-italic / font replacement.
   */
  const applyTextRuns = useCallback(
    async (pageIndex: number, runs: TextRunEdit[], style: PdfiumLineStyle) => {
      if (!active) {
        return { previewed: true, settled: Promise.resolve() };
      }
      await queuePdfEdit({ type: "styleTextRuns", pageIndex, runs, style });
      // Common in-place text and color changes can be previewed directly. Font
      // replacement/reflow still finishes in the worker, without blocking UI.
      if (!style.font) {
        previewTextRuns(active.pdf, pageIndex, runs, style.fill);
        setContentRev((v) => v + 1);
      }
      const committed = flushPendingPdfEdits(active.id);
      const needsFinalRenderer =
        !!style.font ||
        !!style.fontScale ||
        !!style.synthBold ||
        !!style.synthItalic;
      // Keep the natural inline preview over the page only for edits the live
      // renderer cannot represent exactly. Basic text/color edits close now.
      void committed;
      return { previewed: !needsFinalRenderer, settled: committed };
    },
    [active, flushPendingPdfEdits, queuePdfEdit],
  );

  /**
   * Paragraph reflow: rewrite the paragraph's line layout after an edit that
   * moved words across lines (lines rewritten/removed, new lines created).
   */
  const applyTextReflow = useCallback(
    async (pageIndex: number, spec: ReflowSpec) => {
      if (!active) {
        return { previewed: true, settled: Promise.resolve() };
      }
      await queuePdfEdit({ type: "reflowTextLines", pageIndex, spec });
      // Reflow creates/removes line objects and has no exact live-preview
      // equivalent. Flush now while the committed textarea remains visible.
      const settled = flushPendingPdfEdits(active.id);
      void settled;
      return { previewed: false, settled };
    },
    [active, flushPendingPdfEdits, queuePdfEdit],
  );

  /** The base name + decoded program of the font behind a text run. */
  const getTextFontInfo = useCallback(
    async (pageIndex: number, objectIndex: number) => {
      if (!active) return null;
      return active.pdf.getFontInfo(pageIndex, objectIndex);
    },
    [active],
  );

  /** Move/resize an existing object (text or image) via an affine transform. */
  const applyObjectTransform = useCallback(
    async (pageIndex: number, objectIndex: number, m: PdfiumMatrix) => {
      if (!active) return;
      await queuePdfEdit({
        type: "transformObject",
        pageIndex,
        objectIndex,
        matrix: m,
      });
      active.pdf.previewTransformObject(pageIndex, objectIndex, m);
      setContentRev((v) => v + 1);
    },
    [active, queuePdfEdit],
  );

  /** Delete an existing object (text, image or path) from the page. */
  const removeObjectAt = useCallback(
    async (pageIndex: number, objectIndex: number) => {
      if (!active) return;
      await queuePdfEdit({ type: "removeObject", pageIndex, objectIndex });
      active.pdf.previewRemoveObject(pageIndex, objectIndex);
      setContentRev((v) => v + 1);
    },
    [active, queuePdfEdit],
  );

  /** Restyle an existing object's fill/stroke color and/or stroke width. */
  const applyObjectStyle = useCallback(
    async (pageIndex: number, objectIndex: number, style: PdfiumObjectStyle) => {
      if (!active) return;
      await queuePdfEdit({ type: "setObjectStyle", pageIndex, objectIndex, style });
      active.pdf.previewSetObjectStyle(pageIndex, objectIndex, style);
      setContentRev((v) => v + 1);
    },
    [active, queuePdfEdit],
  );

  /**
   * Apply a document's protection recipe to `bytes` before they touch disk or
   * IndexedDB. Standard-encrypt re-applies AES-256; PickPDF-lock re-wraps.
   * Returns the input unchanged when the doc has no recipe AND wasn't
   * encrypted when it was opened. This is the single choke point that keeps
   * every write/persist path from leaking a decrypted copy of a protected
   * document — and it never lets an originally-encrypted document be written
   * unprotected without explicit consent (throws ProtectionDeclinedError when
   * the user says no).
   */
  const protectForDisk = useCallback(
    async (docId: string, bytes: Uint8Array, name: string): Promise<Uint8Array> => {
      const recipe = protectionInfo.current.get(docId);
      if (recipe?.kind === "encrypt") {
        try {
          const { encryptPdf } = await import("./lib/pdfium");
          return await encryptPdf(bytes, {
            userPassword: recipe.userPassword,
            ownerPassword: recipe.ownerPassword,
            permissions: recipe.permissions,
          });
        } catch (err) {
          // Re-encryption failed — never fall through to plain bytes quietly;
          // that would strip the document's protection behind the user's back.
          const ok = await requestConfirm({
            title: "Protection can't be re-applied",
            message: `“${name}” is password-protected, but re-applying its protection failed (${
              err instanceof Error ? err.message : "unknown error"
            }). Save an UNPROTECTED copy instead?`,
            confirmLabel: "Save unprotected",
            tone: "danger",
          });
          if (!ok) throw new ProtectionDeclinedError();
          return bytes;
        }
      }
      if (recipe?.kind === "wrapper") {
        const { wrapProtected } = await import("./lib/protected");
        return wrapProtected(bytes, recipe.password, name);
      }
      // No recipe, but the document was encrypted when it was opened — e.g. a
      // restrictions-only file whose owner password was never entered, so
      // there is nothing to re-encrypt with. Writing the (decrypted) working
      // bytes would silently strip that protection: ask first.
      if (encryptedAtOpen.current.has(docId)) {
        const ok = await requestConfirm({
          title: "Saving removes protection",
          message: `“${name}” was password-protected when it was opened, and PickPDF can't re-apply that protection. Saving now will remove the protection from the saved file. Continue?`,
          confirmLabel: "Save unprotected",
          tone: "danger",
        });
        if (!ok) throw new ProtectionDeclinedError();
      }
      return bytes;
    },
    [requestConfirm],
  );

  const downloadCurrent = useCallback(async () => {
    const bytes = await bakeToBytes();
    if (!bytes || !active) return;
    const current = docsRef.current.find((doc) => doc.id === active.id);
    if (!current) return;
    const base = current.name.replace(/\.pdf$/i, "");
    // Unedited bytes of a still-encrypted document ARE the protected original
    // — write them as-is (re-encrypting already-encrypted bytes would fail).
    const stillEncrypted = bytes === current.bytes && current.pdf.isEncrypted();
    let out: Uint8Array;
    try {
      out = stillEncrypted
        ? bytes
        : await protectForDisk(current.id, bytes, current.name);
    } catch (err) {
      if (err instanceof ProtectionDeclinedError) {
        toast.info("Download cancelled — no file was written.");
        return;
      }
      throw err;
    }
    downloadBytes(out, `${base}-edited.pdf`);
    toast.success(
      out !== bytes || stillEncrypted
        ? "Protected PDF downloaded"
        : "PDF downloaded",
    );
  }, [bakeToBytes, active, protectForDisk]);

  /**
   * Save: write in place via the file handle when available, otherwise
   * download. Either way the in-app document commits to the baked bytes,
   * clearing the unsaved-edits state.
   */
  const renameDoc = useCallback(
    (name: string) => {
      if (!active) return;
      const clean = name.trim().replace(/\.pdf$/i, "").trim();
      if (!clean || `${clean}.pdf` === active.name) return;
      const next = `${clean}.pdf`;
      updateDoc(active.id, { name: next });
      // For a protected doc, never rewrite its IndexedDB record with the plain
      // in-app bytes — leave the persisted protected form (and its old name)
      // until the next save re-writes it protected. encryptedAtOpen covers
      // recipe-less protected docs (restrictions-only files) the same way.
      if (
        protectionInfo.current.has(active.id) ||
        encryptedAtOpen.current.has(active.id)
      ) {
        void refreshRecent();
      } else {
        void persistDoc({
          id: active.id,
          name: next,
          sourceKey: active.sourceKey,
          bytes: active.bytes,
          lastOpened: Date.now(),
          open: true,
        }).then((result) => {
          noteAutosaveSkipped(active.id, result);
          return refreshRecent();
        });
      }
      // Browsers can't rename a file through its handle — be explicit about
      // what the rename actually affects.
      toast.success(
        docHandles.current.get(active.id)
          ? `Renamed to ${next} in PickPDF — the file on disk keeps its original name`
          : `Renamed to ${next} — saved copies will use this name`,
      );
    },
    [active, updateDoc, refreshRecent, noteAutosaveSkipped],
  );

  const saveCurrent = useCallback(async () => {
    if (!active) return;
    const handle = docHandles.current.get(active.id);
    // Snapshot the revision the baked bytes will represent BEFORE any async
    // work: edits landing while the write is in flight must keep the doc dirty.
    const savedAt = {
      revision: active.rev.revision,
      bytesRevision: active.rev.bytesRevision,
    };
    try {
      const baked = await bakeToBytes();
      if (!baked) return;
      const current = docsRef.current.find((doc) => doc.id === active.id);
      if (!current) return;
      // Protected docs go to disk re-protected; the in-app copy commits to the
      // plain baked bytes below (it stays editable, exactly like the protect
      // flow). This is why saving never strips a document's protection.
      // Unedited bytes of a still-encrypted document ARE the protected
      // original — write them as-is (re-encrypting encrypted bytes fails).
      const stillEncrypted = baked === current.bytes && current.pdf.isEncrypted();
      const out = stillEncrypted
        ? baked
        : await protectForDisk(current.id, baked, current.name);
      const locked = out !== baked || stillEncrypted ? " (protected)" : "";
      if (handle) {
        if (handle.requestPermission) {
          const perm = await handle.requestPermission({ mode: "readwrite" });
          if (perm !== "granted") throw new Error("write permission denied");
        }
        const writable = await handle.createWritable();
        await writable.write(out as unknown as BufferSource);
        await writable.close();
        toast.success(`Saved to ${current.name}${locked}`);
      } else {
        // No handle yet — prefer acquiring one via the save-file picker so the
        // write can be AWAITED before the doc is marked saved (and so future
        // saves write straight to the file).
        const picker = (
          window as unknown as {
            showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker;
        let newHandle: FileSystemFileHandle | null = null;
        if (picker) {
          try {
            newHandle = await picker.call(window, {
              suggestedName: current.name,
              types: [
                {
                  description: "PDF document",
                  accept: { "application/pdf": [".pdf"] },
                },
              ],
            });
          } catch (err) {
            // The user cancelled the picker: abort the save entirely — the doc
            // stays dirty and nothing is downloaded behind their back.
            if ((err as DOMException)?.name === "AbortError") return;
            // Any other picker failure: fall back to the anchor download.
          }
        }
        if (newHandle) {
          const writable = await newHandle.createWritable();
          await writable.write(out as unknown as BufferSource);
          await writable.close();
          docHandles.current.set(active.id, newHandle);
          toast.success(`Saved to ${newHandle.name || current.name}${locked}`);
        } else {
          // Anchor-download fallback (no File System Access API): the browser
          // gives NO completion signal for an <a download> click, so there is
          // no successful write result. The downloaded copy is useful, but
          // the open document must remain dirty.
          downloadBytes(out, `${current.name.replace(/\.pdf$/i, "")}-edited.pdf`);
          toast.info(`PDF copy downloaded${locked}`, {
            description:
              "The browser cannot confirm that the file was written, so this document remains unsaved.",
          });
          return;
        }
      }
      // Commit in-app state to the saved bytes.
      if (docHasEdits(current)) {
        const nextPdf = await loadPdf(baked);
        destroyDocProxies(current, nextPdf);
        updateDoc(current.id, (d) => ({
          bytes: baked,
          pdf: nextPdf,
          annotations: {},
          history: [{}],
          bytesHistory: [{ bytes: baked, pdf: nextPdf }],
          historyIndex: 0,
          formValues: {},
          fieldOps: {},
          savedState: {
            bytes: baked,
            annotations: {},
            formValues: {},
            fieldOps: {},
          },
          rev: markSaved(d.rev, savedAt),
        }));
        setDocVersion((v) => v + 1);
        setSelected(null);
      }
      void persistDoc({
        id: current.id,
        name: current.name,
        sourceKey: current.sourceKey,
        // Persist what's on disk — wrapped for locked docs, so a session
        // restore prompts for the password again instead of bypassing it.
        bytes: out,
        lastOpened: Date.now(),
        open: true,
      }).then((result) => noteAutosaveSkipped(current.id, result));
      // Saving ends the editing session — no separate "Done" needed.
      setEditModeState(false);
    } catch (err) {
      // The user declined writing an unprotected copy — abort quietly, and
      // certainly don't "fall back" to downloading the same stripped bytes.
      if (err instanceof ProtectionDeclinedError) {
        toast.info("Save cancelled — no file was written.");
        return;
      }
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : "error"} — downloading a copy instead.`,
      );
      await downloadCurrent();
    }
  }, [active, bakeToBytes, downloadCurrent, updateDoc, protectForDisk, noteAutosaveSkipped]);

  const activeEncrypted = useMemo(
    () => !!active?.pdf.isEncrypted(),
    [active?.pdf],
  );
  // A doc that will be (re-)protected on save: an already-encrypted doc, or one
  // with a protection recipe (e.g. protected this session but still editable).
  const activeProtected =
    activeEncrypted || (!!active && protectedIds.has(active.id));
  const activeWrapped =
    !!active &&
    protectedIds.has(active.id) &&
    protectionInfo.current.get(active.id)?.kind === "wrapper";

  /**
   * Password-protect: bake pending edits, encrypt with AES-256 (PDFium) and
   * write the protected file in place (or download it). The in-app copy
   * commits to the UNENCRYPTED baked bytes so editing continues without
   * password prompts; reopening the file from disk will ask for the password.
   *
   * Proper two-password model: for restrictions to actually bind in viewers,
   * the owner password must DIFFER from the user password (the SecurityModal
   * enforces this) — otherwise anyone who can open the file holds owner
   * rights and every flag is moot.
   */
  const protectDocument = useCallback(
    async (opts: {
      userPassword: string;
      ownerPassword: string;
      permissions: number;
      /** Lock to PickPDF: other viewers show a notice page; the real document
       *  travels inside it as an AES-256-GCM payload. */
      pickpdfOnly?: boolean;
    }) => {
      if (!active) return;
      const id = active.id;
      const handle = docHandles.current.get(id);
      // Same capture-before-bake rule as saveCurrent: the protected write
      // represents THIS revision, not whatever lands during the async work.
      const savedAt = {
        revision: active.rev.revision,
        bytesRevision: active.rev.bytesRevision,
      };
      try {
        const baked = await bakeToBytes();
        if (!baked) return;
        const current = docsRef.current.find((doc) => doc.id === id);
        if (!current) return;
        // Build the recipe + protected bytes. PickPDF-lock is its OWN
        // protection: the wrapper already makes the content unreadable outside
        // PickPDF, so we don't ALSO permission-encrypt the inner document —
        // that combination round-trips lossily (we can't recover the inner
        // owner password when the wrapper is reopened).
        let recipe: ProtectionRecipe;
        let protectedBytes: Uint8Array;
        if (opts.pickpdfOnly) {
          recipe = { kind: "wrapper", password: opts.userPassword };
          const { wrapProtected } = await import("./lib/protected");
          protectedBytes = await wrapProtected(baked, opts.userPassword, current.name);
        } else {
          recipe = {
            kind: "encrypt",
            userPassword: opts.userPassword,
            ownerPassword: opts.ownerPassword,
            permissions: opts.permissions,
          };
          const { encryptPdf } = await import("./lib/pdfium");
          protectedBytes = await encryptPdf(baked, opts);
        }

        // Write to disk FIRST — only register the recipe once the write
        // actually succeeds, so a denied/failed write never turns future
        // ordinary saves into protected writes with a password the user
        // believes was never applied.
        if (handle) {
          if (handle.requestPermission) {
            const perm = await handle.requestPermission({ mode: "readwrite" });
            if (perm !== "granted") throw new Error("write permission denied");
          }
          const writable = await handle.createWritable();
          await writable.write(protectedBytes as unknown as BufferSource);
          await writable.close();
          toast.success(
            `Protection added — ${active.name} on disk now requires the password. The open copy stays editable.`,
          );
        } else {
          downloadBytes(
            protectedBytes,
            `${active.name.replace(/\.pdf$/i, "")}-protected.pdf`,
          );
          toast.success("Protected PDF downloaded");
        }

        protectionInfo.current.set(id, recipe);
        markProtected(id, true);

        // Commit the in-app document to the (unencrypted) baked bytes, exactly
        // like a normal save — the protected file holds the same content.
        if (docHasEdits(current)) {
          const nextPdf = await loadPdf(baked);
          destroyDocProxies(current, nextPdf);
          updateDoc(id, (d) => ({
            bytes: baked,
            pdf: nextPdf,
            annotations: {},
            history: [{}],
            bytesHistory: [{ bytes: baked, pdf: nextPdf }],
            historyIndex: 0,
            formValues: {},
            fieldOps: {},
            savedState: {
              bytes: baked,
              annotations: {},
              formValues: {},
              fieldOps: {},
            },
            // The protected file on disk holds this same content — a save.
            rev: markSaved(d.rev, savedAt),
          }));
          setDocVersion((v) => v + 1);
          setSelected(null);
        }
        // Persist the on-disk protected bytes so a session restore re-prompts.
        void persistDoc({
          id,
          name: current.name,
          sourceKey: current.sourceKey,
          bytes: protectedBytes,
          lastOpened: Date.now(),
          open: true,
        }).then((result) => noteAutosaveSkipped(id, result));
        setEditModeState(false);
      } catch (err) {
        toast.error(
          `Protect failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    },
    [active, bakeToBytes, updateDoc, setEditModeState, markProtected, noteAutosaveSkipped],
  );

  /**
   * Remove protection: decrypt the base bytes in place (kept on the undo
   * timeline, annotations preserved). Requires OWNER rights, like every
   * compliant tool — opening rights alone don't let you strip restrictions;
   * the user is prompted for the permissions password when needed. The file
   * on disk stays encrypted until the user saves.
   */
  const removePassword = useCallback(async () => {
    if (!active) return;
    const id = active.id;
    // Protected THIS session (recipe present) — the in-app bytes are already
    // plain, so dropping the recipe is enough; the next save writes an
    // ordinary PDF. Covers both standard-encrypt and PickPDF-lock recipes and
    // opened PickPDF wrappers (which decrypt to plain on open).
    if (protectionInfo.current.has(id) && !active.pdf.isEncrypted()) {
      protectionInfo.current.delete(id);
      // Removing protection is the user's explicit choice — plain writes no
      // longer need the "was encrypted at open" consent gate.
      encryptedAtOpen.current.delete(id);
      markProtected(id, false);
      toast.success("Protection removed — save to write the unlocked file");
      return;
    }
    // Opened from disk still-encrypted: decrypt in place. Requires OWNER
    // rights — opening rights alone don't let you strip restrictions; prompt
    // for the permissions password when needed.
    const { decryptPdf, OwnerPasswordError } = await import("./lib/pdfium");
    let password = active.pdf.password;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await flushPdfEditsRef.current(id);
          const current = docsRef.current.find((doc) => doc.id === id);
          if (!current) return;
          const nextBytes = await decryptPdf(current.bytes, password);
          const nextPdf = await loadPdf(nextBytes);
          updateDoc(id, (d) => pushBackgroundContentEdit(d, nextBytes, nextPdf));
          persistWorking(id, current.name, nextBytes);
          break;
        } catch (err) {
          const needsOwner = err instanceof OwnerPasswordError;
          const wrongPw = err instanceof Error && err.message === "Wrong password";
          if ((!needsOwner && !wrongPw) || attempt >= 3) throw err;
          const input = await requestPassword({
            title: "Remove protection",
            message: needsOwner
              ? "Enter the permissions (owner) password to remove this document's protection."
              : "Enter the document's password.",
            error: attempt > 0 || wrongPw ? "That password wasn't accepted — try again." : undefined,
          });
          if (input === null) return;
          password = input;
        }
      }
      protectionInfo.current.delete(id);
      encryptedAtOpen.current.delete(id);
      markProtected(id, false);
      toast.success("Protection removed — save to write the unlocked file");
    } catch (err) {
      toast.error(
        `Remove protection failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }, [active, markProtected, persistWorking, requestPassword, updateDoc]);

  // --- Permission enforcement (honored like every compliant viewer) --------

  /** Bumped after an in-session owner unlock so permissions recompute. */
  const [permTick, setPermTick] = useState(0);

  const docPermissions = useMemo(() => {
    void permTick; // recompute after unlockPermissions
    return active ? permissionsOf(active.pdf) : ALL_ALLOWED;
    // Only the pdf proxy (swapped on every content edit) and an owner unlock
    // change permissions; scoping to active.pdf avoids recomputing on every
    // annotation/currentPage/formValue change to the same document.
  }, [active?.pdf, permTick]);

  // Live mirror of docPermissions for callbacks defined before it (applyBytesOp,
  // setFormValue) — refs sidestep the hook-ordering / stale-closure problem.
  const docPermissionsRef = useRef(docPermissions);
  docPermissionsRef.current = docPermissions;

  const unlockPermissions = useCallback(
    async (ownerPassword: string): Promise<boolean> => {
      if (!active) return false;
      const ok = active.pdf.unlockOwner(ownerPassword);
      if (ok) {
        // The REAL owner password is now proven — capture/upgrade the
        // re-encryption recipe so saves reproduce the original policy exactly
        // (same owner password, same permissions). This is also the moment a
        // restrictions-only file (opened without a prompt, hence recipe-less)
        // finally gets a recipe instead of the save-time consent fallback.
        if (encryptedAtOpen.current.has(active.id)) {
          const prev = protectionInfo.current.get(active.id);
          protectionInfo.current.set(
            active.id,
            recipeAfterOwnerUnlock(
              prev?.kind === "encrypt" ? prev : undefined,
              active.pdf.password,
              ownerPassword,
              active.pdf.getUserPermissions(),
            ),
          );
          markProtected(active.id, true);
        }
        try {
          const { decryptPdf } = await import("./lib/pdfium");
          const plainBytes = await decryptPdf(active.bytes, ownerPassword);
          const plainPdf = await loadPdf(plainBytes);
          destroyDocProxies(active, plainPdf);
          updateDoc(active.id, (d) => ({
            bytes: plainBytes,
            pdf: plainPdf,
            annotations: {},
            history: [{}],
            bytesHistory: [{ bytes: plainBytes, pdf: plainPdf }],
            historyIndex: 0,
            formValues: {},
            fieldOps: {},
            // Decryption creates a safe working representation; it does not
            // change the document the user sees, so keep the saved revision.
            rev: d.rev,
          }));
          setDocVersion((v) => v + 1);
        } catch (err) {
          toast.error(
            `Could not create a safe editing copy: ${err instanceof Error ? err.message : "unknown error"}`,
          );
          return false;
        }
        setPermTick((t) => t + 1);
        toast.success("Permissions unlocked — full access granted");
      } else {
        toast.error("Wrong permissions password");
      }
      return ok;
    },
    [active, markProtected, updateDoc],
  );

  /** Whether the document's permissions allow arming a given tool. */
  const toolAllowed = useCallback(
    (t: ToolKind): boolean => {
      const p = docPermissions;
      if (!p.restricted || t === "read") return true;
      // True content-stream edits need the modify permission…
      if (t === "edittext" || t === "redact") return p.modify;
      // …form tools need form-fill (or modify)…
      if (t.startsWith("form")) return p.fillForms || p.modify;
      // …Select remains available with annotate permission so user-added
      // annotations can still move. Its native-object/form layers separately
      // require modify permission, so annotate-only documents stay protected.
      // Everything else here creates or edits annotations too.
      return p.annotate || p.modify;
    },
    [docPermissions],
  );

  /** Permission-honoring setTool: the single gate for toolbar AND shortcuts. */
  const guardedSetTool = useCallback(
    (t: ToolKind) => {
      if (!toolAllowed(t)) {
        toast.error(
          "This document's permissions don't allow that. Unlock with the permissions password (File → Document security).",
        );
        return;
      }
      setTool(t);
    },
    [toolAllowed],
  );

  // Snap back to Read when the active document forbids the armed tool
  // (e.g. switching tabs to a restricted document with an edit tool armed).
  useEffect(() => {
    if (!toolAllowed(tool)) setTool("read");
  }, [toolAllowed, tool]);

  /** Enter/exit the form-builder mode. Entering arms Select and opens the
   *  sidebar (the palette lives there); leaving disarms builder-only state. */
  const setFormBuilder = useCallback(
    (v: boolean) => {
      if (v && !toolAllowed("formtext")) {
        toast.error(
          "This document's permissions don't allow adding form fields. Unlock with the permissions password (File → Document security).",
        );
        return;
      }
      setFormBuilderState(v);
      if (v) {
        setSidebarOpen(true);
        setTool((t) => (t === "read" ? "select" : t));
      } else {
        setFormPreview(false);
        setMultiSelected(null);
        setGroupDrag(null);
        setSnapGuides(null);
        setTool((t) => (t.startsWith("form") ? "select" : t));
      }
    },
    [toolAllowed],
  );

  const [ocrBusy, setOcrBusy] = useState(false);
  const runOcrText = useCallback(async () => {
    if (!active || ocrBusy) return;
    const id = active.id;
    // Language is picked at the moment of use (and remembered in Settings).
    const proceed = await requestConfirm({
      title: "Make searchable (OCR)",
      message:
        "Recognizes the text in this document so search, copy and AI work on it. " +
        "The first run per language downloads a recognition model; the recognition itself runs on your device. " +
        "Right-to-left and vertical scripts (e.g. Arabic, Hebrew, Japanese) may come out less accurate.",
      confirmLabel: "Run OCR",
      select: {
        label: "Document language",
        value: ocrLanguageRef.current,
        options: OCR_LANGUAGE_OPTIONS,
        onChange: setOcrLanguage,
      },
    });
    if (!proceed) return;
    const lang = ocrLanguageRef.current;
    setOcrBusy(true);
    const toastId = toast.loading("Preparing OCR… (first run downloads a model)");
    try {
      const { runOcr } = await import("./lib/ocr");
      const ocr = await runOcr(active.pdf, lang, (page, total, phase) => {
        toast.loading(
          phase === "prepare"
            ? "Preparing OCR…"
            : `Recognizing text — page ${Math.min(page + 1, total)} of ${total}…`,
          { id: toastId },
        );
      });
      const wordCount = ocr.reduce((n, p) => n + p.words.length, 0);
      if (!wordCount) {
        toast.error("No text could be recognized in this document.", { id: toastId });
        return;
      }
      // Bake any pending overlay edits first, then add the invisible OCR text
      // layer (committed byte edits are already in active.bytes).
      let base = active.bytes;
      if (docHasOverlayEdits(active)) {
        base = await bakeAnnotations(
          active.bytes,
          active.annotations,
          active.formValues,
          active.fieldOps,
        );
      }
      const next = await addOcrTextLayer(base, ocr);
      const nextPdf = await loadPdf(next);
      destroyDocProxies(active, nextPdf);
      updateDoc(id, (d) => ({
        bytes: next,
        pdf: nextPdf,
        annotations: {},
        history: [{}],
        bytesHistory: [{ bytes: next, pdf: nextPdf }],
        historyIndex: 0,
        formValues: {},
        fieldOps: {},
        // OCR rewrites the document in memory only — it stays unsaved.
        rev: bumpBytesRevision(d.rev),
      }));
      setDocVersion((v) => v + 1);
      setSelected(null);
      persistWorking(id, active.name, next);
      toast.success(
        `OCR complete — ${wordCount.toLocaleString()} words. Search, copy and AI now work on this document.`,
        { id: toastId },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      if (msg !== "OCR cancelled") toast.error(`OCR failed: ${msg}`, { id: toastId });
      else toast.dismiss(toastId);
    } finally {
      setOcrBusy(false);
    }
  }, [active, ocrBusy, updateDoc, persistWorking, requestConfirm, setOcrLanguage]);

  useEffect(() => {
    runOcrRef.current = runOcrText;
  }, [runOcrText]);

  /** Send bytes to the browser print dialog via a hidden iframe. */
  const printBytes = useCallback((bytes: Uint8Array) => {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = url;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    document.body.appendChild(iframe);
  }, []);

  /** Open the print dialog (page range + scale). */
  const printCurrent = useCallback(async () => {
    if (active && !permissionsOf(active.pdf).print) {
      toast.error("This document's permissions don't allow printing.");
      return;
    }
    if (!active) return;
    setPrintModalOpen(true);
  }, [active]);

  /**
   * Print a subset of pages at a given scale. `pageIndexes` null = all pages;
   * scale 1 = actual size. Bakes annotations first so markup prints.
   */
  const printWith = useCallback(
    async (pageIndexes: number[] | null, scale: number) => {
      if (active && !permissionsOf(active.pdf).print) {
        toast.error("This document's permissions don't allow printing.");
        return;
      }
      const baked = await bakeToBytes();
      if (!baked) return;
      const current = active
        ? docsRef.current.find((doc) => doc.id === active.id)
        : null;
      if (!current) return;
      let bytes = baked;
      const needsSubset =
        pageIndexes != null &&
        (pageIndexes.length !== current.pdf.numPages ||
          pageIndexes.some((p, i) => p !== i));
      if (needsSubset || scale !== 1) {
        const { buildPrintDoc } = await import("./lib/pdftools");
        const idx =
          pageIndexes ?? Array.from({ length: current.pdf.numPages }, (_, i) => i);
        bytes = await buildPrintDoc(baked, idx, scale);
      }
      setPrintModalOpen(false);
      printBytes(bytes);
    },
    [active, bakeToBytes, printBytes],
  );

  /* ---------------- navigation & search ---------------- */

  const setCurrentPage = useCallback(
    (p: number) => {
      if (activeTabId) updateDoc(activeTabId, { currentPage: p });
    },
    [activeTabId, updateDoc],
  );

  const scrollToPage = useCallback((p: number) => {
    window.dispatchEvent(
      new CustomEvent("pdfwb:scroll-to-page", { detail: { page: p } }),
    );
  }, []);

  const runSearch = useCallback(
    async (q: string, optionPatch?: Partial<SearchOptions>) => {
      const options = { ...searchOptions, ...(optionPatch ?? {}) };
      setSearchQuery(q);
      setSearchOptionsState(options);
      setSearchError(null);
      if (!active?.pdf || !q.trim()) {
        setSearchMatches([]);
        setActiveMatch(0);
        return 0;
      }
      try {
        const pdfMatches = options.includePdfText
          ? await searchDocumentAdvanced(active.pdf, q, options)
          : [];
        const textMatches = searchTextSources(active, q, options);
        const matches = [...pdfMatches, ...textMatches].sort(
          (a, b) => a.page - b.page || a.start - b.start || a.id.localeCompare(b.id),
        );
        setSearchMatches(matches);
        setActiveMatch(0);
        if (matches.length) scrollToPage(matches[0].page);
        return matches.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Search failed.";
        setSearchError(message);
        setSearchMatches([]);
        setActiveMatch(0);
        return 0;
      }
    },
    [active, scrollToPage, searchOptions],
  );

  const setSearchOptions = useCallback(
    (patch: Partial<SearchOptions>) => {
      const next = { ...searchOptions, ...patch };
      setSearchOptionsState(next);
      if (searchQuery.trim()) void runSearch(searchQuery, next);
    },
    [runSearch, searchOptions, searchQuery],
  );

  const gotoMatch = useCallback(
    (i: number) => {
      if (!searchMatches.length) return;
      const idx = ((i % searchMatches.length) + searchMatches.length) % searchMatches.length;
      setActiveMatch(idx);
      scrollToPage(searchMatches[idx].page);
    },
    [searchMatches, scrollToPage],
  );

  const applySearchReplacements = useCallback(
    async (targets: SearchMatch[], replacement: string) => {
      if (!active || !activeTabId || !searchQuery.trim() || !targets.length) return;

      let replaced = 0;
      let skipped = 0;
      let nextBytes = active.bytes;
      let pdfChanged = false;
      let nextAnnotations = active.annotations;
      let annotationsChanged = false;
      let nextFormValues = active.formValues;
      let formValuesChanged = false;

      const pdfByPage = new Map<number, Set<number>>();
      for (const match of targets) {
        if (match.source !== "pdf-content") continue;
        if (!match.replaceable) {
          skipped += 1;
          continue;
        }
        const set = pdfByPage.get(match.page) ?? new Set<number>();
        set.add(match.ordinal);
        pdfByPage.set(match.page, set);
      }

      if (pdfByPage.size) {
        const { getTextObjects, styleTextRuns } = await import("./lib/pdfium");
        for (const [page, ordinals] of [...pdfByPage.entries()].sort((a, b) => a[0] - b[0])) {
          const objs = await getTextObjects(nextBytes, page);
          const plan = planTextObjectReplacements(
            objs,
            searchQuery,
            replacement,
            searchOptions,
            ordinals,
          );
          if (plan.error) throw new Error(plan.error);
          if (!plan.count || !plan.edits.length) {
            skipped += ordinals.size;
            continue;
          }
          nextBytes = await styleTextRuns(nextBytes, page, plan.edits, {});
          pdfChanged = true;
          replaced += plan.count;
        }
      }

      const textTargets = targets.filter(
        (m) => m.source === "annotation-text" || m.source === "note-text",
      );
      const byAnnotation = new Map<string, SearchMatch[]>();
      for (const match of textTargets) {
        if (!match.annotationId) continue;
        const list = byAnnotation.get(match.annotationId) ?? [];
        list.push(match);
        byAnnotation.set(match.annotationId, list);
      }

      const patchAnnotation = (page: number, ann: Annotation) => {
        if (nextAnnotations === active.annotations) {
          nextAnnotations = { ...active.annotations };
        }
        const list = [...(nextAnnotations[page] ?? [])];
        const idx = list.findIndex((a) => a.id === ann.id);
        if (idx >= 0) {
          list[idx] = ann;
          nextAnnotations = { ...nextAnnotations, [page]: list };
          annotationsChanged = true;
        }
      };

      for (const [annotationId, matches] of byAnnotation) {
        let found:
          | { page: number; ann: Extract<Annotation, { kind: "text" | "note" }> }
          | null = null;
        for (const [pageKey, list] of Object.entries(nextAnnotations)) {
          const ann = list.find(
            (a): a is Extract<Annotation, { kind: "text" | "note" }> =>
              a.id === annotationId && (a.kind === "text" || a.kind === "note"),
          );
          if (ann) {
            found = { page: Number(pageKey), ann };
            break;
          }
        }
        if (!found) {
          skipped += matches.length;
          continue;
        }
        let text = found.ann.text;
        for (const match of [...matches].sort((a, b) => b.start - a.start)) {
          const result = replaceHitInText(
            text,
            match,
            searchQuery,
            replacement,
            searchOptions,
          );
          if (result.error) throw new Error(result.error);
          text = result.text;
          replaced += 1;
        }
        const ann =
          found.ann.kind === "text"
            ? ({ ...found.ann, text, runs: undefined, blocks: undefined } as Annotation)
            : ({ ...found.ann, text } as Annotation);
        patchAnnotation(found.page, ann);
      }

      const formTargets = targets.filter((m) => m.source === "form-value" && m.fieldName);
      const byField = new Map<string, SearchMatch[]>();
      for (const match of formTargets) {
        const fieldName = match.fieldName!;
        const list = byField.get(fieldName) ?? [];
        list.push(match);
        byField.set(fieldName, list);
      }
      for (const [fieldName, matches] of byField) {
        let text = formValueText(nextFormValues[fieldName]);
        if (!text) {
          skipped += matches.length;
          continue;
        }
        for (const match of [...matches].sort((a, b) => b.start - a.start)) {
          const result = replaceHitInText(
            text,
            match,
            searchQuery,
            replacement,
            searchOptions,
          );
          if (result.error) throw new Error(result.error);
          text = result.text;
          replaced += 1;
        }
        nextFormValues = { ...nextFormValues, [fieldName]: text };
        formValuesChanged = true;
      }

      if (!replaced && skipped) {
        toast.info(`No replacements made (${skipped} skipped).`);
        return;
      }

      let nextPdf: PdfDoc | null = null;
      if (pdfChanged) nextPdf = await loadPdf(nextBytes);
      updateDoc(activeTabId, (d) => ({
        ...(pdfChanged || annotationsChanged
          ? pushHistory(
              d,
              nextAnnotations,
              pdfChanged && nextPdf ? { bytes: nextBytes, pdf: nextPdf } : undefined,
            )
          : // Form-value-only replacements skip pushHistory (no undo step) but
            // are still mutations — bump the revision explicitly.
            formValuesChanged
            ? { rev: bumpRevision(d.rev) }
            : {}),
        ...(formValuesChanged ? { formValues: nextFormValues } : {}),
      }));
      if (pdfChanged) {
        setSelected(null);
        persistWorking(active.id, active.name, nextBytes);
      }
      toast.success(
        `Replaced ${replaced}${skipped ? ` (${skipped} skipped)` : ""}.`,
      );
      const searchDoc: OpenDoc = {
        ...active,
        bytes: nextBytes,
        pdf: nextPdf ?? active.pdf,
        annotations: nextAnnotations,
        formValues: nextFormValues,
      };
      const pdfMatches = searchOptions.includePdfText
        ? await searchDocumentAdvanced(searchDoc.pdf, searchQuery, searchOptions)
        : [];
      const textMatches = searchTextSources(searchDoc, searchQuery, searchOptions);
      const matches = [...pdfMatches, ...textMatches].sort(
        (a, b) => a.page - b.page || a.start - b.start || a.id.localeCompare(b.id),
      );
      setSearchMatches(matches);
      setActiveMatch(0);
    },
    [
      active,
      activeTabId,
      persistWorking,
      searchOptions,
      searchQuery,
      updateDoc,
    ],
  );

  const replaceMatch = useCallback(
    async (replacement: string, index = activeMatch) => {
      const match = searchMatches[index];
      if (!match) return;
      try {
        await applySearchReplacements([match], replacement);
      } catch (err) {
        toast.error(
          `Replace failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    },
    [activeMatch, applySearchReplacements, searchMatches],
  );

  const replaceAll = useCallback(
    async (replacement: string) => {
      if (!searchMatches.length) return;
      try {
        await applySearchReplacements(searchMatches, replacement);
      } catch (err) {
        toast.error(
          `Replace all failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    },
    [applySearchReplacements, searchMatches],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchMatches([]);
    setActiveMatch(0);
    setSearchError(null);
  }, []);

  const setEditMode = useCallback(
    (v: boolean) => {
      setEditModeState(v);
      if (!v) {
        setSelected(null);
        setPendingStamp(null);
      }
    },
    [setEditModeState],
  );

  const tabs: TabInfo[] = useMemo(
    () => docs.map((d) => ({ id: d.id, name: d.name, hasEdits: docHasEdits(d) })),
    [docs],
  );

  // Warn before the browser closes/refreshes while any tab has unsaved edits.
  const anyEdits = tabs.some((t) => t.hasEdits);
  useEffect(() => {
    if (!anyEdits) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyEdits]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  const value: AppStore = {
    theme,
    toggleTheme,
    accent,
    setAccent,
    screen,
    setScreen,
    tabs,
    activeTabId,
    sessionRestoring,
    switchTab,
    closeTab,
    closeAllTabs,
    panes,
    activePaneId,
    paneSizes,
    setPaneSizes,
    splitView,
    openInPane,
    focusPane,
    closePane,
    exitSplit,
    printDoc,
    docById,
    docName: active?.name ?? null,
    renameDoc,
    docBytes: active?.bytes ?? null,
    docId: active?.id ?? null,
    pdf: active?.pdf ?? null,
    numPages: active?.pdf?.numPages ?? 0,
    docVersion,
    contentRev,
    openFile,
    openBytes,
    requestOpen,
    registerFileHandle,
    activeHasHandle: !!(activeTabId && docHandles.current.has(activeTabId)),
    saveCurrent,
    recentFiles,
    recentLoading,
    openRecent,
    removeRecent,
    clearRecent,
    closeDocument,
    folderRoot,
    folderBusy,
    openFolder,
    closeFolder,
    openTreeFile,
    applyBytesOp,
    bakeToBytes,
    getPageTextObjects,
    applyTextEdit,
    applyTextRuns,
    applyTextReflow,
    getTextFontInfo,
    getPageObjects,
    applyObjectTransform,
    removeObjectAt,
    applyObjectStyle,
    redactCount,
    applyRedactions,
    activeEncrypted,
    activeProtected,
    activeWrapped,
    protectDocument,
    removePassword,
    docPermissions,
    unlockPermissions,
    securityModalOpen,
    setSecurityModalOpen,
    signModalOpen,
    setSignModalOpen,
    passwordPrompt,
    answerPassword,
    confirmPrompt,
    requestConfirm,
    answerConfirm,
    downloadCurrent,
    printCurrent,
    printWith,
    ocrBusy,
    runOcrText,
    ocrLanguage,
    setOcrLanguage,
    currentPage: active?.currentPage ?? 0,
    setCurrentPage,
    scrollToPage,
    scale,
    setScale,
    fitMode,
    setFitMode,
    spread,
    setSpread,
    printModalOpen,
    setPrintModalOpen,
    editMode,
    setEditMode,
    tool,
    setTool: guardedSetTool,
    toolColor,
    highlightColor,
    setHighlightColor,
    highlightMode,
    setHighlightMode,
    editTextScope,
    setEditTextScope,
    markupColor,
    setMarkupColor,
    setToolColor,
    fontColor,
    setFontColor,
    toolFill,
    setToolFill,
    markSymbol,
    setMarkSymbol,
    markColor,
    setMarkColor,
    strokeWidth,
    setStrokeWidth,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    fontBold,
    setFontBold,
    fontItalic,
    setFontItalic,
    fontUnderline,
    setFontUnderline,
    fontStrike,
    setFontStrike,
    textAlign,
    setTextAlign,
    lineHeight,
    setLineHeight,
    letterSpacing,
    setLetterSpacing,
    annotations,
    hasAnnotations,
    hasOverlayEdits,
    hasByteEdits,
    addAnnotation,
    addAnnotations: addAnnotationsMany,
    updateAnnotation,
    removeAnnotation,
    clearAnnotations,
    undo,
    redo,
    canUndo: (active?.historyIndex ?? 0) > 0,
    canRedo: active ? active.historyIndex < active.history.length - 1 : false,
    selected,
    setSelected,
    copySelectedAnnotation,
    pasteAnnotationClipboard,
    duplicateSelectedAnnotation,
    editRequestId,
    setEditRequestId,
    pendingStamp,
    setPendingStamp,
    formValues: active?.formValues ?? {},
    setFormValue,
    measureScale: active?.measureScale ?? null,
    setMeasureScale,
    measureCalibrating,
    setMeasureCalibrating,
    calibrateRequest,
    setCalibrateRequest,
    fieldOps: active?.fieldOps ?? {},
    upsertFieldOp,
    selectedField,
    setSelectedField,
    formBuilder,
    setFormBuilder,
    formPreview,
    setFormPreview,
    previewValues,
    setPreviewValue,
    multiSelected,
    setMultiSelected,
    toggleMultiSelected,
    translateAnnotations,
    updateAnnotations: updateAnnotationsBatch,
    removeAnnotations: removeAnnotationsBatch,
    groupDrag,
    setGroupDrag,
    snapGuides,
    setSnapGuides,
    snapEnabled,
    setSnapEnabled,
    gridEnabled,
    setGridEnabled,
    gridSize,
    setGridSize,
    reorderFormField,
    searchQuery,
    searchOptions,
    searchMatches,
    activeMatch,
    searchError,
    runSearch,
    setSearchOptions,
    gotoMatch,
    replaceMatch,
    replaceAll,
    clearSearch,
    aiOpen,
    setAiOpen,
    aiAsk,
    askAi,
    sidebarOpen,
    setSidebarOpen,
    isMobile,
    settings,
    setSettings,
    signatures,
    addSignature,
    removeSignature,
    signatureModalOpen,
    setSignatureModalOpen,
  };

  // Dev-only hook for driving the app from automated tests. Reassigned every
  // render so the exposed closures always see current state (no stale `active`).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__pdfwb = {
        setScreen,
        switchTab,
        setEditMode,
        setTool,
        splitView,
        openInPane,
        focusPane,
        exitSplit,
        setFolderRoot,
        runOcrText,
        openBytes,
        setFormValue,
        addAnnotation,
        setSelected,
        setFormBuilder,
        setFormPreview,
        getPageTextObjects,
        applyTextEdit,
        applyTextRuns,
        applyTextReflow,
        getTextFontInfo,
        getPageObjects,
        applyObjectTransform,
        removeObjectAt,
        applyObjectStyle,
        undo,
        redo,
        state: () => ({
          activeTabId,
          activePaneId,
          panes,
          docVersion,
          bytesLen: active?.bytes.length ?? 0,
          historyIndex: active?.historyIndex ?? -1,
          historyLen: active?.history.length ?? 0,
        }),
      };
    }
  });

  // --- selector subscription plumbing (powers useAppSelector) ---
  // Keep the latest store in a ref and notify subscribers after each commit.
  const storeRef = useRef(value);
  storeRef.current = value;
  const listenersRef = useRef<Set<() => void>>(new Set());
  const storeApi = useMemo<StoreApi>(
    () => ({
      subscribe: (cb) => {
        listenersRef.current.add(cb);
        return () => {
          listenersRef.current.delete(cb);
        };
      },
      getStore: () => storeRef.current,
    }),
    [],
  );
  useLayoutEffect(() => {
    for (const cb of listenersRef.current) cb();
  });

  return (
    <StoreApiCtx.Provider value={storeApi}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </StoreApiCtx.Provider>
  );
}

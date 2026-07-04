import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PdfDoc } from "./lib/pdf";
import { toast } from "sonner";
import type {
  Annotation,
  AnnotationMap,
  AppSettings,
  ExistingFieldOp,
  FolderNode,
  FontFamilyKind,
  SavedSignature,
  Screen,
  SearchMatch,
  ToolKind,
} from "./types";
import { loadPdf, searchDocument, extractAllText } from "./lib/pdf";
import { pickFolder, readNode } from "./lib/folder";
import { addOcrTextLayer, bakeAnnotations } from "./lib/pdftools";
import type {
  Matrix as PdfiumMatrix,
  ObjectStyle as PdfiumObjectStyle,
  PageObject,
  TextObject,
  TextStyle as PdfiumTextStyle,
} from "./lib/pdfium";
import { DEFAULT_SETTINGS } from "./lib/ai";
import { downloadBytes, uid } from "./lib/utils";
import {
  getStoredDoc,
  listStoredDocs,
  markDocClosed,
  persistDoc,
} from "./lib/persist";
import { applyAccent, type AccentId } from "./lib/accents";

const SETTINGS_KEY = "pickpdf-settings";
const SIGNATURES_KEY = "pickpdf-signatures";
const THEME_KEY = "pickpdf-theme";
const ACCENT_KEY = "pickpdf-accent";

export interface PendingStamp {
  dataUrl: string;
  aspect: number; // height / width
}

/** The document's base bytes + its parsed pdf.js proxy at a point in history. */
interface BaseState {
  bytes: Uint8Array;
  pdf: PdfDoc;
}

interface OpenDoc {
  id: string;
  name: string;
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
  /** Pending move/rename/delete edits to existing AcroForm fields. */
  fieldOps: Record<string, ExistingFieldOp>;
}

export interface TabInfo {
  id: string;
  name: string;
  hasEdits: boolean;
}

export interface RecentFile {
  id: string;
  name: string;
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
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;

  /** Editor panes for split view. Empty = single view (uses activeTabId). */
  panes: Array<{ id: string; docId: string }>;
  activePaneId: string | null;
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
  pdf: PdfDoc | null;
  numPages: number;
  docVersion: number;

  openFile: (file: File) => Promise<void>;
  openBytes: (bytes: Uint8Array, name: string) => Promise<string | null>;
  /** Open via the File System Access picker when available (enables save-in-place). */
  requestOpen: () => Promise<void>;
  registerFileHandle: (id: string, handle: unknown) => void;
  /** True when the active tab was opened with a writable file handle. */
  activeHasHandle: boolean;
  /** Save in place when a handle exists, otherwise download a copy. */
  saveCurrent: () => Promise<void>;
  recentFiles: RecentFile[];
  openRecent: (id: string) => Promise<void>;
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

  /** In-place text editing via PDFium (replaces the whiteout+overlay hack). */
  getPageTextObjects: (pageIndex: number) => Promise<TextObject[]>;
  applyTextEdit: (
    pageIndex: number,
    objectIndex: number,
    newText: string,
  ) => Promise<void>;
  applyTextStyle: (
    pageIndex: number,
    objectIndex: number,
    style: PdfiumTextStyle,
  ) => Promise<void>;

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

  /** OCR the active document into a searchable text layer. */
  ocrBusy: boolean;
  runOcrText: () => Promise<void>;

  currentPage: number;
  setCurrentPage: (p: number) => void;
  scrollToPage: (p: number) => void;
  scale: number;
  setScale: (s: number) => void;
  /** null = manual zoom via `scale`. */
  fitMode: "width" | "page" | null;
  setFitMode: (m: "width" | "page" | null) => void;

  /** Edit mode gates the editor toolbar and annotation interactivity. */
  editMode: boolean;
  setEditMode: (v: boolean) => void;

  tool: ToolKind;
  setTool: (t: ToolKind) => void;
  toolColor: string;
  /** Highlighter has its own color memory (pastel palette). */
  highlightColor: string;
  setHighlightColor: (c: string) => void;
  setToolColor: (c: string) => void;
  /** Fill color for new rect/ellipse shapes; null = no fill. */
  toolFill: string | null;
  setToolFill: (c: string | null) => void;
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

  annotations: AnnotationMap;
  hasAnnotations: boolean;
  addAnnotation: (page: number, ann: Annotation) => void;
  addAnnotations: (page: number, anns: Annotation[]) => void;
  updateAnnotation: (page: number, ann: Annotation) => void;
  removeAnnotation: (page: number, id: string) => void;
  clearAnnotations: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  selected: { page: number; id: string } | null;
  setSelected: (s: { page: number; id: string } | null) => void;

  /** Id of a text annotation that should open its editor immediately. */
  editRequestId: string | null;
  setEditRequestId: (id: string | null) => void;

  pendingStamp: PendingStamp | null;
  setPendingStamp: (s: PendingStamp | null) => void;

  /** AcroForm values of the active tab. */
  formValues: Record<string, unknown>;
  setFormValue: (name: string, value: unknown) => void;

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

  searchQuery: string;
  searchMatches: SearchMatch[];
  activeMatch: number;
  runSearch: (q: string) => Promise<void>;
  gotoMatch: (i: number) => void;
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

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function docHasEdits(d: OpenDoc): boolean {
  return (
    Object.values(d.annotations).some((l) => l.length > 0) ||
    Object.keys(d.formValues).length > 0 ||
    Object.keys(d.fieldOps).length > 0
  );
}

const HISTORY_CAP = 60;

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
    pdf: base.pdf,
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
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [panes, setPanes] = useState<Array<{ id: string; docId: string }>>([]);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const MAX_PANES = 4;
  const [docVersion, setDocVersion] = useState(0);

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

  const [scale, setScale] = useState(1.1);
  const [fitMode, setFitMode] = useState<"width" | "page" | null>("width");

  // Modeless editing: "read" (text selection, links) is simply the state
  // where no tool is armed. editMode is derived — kept on the store because
  // many gates ("is any editing UI active?") still read it.
  const [tool, setTool] = useState<ToolKind>("read");
  const editMode = tool !== "read";
  const setEditModeState = useCallback((v: boolean) => {
    setTool((t) => (v ? (t === "read" ? "select" : t) : "read"));
  }, []);
  const [toolColor, setToolColor] = useState("#e11d48");
  const [highlightColor, setHighlightColor] = useState("#facc15");
  // Fill color for new rect/ellipse shapes; null = no fill (outline only).
  const [toolFill, setToolFill] = useState<string | null>(null);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState<FontFamilyKind>("helvetica");
  const [fontBold, setFontBold] = useState(false);
  const [fontItalic, setFontItalic] = useState(false);

  const [selected, setSelected] = useState<{ page: number; id: string } | null>(null);
  const [selectedField, setSelectedField] = useState<Pick<
    ExistingFieldOp,
    "key" | "fieldName" | "pageIndex" | "origRect"
  > | null>(null);
  const [editRequestId, setEditRequestId] = useState<string | null>(null);
  const [pendingStamp, setPendingStamp] = useState<PendingStamp | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);

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
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);

  const [settings, setSettingsState] = useState<AppSettings>(() =>
    loadJson(SETTINGS_KEY, DEFAULT_SETTINGS),
  );
  const setSettings = useCallback((s: AppSettings) => {
    setSettingsState(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
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

  const clearAnnotations = useCallback(() => {
    if (!activeTabId) return;
    updateDoc(activeTabId, (d) => ({
      annotations: {},
      history: [{}],
      bytesHistory: [{ bytes: d.bytes, pdf: d.pdf }],
      historyIndex: 0,
      formValues: {},
      fieldOps: {},
    }));
    setSelected(null);
  }, [activeTabId, updateDoc]);

  // Undo/redo restore both annotations and the base bytes/pdf from the aligned
  // timeline. Swapping `pdf` re-renders pages in place — no docVersion bump, so
  // there's no remount flash or scroll jump.
  const undo = useCallback(() => {
    if (!active) return;
    const target = Math.max(0, active.historyIndex - 1);
    const base = active.bytesHistory[target] ?? { bytes: active.bytes, pdf: active.pdf };
    updateDoc(active.id, {
      historyIndex: target,
      annotations: active.history[target] ?? {},
      bytes: base.bytes,
      pdf: base.pdf,
    });
    setSelected(null);
  }, [active, updateDoc]);

  const redo = useCallback(() => {
    if (!active) return;
    const target = Math.min(active.history.length - 1, active.historyIndex + 1);
    const base = active.bytesHistory[target] ?? { bytes: active.bytes, pdf: active.pdf };
    updateDoc(active.id, {
      historyIndex: target,
      annotations: active.history[target] ?? {},
      bytes: base.bytes,
      pdf: base.pdf,
    });
  }, [active, updateDoc]);

  const hasAnnotations = useMemo(
    () => (active ? docHasEdits(active) : false),
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
    // A changed/opened document starts in read mode, not carrying over the
    // previous doc's edit session. (Templates re-arm editing after opening.)
    setTool("read");
  }, []);

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [folderRoot, setFolderRoot] = useState<FolderNode | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const docHandles = useRef(new Map<string, any>());
  const runOcrRef = useRef<(() => Promise<void>) | null>(null);

  const refreshRecent = useCallback(async () => {
    const stored = await listStoredDocs();
    setRecentFiles(
      stored.map((d) => ({
        id: d.id,
        name: d.name,
        lastOpened: d.lastOpened,
        open: d.open,
      })),
    );
  }, []);

  const openBytesInternal = useCallback(
    async (
      bytes: Uint8Array,
      name: string,
      id?: string,
      persist = true,
    ): Promise<string | null> => {
      try {
        const pdfDoc = await loadPdf(bytes);
        const doc: OpenDoc = {
          id: id ?? uid(),
          name,
          bytes,
          pdf: pdfDoc,
          annotations: {},
          history: [{}],
          bytesHistory: [{ bytes, pdf: pdfDoc }],
          historyIndex: 0,
          currentPage: 0,
          formValues: {},
          fieldOps: {},
        };
        setDocs((prev) => [...prev.filter((d) => d.id !== doc.id), doc]);
        setActiveTabId(doc.id);
        setDocVersion((v) => v + 1);
        resetTransient();
        setScreen("viewer");
        if (persist) {
          void persistDoc({
            id: doc.id,
            name,
            bytes,
            lastOpened: Date.now(),
            open: true,
          }).then(refreshRecent);
        }
        // Offer OCR if the document has essentially no extractable text (scan).
        void extractAllText(pdfDoc)
          .then((textPages) => {
            const chars = textPages.reduce((n, p) => n + p.full.trim().length, 0);
            if (chars < pdfDoc.numPages * 10) {
              toast("This looks like a scanned PDF", {
                description:
                  "Run OCR to make its text searchable, selectable and AI-readable.",
                action: {
                  label: "Run OCR",
                  onClick: () => void runOcrRef.current?.(),
                },
                duration: 12000,
              });
            }
          })
          .catch(() => {});
        return doc.id;
      } catch (err) {
        if ((err as Error)?.message !== "Password required") {
          toast.error(
            `Could not open PDF: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
        return null;
      }
    },
    [resetTransient, refreshRecent],
  );

  const openBytes = useCallback(
    (bytes: Uint8Array, name: string) => openBytesInternal(bytes, name),
    [openBytesInternal],
  );

  const openFile = useCallback(
    async (file: File) => {
      const buf = new Uint8Array(await file.arrayBuffer());
      await openBytes(buf, file.name);
    },
    [openBytes],
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
        const { bytes, name, handle } = await readNode(node);
        const id = await openBytes(bytes, name);
        if (id && handle) docHandles.current.set(id, handle);
      } catch (err) {
        toast.error(
          `Could not open ${node.name}: ${err instanceof Error ? err.message : "error"}`,
        );
      }
    },
    [openBytes],
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
        const id = await openBytesInternal(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
        );
        if (id) docHandles.current.set(id, handle);
      }
    } catch {
      /* user cancelled the picker */
    }
  }, [openBytesInternal]);

  // Restore tabs that were open last session; load the recent-files list.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      const stored = await listStoredDocs();
      const toOpen = stored
        .filter((d) => d.open)
        .sort((a, b) => a.lastOpened - b.lastOpened);
      for (const d of toOpen) {
        await openBytesInternal(d.bytes, d.name, d.id, true);
      }
      await refreshRecent();
    })();
  }, [openBytesInternal, refreshRecent]);

  const openRecent = useCallback(
    async (id: string) => {
      const existing = docs.find((d) => d.id === id);
      if (existing) {
        // In split view: focus the pane already showing this doc, otherwise
        // load it into the focused pane (never desync active doc from panes).
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
        return;
      }
      const stored = await getStoredDoc(id);
      if (!stored) {
        toast.error("File is no longer available");
        void refreshRecent();
        return;
      }
      await openBytesInternal(stored.bytes, stored.name, stored.id);
    },
    [docs, panes, activePaneId, activeTabId, openBytesInternal, resetTransient, refreshRecent],
  );

  const switchTab = useCallback(
    (id: string) => {
      if (panes.length > 0) {
        // If the document is already shown in a pane, focus that pane
        // instead of loading it into the current one (VS Code behavior).
        const existing = panes.find((p) => p.docId === id);
        if (existing) {
          setActivePaneId(existing.id);
          if (id !== activeTabId) {
            setActiveTabId(id);
            setDocVersion((v) => v + 1);
            resetTransient();
          }
          setScreen("viewer");
          return;
        }
        // Otherwise load it into the focused pane.
        if (activePaneId) {
          setPanes((prev) =>
            prev.map((p) => (p.id === activePaneId ? { ...p, docId: id } : p)),
          );
        }
      }
      if (id === activeTabId) {
        setScreen("viewer");
        return;
      }
      setActiveTabId(id);
      setDocVersion((v) => v + 1);
      resetTransient();
      setScreen("viewer");
    },
    [activeTabId, panes, activePaneId, resetTransient],
  );

  const closeTab = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id);
      if (!doc) return;
      if (docHasEdits(doc)) {
        const ok = window.confirm(
          `“${doc.name}” has unsaved edits. Close it anyway?`,
        );
        if (!ok) return;
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
      void markDocClosed(id).then(refreshRecent);
    },
    [docs, activeTabId, resetTransient, refreshRecent],
  );

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

  const focusPane = useCallback((paneId: string) => {
    setPanes((prev) => {
      const pane = prev.find((p) => p.id === paneId);
      if (pane) {
        setActivePaneId(paneId);
        setActiveTabId(pane.docId);
        setDocVersion((v) => v + 1);
        resetTransient();
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      let bytes = d.bytes;
      if (docHasEdits(d)) {
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
      updateDoc(activeTabId, (d) => ({
        formValues: { ...d.formValues, [name]: value },
      }));
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
        const next = { ...d.fieldOps };
        if (isNoop) delete next[base.key];
        else next[base.key] = merged as ExistingFieldOp;
        return { fieldOps: next };
      });
    },
    [activeTabId, updateDoc],
  );

  const bakeToBytes = useCallback(async (): Promise<Uint8Array | null> => {
    if (!active) return null;
    if (!docHasEdits(active)) return active.bytes;
    return bakeAnnotations(
      active.bytes,
      active.annotations,
      active.formValues,
      active.fieldOps,
    );
  }, [active]);

  const applyBytesOp = useCallback(
    async (op: (bytes: Uint8Array) => Promise<Uint8Array>, label: string) => {
      if (!active) return;
      const id = active.id;
      try {
        let base = active.bytes;
        if (docHasEdits(active)) {
          base = await bakeAnnotations(
            active.bytes,
            active.annotations,
            active.formValues,
            active.fieldOps,
          );
          toast.info("Pending edits were saved into the document first.");
        }
        const nextBytes = await op(base);
        const nextPdf = await loadPdf(nextBytes);
        destroyDocProxies(active, nextPdf);
        updateDoc(id, {
          bytes: nextBytes,
          pdf: nextPdf,
          annotations: {},
          history: [{}],
          bytesHistory: [{ bytes: nextBytes, pdf: nextPdf }],
          historyIndex: 0,
          formValues: {},
          fieldOps: {},
        });
        setDocVersion((v) => v + 1);
        setSelected(null);
        void persistDoc({
          id,
          name: active.name,
          bytes: nextBytes,
          lastOpened: Date.now(),
          open: true,
        });
        toast.success(label);
      } catch (err) {
        toast.error(
          `${label} failed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    },
    [active, updateDoc],
  );

  /** Read the editable text runs on a page (via PDFium), for hit-testing. */
  const getPageTextObjects = useCallback(
    async (pageIndex: number) => {
      if (!active) return [];
      const { getTextObjects } = await import("./lib/pdfium");
      return getTextObjects(active.bytes, pageIndex);
    },
    [active],
  );

  /** Read the movable objects (text + images) on a page, for the object tool. */
  const getPageObjects = useCallback(
    async (pageIndex: number) => {
      if (!active) return [];
      const { getPageObjects: read } = await import("./lib/pdfium");
      return read(active.bytes, pageIndex);
    },
    [active],
  );

  /**
   * Commit an in-place PDFium byte edit: swap the base bytes/pdf onto the undo
   * timeline while KEEPING the current annotations (they still bake on save).
   * No docVersion bump — the page re-renders in place from the new `pdf` prop,
   * so there's no remount flash or scroll jump.
   */
  const commitInPlace = useCallback(
    async (make: (bytes: Uint8Array) => Promise<Uint8Array>) => {
      if (!active) return;
      const id = active.id;
      const nextBytes = await make(active.bytes);
      const nextPdf = await loadPdf(nextBytes);
      updateDoc(id, (d) =>
        pushHistory(d, d.annotations, { bytes: nextBytes, pdf: nextPdf }),
      );
      setSelected(null);
      void persistDoc({
        id,
        name: active.name,
        bytes: nextBytes,
        lastOpened: Date.now(),
        open: true,
      });
    },
    [active, updateDoc],
  );

  /**
   * True in-place text edit: rewrite the content-stream text object via PDFium,
   * keeping its font/size/color/position — no whiteout, no overlay copy, and
   * the original text is genuinely replaced.
   */
  const applyTextEdit = useCallback(
    async (pageIndex: number, objectIndex: number, newText: string) => {
      const { editTextObject } = await import("./lib/pdfium");
      await commitInPlace((b) => editTextObject(b, pageIndex, objectIndex, newText));
    },
    [commitInPlace],
  );

  /** In-place text edit that also changes ink color and/or size. */
  const applyTextStyle = useCallback(
    async (pageIndex: number, objectIndex: number, style: PdfiumTextStyle) => {
      const { styleTextObject } = await import("./lib/pdfium");
      await commitInPlace((b) => styleTextObject(b, pageIndex, objectIndex, style));
    },
    [commitInPlace],
  );

  /** Move/resize an existing object (text or image) via an affine transform. */
  const applyObjectTransform = useCallback(
    async (pageIndex: number, objectIndex: number, m: PdfiumMatrix) => {
      const { transformObject } = await import("./lib/pdfium");
      await commitInPlace((b) => transformObject(b, pageIndex, objectIndex, m));
    },
    [commitInPlace],
  );

  /** Delete an existing object (text, image or path) from the page. */
  const removeObjectAt = useCallback(
    async (pageIndex: number, objectIndex: number) => {
      const { removeObject } = await import("./lib/pdfium");
      await commitInPlace((b) => removeObject(b, pageIndex, objectIndex));
    },
    [commitInPlace],
  );

  /** Restyle an existing object's fill/stroke color and/or stroke width. */
  const applyObjectStyle = useCallback(
    async (pageIndex: number, objectIndex: number, style: PdfiumObjectStyle) => {
      const { setObjectStyle } = await import("./lib/pdfium");
      await commitInPlace((b) => setObjectStyle(b, pageIndex, objectIndex, style));
    },
    [commitInPlace],
  );

  const downloadCurrent = useCallback(async () => {
    const bytes = await bakeToBytes();
    if (!bytes || !active) return;
    const base = active.name.replace(/\.pdf$/i, "");
    downloadBytes(bytes, `${base}-edited.pdf`);
    toast.success("PDF downloaded");
  }, [bakeToBytes, active]);

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
      void persistDoc({
        id: active.id,
        name: next,
        bytes: active.bytes,
        lastOpened: Date.now(),
        open: true,
      }).then(refreshRecent);
      // Browsers can't rename a file through its handle — be explicit about
      // what the rename actually affects.
      toast.success(
        docHandles.current.get(active.id)
          ? `Renamed to ${next} in PickPDF — the file on disk keeps its original name`
          : `Renamed to ${next} — saved copies will use this name`,
      );
    },
    [active, updateDoc, refreshRecent],
  );

  const saveCurrent = useCallback(async () => {
    if (!active) return;
    const handle = docHandles.current.get(active.id);
    try {
      const baked = await bakeToBytes();
      if (!baked) return;
      if (handle) {
        if (handle.requestPermission) {
          const perm = await handle.requestPermission({ mode: "readwrite" });
          if (perm !== "granted") throw new Error("write permission denied");
        }
        const writable = await handle.createWritable();
        await writable.write(baked as unknown as BufferSource);
        await writable.close();
        toast.success(`Saved to ${active.name}`);
      } else {
        downloadBytes(baked, `${active.name.replace(/\.pdf$/i, "")}-edited.pdf`);
        toast.success("PDF saved (downloaded)");
      }
      // Commit in-app state to the saved bytes.
      if (docHasEdits(active)) {
        const nextPdf = await loadPdf(baked);
        destroyDocProxies(active, nextPdf);
        updateDoc(active.id, {
          bytes: baked,
          pdf: nextPdf,
          annotations: {},
          history: [{}],
          bytesHistory: [{ bytes: baked, pdf: nextPdf }],
          historyIndex: 0,
          formValues: {},
          fieldOps: {},
        });
        setDocVersion((v) => v + 1);
        setSelected(null);
      }
      void persistDoc({
        id: active.id,
        name: active.name,
        bytes: baked,
        lastOpened: Date.now(),
        open: true,
      });
      // Saving ends the editing session — no separate "Done" needed.
      setEditModeState(false);
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : "error"} — downloading a copy instead.`,
      );
      await downloadCurrent();
    }
  }, [active, bakeToBytes, downloadCurrent, updateDoc]);

  const [ocrBusy, setOcrBusy] = useState(false);
  const runOcrText = useCallback(async () => {
    if (!active || ocrBusy) return;
    const id = active.id;
    setOcrBusy(true);
    const toastId = toast.loading("Preparing OCR… (first run downloads a model)");
    try {
      const { runOcr } = await import("./lib/ocr");
      const ocr = await runOcr(active.pdf, (page, total, phase) => {
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
      // Bake any pending edits first, then add the invisible OCR text layer.
      let base = active.bytes;
      if (docHasEdits(active)) {
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
      updateDoc(id, {
        bytes: next,
        pdf: nextPdf,
        annotations: {},
        history: [{}],
        bytesHistory: [{ bytes: next, pdf: nextPdf }],
        historyIndex: 0,
        formValues: {},
        fieldOps: {},
      });
      setDocVersion((v) => v + 1);
      setSelected(null);
      void persistDoc({
        id,
        name: active.name,
        bytes: next,
        lastOpened: Date.now(),
        open: true,
      });
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
  }, [active, ocrBusy, updateDoc]);

  useEffect(() => {
    runOcrRef.current = runOcrText;
  }, [runOcrText]);

  const printCurrent = useCallback(async () => {
    const bytes = await bakeToBytes();
    if (!bytes) return;
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
  }, [bakeToBytes]);

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
    async (q: string) => {
      setSearchQuery(q);
      if (!active?.pdf || !q.trim()) {
        setSearchMatches([]);
        return;
      }
      const matches = await searchDocument(active.pdf, q);
      setSearchMatches(matches);
      setActiveMatch(0);
      if (matches.length) scrollToPage(matches[0].page);
    },
    [active, scrollToPage],
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

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchMatches([]);
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

  const value: AppStore = {
    theme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    accent,
    setAccent,
    screen,
    setScreen,
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    panes,
    activePaneId,
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
    pdf: active?.pdf ?? null,
    numPages: active?.pdf?.numPages ?? 0,
    docVersion,
    openFile,
    openBytes,
    requestOpen,
    registerFileHandle,
    activeHasHandle: !!(activeTabId && docHandles.current.has(activeTabId)),
    saveCurrent,
    recentFiles,
    openRecent,
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
    applyTextStyle,
    getPageObjects,
    applyObjectTransform,
    removeObjectAt,
    applyObjectStyle,
    downloadCurrent,
    printCurrent,
    ocrBusy,
    runOcrText,
    currentPage: active?.currentPage ?? 0,
    setCurrentPage,
    scrollToPage,
    scale,
    setScale,
    fitMode,
    setFitMode,
    editMode,
    setEditMode,
    tool,
    setTool,
    toolColor,
    highlightColor,
    setHighlightColor,
    setToolColor,
    toolFill,
    setToolFill,
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
    annotations,
    hasAnnotations,
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
    editRequestId,
    setEditRequestId,
    pendingStamp,
    setPendingStamp,
    formValues: active?.formValues ?? {},
    setFormValue,
    fieldOps: active?.fieldOps ?? {},
    upsertFieldOp,
    selectedField,
    setSelectedField,
    searchQuery,
    searchMatches,
    activeMatch,
    runSearch,
    gotoMatch,
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
        getPageTextObjects,
        applyTextEdit,
        applyTextStyle,
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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

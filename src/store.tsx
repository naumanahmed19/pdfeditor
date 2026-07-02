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
import type { PDFDocumentProxy } from "pdfjs-dist";
import { toast } from "sonner";
import type {
  Annotation,
  AnnotationMap,
  AppSettings,
  ExistingFieldOp,
  FontFamilyKind,
  SavedSignature,
  Screen,
  SearchMatch,
  ToolKind,
} from "./types";
import { loadPdf, searchDocument } from "./lib/pdf";
import { bakeAnnotations } from "./lib/pdftools";
import { DEFAULT_SETTINGS } from "./lib/ai";
import { downloadBytes, uid } from "./lib/utils";
import {
  getStoredDoc,
  listStoredDocs,
  markDocClosed,
  persistDoc,
} from "./lib/persist";

const SETTINGS_KEY = "pdf-workbench-settings";
const SIGNATURES_KEY = "pdf-workbench-signatures";
const THEME_KEY = "pdf-workbench-theme";

export interface PendingStamp {
  dataUrl: string;
  aspect: number; // height / width
}

interface OpenDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  annotations: AnnotationMap;
  history: AnnotationMap[];
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

  screen: Screen;
  setScreen: (s: Screen) => void;

  /** Open documents as tabs; all doc-scoped fields below refer to the active tab. */
  tabs: TabInfo[];
  activeTabId: string | null;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;

  docName: string | null;
  docBytes: Uint8Array | null;
  pdf: PDFDocumentProxy | null;
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
  /** Bake pending annotations, then run a structural pdf-lib op on the bytes. */
  applyBytesOp: (
    op: (bytes: Uint8Array) => Promise<Uint8Array>,
    label: string,
  ) => Promise<void>;
  bakeToBytes: () => Promise<Uint8Array | null>;
  downloadCurrent: () => Promise<void>;
  printCurrent: () => Promise<void>;

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
  setToolColor: (c: string) => void;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem(THEME_KEY) as "light" | "dark") || "light",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const [screen, setScreen] = useState<Screen>("viewer");
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
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

  const [editMode, setEditModeState] = useState(false);
  const [tool, setTool] = useState<ToolKind>("select");
  const [toolColor, setToolColor] = useState("#e11d48");
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

  const [aiOpen, setAiOpen] = useState(true);
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
      updateDoc(activeTabId, (d) => {
        const trimmed = d.history.slice(0, d.historyIndex + 1);
        const appended = [...trimmed, next].slice(-60);
        return {
          annotations: next,
          history: appended,
          historyIndex: appended.length - 1,
        };
      });
    },
    [activeTabId, updateDoc],
  );

  const annotations = active?.annotations ?? {};

  const addAnnotation = useCallback(
    (page: number, ann: Annotation) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const next = {
          ...d.annotations,
          [page]: [...(d.annotations[page] ?? []), ann],
        };
        const trimmed = d.history.slice(0, d.historyIndex + 1);
        const appended = [...trimmed, next].slice(-60);
        return { annotations: next, history: appended, historyIndex: appended.length - 1 };
      });
    },
    [activeTabId, updateDoc],
  );

  const addAnnotationsMany = useCallback(
    (page: number, anns: Annotation[]) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const next = {
          ...d.annotations,
          [page]: [...(d.annotations[page] ?? []), ...anns],
        };
        const trimmed = d.history.slice(0, d.historyIndex + 1);
        const appended = [...trimmed, next].slice(-60);
        return { annotations: next, history: appended, historyIndex: appended.length - 1 };
      });
    },
    [activeTabId, updateDoc],
  );

  const updateAnnotation = useCallback(
    (page: number, ann: Annotation) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const next = {
          ...d.annotations,
          [page]: (d.annotations[page] ?? []).map((a) => (a.id === ann.id ? ann : a)),
        };
        const trimmed = d.history.slice(0, d.historyIndex + 1);
        const appended = [...trimmed, next].slice(-60);
        return { annotations: next, history: appended, historyIndex: appended.length - 1 };
      });
    },
    [activeTabId, updateDoc],
  );

  const removeAnnotation = useCallback(
    (page: number, id: string) => {
      if (!activeTabId) return;
      updateDoc(activeTabId, (d) => {
        const list = d.annotations[page] ?? [];
        const target = list.find((a) => a.id === id);
        const next = {
          ...d.annotations,
          [page]: list.filter(
            (a) => a.id !== id && !(target?.groupId && a.groupId === target.groupId),
          ),
        };
        const trimmed = d.history.slice(0, d.historyIndex + 1);
        const appended = [...trimmed, next].slice(-60);
        return { annotations: next, history: appended, historyIndex: appended.length - 1 };
      });
      setSelected(null);
    },
    [activeTabId, updateDoc],
  );

  const clearAnnotations = useCallback(() => {
    if (!activeTabId) return;
    updateDoc(activeTabId, { annotations: {}, history: [{}], historyIndex: 0 });
    setSelected(null);
  }, [activeTabId, updateDoc]);

  const undo = useCallback(() => {
    if (!activeTabId) return;
    updateDoc(activeTabId, (d) => {
      const next = Math.max(0, d.historyIndex - 1);
      return { historyIndex: next, annotations: d.history[next] ?? {} };
    });
    setSelected(null);
  }, [activeTabId, updateDoc]);

  const redo = useCallback(() => {
    if (!activeTabId) return;
    updateDoc(activeTabId, (d) => {
      const next = Math.min(d.history.length - 1, d.historyIndex + 1);
      return { historyIndex: next, annotations: d.history[next] ?? {} };
    });
  }, [activeTabId, updateDoc]);

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
  }, []);

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const docHandles = useRef(new Map<string, any>());

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

  const registerFileHandle = useCallback((id: string, handle: unknown) => {
    docHandles.current.set(id, handle);
  }, []);

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
        setActiveTabId(id);
        setDocVersion((v) => v + 1);
        resetTransient();
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
    [docs, openBytesInternal, resetTransient, refreshRecent],
  );

  const switchTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return;
      setActiveTabId(id);
      setDocVersion((v) => v + 1);
      resetTransient();
      setScreen("viewer");
    },
    [activeTabId, resetTransient],
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
        active.pdf.destroy().catch(() => {});
        updateDoc(id, {
          bytes: nextBytes,
          pdf: nextPdf,
          annotations: {},
          history: [{}],
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
        active.pdf.destroy().catch(() => {});
        updateDoc(active.id, {
          bytes: baked,
          pdf: nextPdf,
          annotations: {},
          history: [{}],
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
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : "error"} — downloading a copy instead.`,
      );
      await downloadCurrent();
    }
  }, [active, bakeToBytes, downloadCurrent, updateDoc]);

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

  const setEditMode = useCallback((v: boolean) => {
    setEditModeState(v);
    if (!v) {
      setTool("select");
      setSelected(null);
      setPendingStamp(null);
    }
  }, []);

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
    screen,
    setScreen,
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    docName: active?.name ?? null,
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
    applyBytesOp,
    bakeToBytes,
    downloadCurrent,
    printCurrent,
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
    setToolColor,
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
    settings,
    setSettings,
    signatures,
    addSignature,
    removeSignature,
    signatureModalOpen,
    setSignatureModalOpen,
  };

  // Dev-only hook for driving the app from automated tests.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__pdfwb = { setScreen, switchTab, setEditMode, setTool };
    }
  }, [switchTab, setEditMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

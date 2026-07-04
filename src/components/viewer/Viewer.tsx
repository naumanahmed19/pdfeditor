import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bold,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Italic,
  Maximize,
  MessageSquare,
  Minimize,
  MoveHorizontal,
  Scan,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PdfDoc, PdfPage } from "../../lib/pdf";
import { renderTextLayer } from "../../lib/pdf";
import { FillControl, StrokeWidthSelect, TextStyleControls } from "./StyleControls";
import { RichTextEditor, type RichTextHandle } from "./RichTextEditor";
import {
  getRuns,
  measureRichText,
  mergeRuns,
  rangeStyleValue,
  runsText,
  runsToHtml,
} from "../../lib/richtext";
import { activeTextEditor } from "../../lib/activeTextEditor";
import { toast } from "sonner";
import { useApp } from "../../store";
import type { Annotation, FormFieldAnnotation, NoteAnnotation, TextAnnotation } from "../../types";
import { cn, uid } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ColorSwatch } from "../ui/color-swatch";
import { Input } from "../ui/input";
import { Popover, PopoverContent } from "../ui/popover";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

const PAGE_GAP = 24;

/**
 * Fonts whose substitution is close enough not to warn about: the PDF
 * standard families and their common metric-compatible equivalents.
 */
let warnedWhiteout = false;
function warnWhiteoutOnce() {
  if (warnedWhiteout) return;
  warnedWhiteout = true;
  toast.warning("Whiteout hides text, it doesn't remove it", {
    description:
      "The covered text still exists inside the saved PDF and can be selected or extracted. Don't use whiteout to redact confidential information.",
    duration: 9000,
  });
}

/** CSS font properties for displaying a text annotation on screen. */
/** Single source of truth for text line spacing (editor, display, sizing). */
const TEXT_LINE_HEIGHT = 1.25;

/**
 * Style values to show in the controls. When a box is being edited with a
 * selection, reflect the selection's resolved style so the swatch/size match
 * what you'd change; otherwise the box-level style.
 */
function textStyleValue(ann: TextAnnotation) {
  const editor = activeTextEditor.current;
  const sel = editor?.annId === ann.id ? editor.selection?.() : null;
  if (sel) {
    const runs = getRuns(ann);
    const at = <
      K extends "color" | "fontSize" | "fontFamily" | "bold" | "italic" | "underline" | "strike",
    >(
      k: K,
      fb: NonNullable<ReturnType<typeof rangeStyleValue<K>>>,
    ) => rangeStyleValue(runs, sel.start, sel.end, k, ann) ?? fb;
    return {
      color: at("color", ann.color),
      fontFamily: at("fontFamily", ann.fontFamily ?? "helvetica"),
      fontSize: at("fontSize", ann.fontSize),
      bold: at("bold", !!ann.bold),
      italic: at("italic", !!ann.italic),
      underline: at("underline", !!ann.underline),
      strike: at("strike", !!ann.strike),
      align: ann.align ?? ("left" as const),
    };
  }
  return {
    color: ann.color ?? "#111111",
    fontFamily: ann.fontFamily ?? "helvetica",
    fontSize: ann.fontSize,
    bold: !!ann.bold,
    italic: !!ann.italic,
    underline: !!ann.underline,
    strike: !!ann.strike,
    align: ann.align ?? ("left" as const),
  };
}

function textAnnCss(ann: TextAnnotation): React.CSSProperties {
  const fallback =
    ann.fontFamily === "times"
      ? "'Times New Roman', Times, serif"
      : ann.fontFamily === "courier"
        ? "'Courier New', Courier, monospace"
        : ann.fontFamily === "carlito"
          ? "Carlito, Calibri, sans-serif"
          : ann.fontFamily === "caladea"
            ? "Caladea, Cambria, serif"
            : "Helvetica, Arial, sans-serif";
  return {
    fontFamily: ann.displayFontCss || fallback,
    fontWeight: ann.bold ? 700 : 400,
    fontStyle: ann.italic ? "italic" : "normal",
  };
}

interface PageDims {
  width: number;
  height: number;
}

export function Viewer() {
  const app = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<PageDims[]>([]);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const pdf = app.pdf;

  // Measure base page sizes (scale 1, rotation applied).
  useEffect(() => {
    let alive = true;
    if (!pdf) {
      setDims([]);
      return;
    }
    (async () => {
      const out: PageDims[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        out.push({ width: vp.width, height: vp.height });
      }
      if (alive) setDims(out);
    })();
    return () => {
      alive = false;
    };
  }, [pdf, app.docVersion]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure();
    return () => obs.disconnect();
  }, []);

  // Fit-to-width / fit-to-page scale
  const maxPage = useMemo(
    () =>
      dims.reduce(
        (m, d) => ({
          width: Math.max(m.width, d.width),
          height: Math.max(m.height, d.height),
        }),
        { width: 0, height: 0 },
      ),
    [dims],
  );
  const effectiveScale = useMemo(() => {
    if (maxPage.width > 0 && containerSize.w > 0) {
      if (app.fitMode === "width") {
        return Math.min(2.5, Math.max(0.3, (containerSize.w - 64) / maxPage.width));
      }
      if (app.fitMode === "page") {
        return Math.min(
          2.5,
          Math.max(
            0.2,
            Math.min(
              (containerSize.w - 64) / maxPage.width,
              (containerSize.h - 48) / maxPage.height,
            ),
          ),
        );
      }
    }
    return app.scale;
  }, [app.fitMode, app.scale, maxPage, containerSize]);

  // Restore the last viewed page when returning to this tab (the Viewer is
  // remounted per tab, so this runs once after page sizes are known).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !dims.length) return;
    restoredRef.current = true;
    const page = app.currentPage;
    if (page > 0) {
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-page-index="${page}"]`)
          ?.scrollIntoView({ block: "start" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims]);

  // Scroll-to-page events
  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent).detail?.page as number;
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-page-index="${page}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("pdfwb:scroll-to-page", handler);
    return () => window.removeEventListener("pdfwb:scroll-to-page", handler);
  }, []);

  // Track current page from scroll position
  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let acc = 0;
    for (let i = 0; i < dims.length; i++) {
      const h = dims[i].height * effectiveScale + PAGE_GAP;
      if (mid < acc + h) {
        if (app.currentPage !== i) app.setCurrentPage(i);
        return;
      }
      acc += h;
    }
  }, [dims, effectiveScale, app]);

  // Convert the current text selection into highlight annotations.
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const pages = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>("[data-page-index]") ?? [],
      );
      const rects: DOMRect[] = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        rects.push(...Array.from(sel.getRangeAt(i).getClientRects()));
      }
      // Drop tiny fragments and rects fully contained in another rect.
      const cleaned = rects.filter(
        (r, i) =>
          r.width > 2 &&
          r.height > 2 &&
          !rects.some(
            (o, j) =>
              j !== i &&
              o.left <= r.left + 1 &&
              o.right >= r.right - 1 &&
              o.top <= r.top + 1 &&
              o.bottom >= r.bottom - 1 &&
              (o.width > r.width || o.height > r.height),
          ),
      );
      const groupId = uid();
      const perPage = new Map<number, Annotation[]>();
      for (const r of cleaned) {
        const pageEl = pages.find((p) => {
          const pr = p.getBoundingClientRect();
          return (
            r.left >= pr.left - 1 &&
            r.right <= pr.right + 1 &&
            r.top >= pr.top - 1 &&
            r.bottom <= pr.bottom + 1
          );
        });
        if (!pageEl) continue;
        const pr = pageEl.getBoundingClientRect();
        const idx = Number(pageEl.dataset.pageIndex);
        const list = perPage.get(idx) ?? [];
        list.push({
          id: uid(),
          kind: "highlight",
          groupId,
          x: (r.left - pr.left) / effectiveScale,
          y: (r.top - pr.top) / effectiveScale,
          w: r.width / effectiveScale,
          h: r.height / effectiveScale,
          color: app.highlightColor,
        });
        perPage.set(idx, list);
      }
      perPage.forEach((list, page) => app.addAnnotations(page, list));
      if (perPage.size) {
        sel.removeAllRanges();
        toast.success("Selection highlighted");
      }
    };
    window.addEventListener("pdfwb:highlight-selection", handler);
    return () => window.removeEventListener("pdfwb:highlight-selection", handler);
  }, [app, effectiveScale]);

  // Delete key removes selected annotation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (inField) return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        app.selected &&
        app.editMode
      ) {
        app.removeAnnotation(app.selected.page, app.selected.id);
      }
      if (
        app.selected &&
        app.editMode &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const ann = (app.annotations[app.selected.page] ?? []).find(
          (a) => a.id === app.selected!.id,
        );
        if (ann) {
          app.updateAnnotation(app.selected.page, {
            ...ann,
            x: ann.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
            y: ann.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
          });
        }
      }
      if (e.key === "Escape") {
        // First Escape clears the selection/stamp; a further Escape (nothing
        // selected) disarms the active tool back to reading.
        if (app.selected || app.pendingStamp) {
          app.setSelected(null);
          app.setPendingStamp(null);
        } else if (app.tool !== "read") {
          app.setTool("read");
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  if (!pdf) return <EmptyState />;

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="scrollbar-soft h-full overflow-auto bg-muted/60 px-8 py-6 dark:bg-background"
      >
        <div className="mx-auto flex w-fit flex-col items-center" style={{ gap: PAGE_GAP }}>
          {dims.map((d, i) => (
            <PageView
              key={`${app.docVersion}-${i}`}
              pdf={pdf}
              pageIndex={i}
              baseDims={d}
              scale={effectiveScale}
            />
          ))}
        </div>
      </div>
      <FloatingNav effectiveScale={effectiveScale} wrapperRef={containerRef} />
    </div>
  );
}

/** Translucent page/zoom pill floating at the bottom of the viewer. */
function FloatingNav({
  effectiveScale,
  wrapperRef,
}: {
  effectiveScale: number;
  wrapperRef: React.RefObject<HTMLDivElement>;
}) {
  const app = useApp();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Close the popup menus on any click outside them. (A fixed-position
  // backdrop doesn't work here: the pill's backdrop-blur re-anchors fixed
  // children to the pill, so it never covers the viewport.)
  useEffect(() => {
    if (!aiMenuOpen && !zoomMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-floating-menu]")) {
        setAiMenuOpen(false);
        setZoomMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [aiMenuOpen, zoomMenuOpen]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void wrapperRef.current?.parentElement?.requestFullscreen();
    }
  };

  const navBtn =
    "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/60 bg-background/75 px-2 py-1 opacity-80 shadow-shell backdrop-blur-md transition-opacity hover:opacity-100",
          (aiMenuOpen || zoomMenuOpen) && "opacity-100",
        )}
      >
        <button
          className={navBtn}
          title="Previous page"
          disabled={app.currentPage <= 0}
          onClick={() => app.scrollToPage(app.currentPage - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1 px-0.5 text-xs tabular-nums text-muted-foreground">
          <input
            type="number"
            min={1}
            max={app.numPages}
            value={app.currentPage + 1}
            onChange={(e) => {
              const v = Number(e.target.value) - 1;
              if (v >= 0 && v < app.numPages) app.scrollToPage(v);
            }}
            className="h-6 w-9 rounded-md bg-transparent text-center text-xs text-foreground outline-none transition focus:bg-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span>/ {app.numPages}</span>
        </div>
        <button
          className={navBtn}
          title="Next page"
          disabled={app.currentPage >= app.numPages - 1}
          onClick={() => app.scrollToPage(app.currentPage + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        <button
          className={navBtn}
          title="Zoom out"
          onClick={() => {
            app.setFitMode(null);
            app.setScale(Math.max(0.3, effectiveScale - 0.15));
          }}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <div className="relative" data-floating-menu>
          <button
            className={cn(
              "flex h-6 min-w-11 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              zoomMenuOpen && "bg-accent text-foreground",
            )}
            title="Zoom options"
            onClick={() => setZoomMenuOpen((o) => !o)}
          >
            {app.fitMode === "width" ? (
              <MoveHorizontal className="h-4 w-4" />
            ) : app.fitMode === "page" ? (
              <Scan className="h-4 w-4" />
            ) : (
              `${Math.round(effectiveScale * 100)}%`
            )}
          </button>
          {zoomMenuOpen && (
            <>
              <div className="absolute bottom-9 left-1/2 z-20 flex w-44 -translate-x-1/2 flex-col rounded-lg border bg-popover p-1 shadow-lg">
                {[
                  {
                    label: "Fit width",
                    icon: MoveHorizontal,
                    active: app.fitMode === "width",
                    run: () => app.setFitMode("width"),
                  },
                  {
                    label: "Fit page",
                    icon: Scan,
                    active: app.fitMode === "page",
                    run: () => app.setFitMode("page"),
                  },
                  {
                    label: "Actual size (100%)",
                    icon: null,
                    active: app.fitMode === null && Math.round(effectiveScale * 100) === 100,
                    run: () => {
                      app.setFitMode(null);
                      app.setScale(1);
                    },
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent"
                    onClick={() => {
                      setZoomMenuOpen(false);
                      item.run();
                    }}
                  >
                    {item.icon ? (
                      <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <span className="w-3.5 text-center text-[10px] text-muted-foreground">%</span>
                    )}
                    <span className="flex-1">{item.label}</span>
                    {item.active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent"
                  onClick={() => {
                    setZoomMenuOpen(false);
                    toggleFullscreen();
                  }}
                >
                  {isFullscreen ? (
                    <Minimize className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Maximize className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="flex-1">{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
                </button>
              </div>
            </>
          )}
        </div>
        <button
          className={navBtn}
          title="Zoom in"
          onClick={() => {
            app.setFitMode(null);
            app.setScale(Math.min(3, effectiveScale + 0.15));
          }}
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        <div className="relative" data-floating-menu>
          <button
            className={cn(navBtn, (aiMenuOpen || app.aiOpen) && "bg-accent text-foreground")}
            title="AI actions for this page"
            onClick={() => setAiMenuOpen((o) => !o)}
          >
            <Bot className="h-4 w-4" />
          </button>
          {aiMenuOpen && (
            <>
              <div className="absolute bottom-9 right-0 z-20 flex w-48 flex-col rounded-lg border bg-popover p-1 shadow-lg">
                {[
                  ["Summarize this page", `Summarize page ${app.currentPage + 1} in a few short paragraphs.`],
                  ["Explain this page", `Explain what page ${app.currentPage + 1} is about in simple terms.`],
                  ["Key points of this page", `Extract the key points of page ${app.currentPage + 1} as a bullet list.`],
                ].map(([label, prompt]) => (
                  <button
                    key={label}
                    className="rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent"
                    onClick={() => {
                      setAiMenuOpen(false);
                      app.askAi(prompt);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                <button
                  className="rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent"
                  onClick={() => {
                    setAiMenuOpen(false);
                    const next = !app.aiOpen;
                    app.setAiOpen(next);
                    if (next && app.isMobile) app.setSidebarOpen(false);
                  }}
                >
                  {app.aiOpen ? "Hide assistant" : "Open assistant"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className="flex h-full items-center justify-center p-8"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        // Grab file-system handles synchronously (the list is neutered after
        // the first await) so dropped files support save-in-place.
        const handlePromises = Array.from(e.dataTransfer.items ?? []).map(
          (item) => (item as any).getAsFileSystemHandle?.() ?? null,
        );
        const files = Array.from(e.dataTransfer.files ?? []);
        void (async () => {
          const handles = await Promise.all(handlePromises);
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (f.type !== "application/pdf" && !f.name.endsWith(".pdf")) continue;
            const id = await app.openBytes(
              new Uint8Array(await f.arrayBuffer()),
              f.name,
            );
            const h = handles[i];
            if (id && h?.kind === "file") app.registerFileHandle(id, h);
          }
        })();
      }}
    >
      <div
        className={cn(
          "flex w-full max-w-lg cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-card px-10 py-16 text-center shadow-shell transition-colors",
          dragOver ? "border-foreground/50 bg-accent" : "border-border",
        )}
        onClick={() => fileRef.current?.click()}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">Drop a PDF here, or click to browse</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Read, annotate, sign and edit PDFs. Use the tools in the sidebar to
          merge, split, organize and watermark documents — or ask the AI
          assistant about the content.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void app.openFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PageView({
  pdf,
  pageIndex,
  baseDims,
  scale,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  baseDims: PageDims;
  scale: number;
}) {
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(0);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const w = baseDims.width * scale;
  const h = baseDims.height * scale;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: "800px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Render canvas + text layer when visible or scale changes
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const canvas = canvasRef.current;
      const textDiv = textLayerRef.current;
      if (!canvas || !textDiv) return;
      let page: PdfPage;
      try {
        page = await pdf.getPage(pageIndex + 1);
      } catch {
        return;
      }
      if (cancelled) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport });
      renderTask.current = task as any;
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }

      // Text layer at CSS scale
      if (cancelled) return;
      try {
        renderTextLayer(page, textDiv, scale);
        if (!cancelled) setTextLayerReady((v) => v + 1);
      } catch {
        /* text layer optional */
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, pageIndex, scale, visible]);

  // Search highlighting on the text layer — wraps only the matched
  // substring in a mark, not the whole text run.
  useEffect(() => {
    const textDiv = textLayerRef.current;
    if (!textDiv) return;
    const spans = Array.from(
      textDiv.querySelectorAll<HTMLElement>(":scope > span"),
    );
    // Restore any previously marked spans to their original text.
    for (const s of spans) {
      if (s.dataset.searchOriginal !== undefined) {
        s.textContent = s.dataset.searchOriginal;
        delete s.dataset.searchOriginal;
      }
    }
    const q = app.searchQuery.trim().toLowerCase();
    if (!q) return;
    const pageMatches = app.searchMatches.filter((m) => m.page === pageIndex);
    if (!pageMatches.length) return;

    const active = app.searchMatches[app.activeMatch];
    const hitSpans = spans.filter((s) =>
      s.textContent?.toLowerCase().includes(q),
    );
    const activeIdx =
      active && active.page === pageIndex
        ? pageMatches.findIndex((m) => m.itemIndex === active.itemIndex)
        : -1;

    hitSpans.forEach((span, spanIdx) => {
      const text = span.textContent ?? "";
      const lower = text.toLowerCase();
      span.dataset.searchOriginal = text;
      const frag = document.createDocumentFragment();
      let pos = 0;
      let at: number;
      while ((at = lower.indexOf(q, pos)) !== -1) {
        if (at > pos) frag.appendChild(document.createTextNode(text.slice(pos, at)));
        const mark = document.createElement("span");
        mark.className =
          spanIdx === activeIdx ? "search-mark search-mark-active" : "search-mark";
        mark.textContent = text.slice(at, at + q.length);
        frag.appendChild(mark);
        pos = at + q.length;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      span.replaceChildren(frag);
    });
  }, [
    app.searchQuery,
    app.searchMatches,
    app.activeMatch,
    pageIndex,
    textLayerReady,
  ]);

  // Text is selectable for reading/copy (read tool) and for click-to-edit
  // (edittext). The Select tool grabs page OBJECTS instead (via ObjectLayer),
  // so text stays non-selectable there.
  const textSelectable =
    (app.tool === "read" || app.tool === "edittext") && !app.pendingStamp;

  // "Edit existing text": clicking a text run maps the click to the real
  // PDFium content-stream text object and opens an inline editor over it. On
  // commit the object's string is rewritten in place (same font/size/color/
  // position) — no whiteout patch, no overlay copy, original text truly gone.
  const onTextLayerClick = async (e: React.MouseEvent) => {
    if (app.tool !== "edittext" || !app.docBytes || !wrapRef.current) return;
    const pr = wrapRef.current.getBoundingClientRect();

    let objs;
    let viewport;
    try {
      // pdf.js viewport maps PDFium's (unrotated) page space to the on-screen
      // rendering — this is what keeps the editor aligned on rotated/cropped
      // pages instead of guessing with a manual y-flip.
      const page = await pdf.getPage(pageIndex + 1);
      viewport = page.getViewport({ scale });
      objs = await app.getPageTextObjects(pageIndex);
    } catch {
      toast.error("Couldn't read this page's text for editing.");
      return;
    }
    // Click point in PDF page coordinates (handles rotation + crop origin).
    const [xPt, yPt] = viewport.convertToPdfPoint(
      e.clientX - pr.left,
      e.clientY - pr.top,
    );
    // Smallest text run whose bounds contain the click point.
    const hit = objs
      .filter(
        (o) =>
          o.text.trim() &&
          xPt >= o.left &&
          xPt <= o.right &&
          yPt >= o.bottom &&
          yPt <= o.top,
      )
      .sort(
        (a, b) =>
          (a.right - a.left) * (a.top - a.bottom) -
          (b.right - b.left) * (b.top - b.bottom),
      )[0];
    if (!hit) {
      toast.info("Click directly on a line of text to edit it.");
      return;
    }
    // Map the run's PDF-space box to the exact on-screen rectangle.
    const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
      hit.left,
      hit.bottom,
      hit.right,
      hit.top,
    ]);
    const [r, g, b] = hit.color;
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    const f = detectFontFromName(hit.fontName || "");
    setInlineEdit({
      objectIndex: hit.index,
      original: hit.text,
      left: Math.min(vx1, vx2),
      top: Math.min(vy1, vy2),
      width: Math.max(Math.abs(vx2 - vx1), 24),
      height: Math.max(Math.abs(vy2 - vy1), hit.fontSize * scale),
      fontPx: hit.fontSize * scale,
      color: `rgb(${r}, ${g}, ${b})`,
      colorHex: hex,
      fontSize: hit.fontSize,
      fontFamily: f.family,
      bold: f.bold,
      italic: f.italic,
    });
  };

  const commitInlineEdit = async (
    text: string,
    colorHex: string,
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean,
  ) => {
    const edit = inlineEdit;
    if (!edit) return;
    const textChanged = text !== edit.original && text.trim().length > 0;
    const colorChanged = colorHex.toLowerCase() !== edit.colorHex.toLowerCase();
    const sizeChanged = fontSize > 0 && fontSize !== Math.round(edit.fontSize);
    const fontChanged =
      fontFamily !== edit.fontFamily || bold !== edit.bold || italic !== edit.italic;
    if (!textChanged && !colorChanged && !sizeChanged && !fontChanged) {
      setInlineEdit(null);
      return;
    }
    const fill: [number, number, number, number] = [
      parseInt(colorHex.slice(1, 3), 16),
      parseInt(colorHex.slice(3, 5), 16),
      parseInt(colorHex.slice(5, 7), 16),
      255,
    ];
    setSavingEdit(true);
    try {
      if (fontChanged) {
        // Changing the font recreates the run — pass everything absolutely.
        const font = await resolveTextFont(fontFamily, bold, italic);
        await app.applyTextStyle(pageIndex, edit.objectIndex, {
          text,
          fill,
          fontSize,
          font,
        });
      } else {
        await app.applyTextStyle(pageIndex, edit.objectIndex, {
          text: textChanged ? text : undefined,
          fill: colorChanged ? fill : undefined,
          fontScale: sizeChanged ? fontSize / edit.fontSize : undefined,
        });
      }
    } catch {
      toast.error(
        "Couldn't edit this text in place — its font may not be embeddable. Use the Text tool to overlay a correction instead.",
      );
    } finally {
      setSavingEdit(false);
      setInlineEdit(null);
    }
  };

  return (
    <div
      ref={wrapRef}
      data-page-index={pageIndex}
      className="relative shrink-0 bg-white shadow-shell ring-1 ring-border/60"
      style={{ width: w, height: h, scrollMarginTop: 16 }}
      onPointerDown={() => {
        if (app.tool === "select") {
          app.setSelected(null);
          app.setSelectedField(null);
        }
      }}
    >
      {visible && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
        />
      )}
      <div
        ref={textLayerRef}
        className={cn("textLayer", app.tool === "edittext" && "edit-mode")}
        style={{
          pointerEvents: textSelectable ? "auto" : "none",
          cursor: app.tool === "edittext" ? "text" : undefined,
        }}
        onClick={onTextLayerClick}
      />
      <LinkLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      {/* Object editing lives on the Select tool (in edit mode). Rendered
          BELOW the form and annotation layers so form fields and your own
          annotations keep priority — clicks that miss them fall through here. */}
      {app.editMode && app.tool === "select" && visible && (
        <ObjectLayer
          pdf={pdf}
          pageIndex={pageIndex}
          scale={scale}
          canvasRef={canvasRef}
        />
      )}
      <FormLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      <AnnotationLayer pageIndex={pageIndex} scale={scale} baseDims={baseDims} />
      {inlineEdit && (
        <InlineTextEditor
          edit={inlineEdit}
          saving={savingEdit}
          onCommit={commitInlineEdit}
          onCancel={() => setInlineEdit(null)}
        />
      )}
    </div>
  );
}

interface InlineEdit {
  objectIndex: number;
  original: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontPx: number;
  /** Original ink color as an rgb() string (for on-screen display). */
  color: string;
  /** Original ink color as hex (for the color control). */
  colorHex: string;
  /** Original font size in PDF points. */
  fontSize: number;
  /** Detected original font, so we only recreate the run when it changes. */
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

// Standard-14 font names by [regular, bold, italic, bold-italic].
const STD_FONT_NAMES: Record<string, [string, string, string, string]> = {
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};
const BUNDLED_FONT_FILES: Record<string, [string, string, string, string]> = {
  carlito: [
    "/fonts/Carlito-Regular.ttf",
    "/fonts/Carlito-Bold.ttf",
    "/fonts/Carlito-Italic.ttf",
    "/fonts/Carlito-BoldItalic.ttf",
  ],
  caladea: [
    "/fonts/Caladea-Regular.ttf",
    "/fonts/Caladea-Bold.ttf",
    "/fonts/Caladea-Italic.ttf",
    "/fonts/Caladea-BoldItalic.ttf",
  ],
};
const FONT_CSS: Record<string, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
  carlito: "Carlito, Calibri, sans-serif",
  caladea: "Caladea, Cambria, serif",
};

/** Best-effort family/weight/slant from a PDF base font name. */
function detectFontFromName(name: string): { family: string; bold: boolean; italic: boolean } {
  const n = name.replace(/^[A-Z]{6}\+/, "");
  let family = "helvetica";
  if (/calibri|carlito/i.test(n)) family = "carlito";
  else if (/cambria|caladea/i.test(n)) family = "caladea";
  else if (/courier|mono/i.test(n)) family = "courier";
  else if (/times|georgia|garamond|roman|serif/i.test(n) && !/sans/i.test(n)) family = "times";
  return {
    family,
    bold: /bold|black|heavy|semib|demib/i.test(n),
    italic: /italic|oblique/i.test(n),
  };
}

/** Resolve a family+weight+slant to a PDFium font (standard name or TTF bytes). */
async function resolveTextFont(
  family: string,
  bold: boolean,
  italic: boolean,
): Promise<{ standardName?: string; bytes?: Uint8Array }> {
  const idx = (bold ? 1 : 0) + (italic ? 2 : 0);
  if (STD_FONT_NAMES[family]) return { standardName: STD_FONT_NAMES[family][idx] };
  const files = BUNDLED_FONT_FILES[family];
  if (files) {
    try {
      const bytes = new Uint8Array(await (await fetch(files[idx])).arrayBuffer());
      return { bytes };
    } catch {
      /* fall back to the metric-compatible standard font */
    }
  }
  const sub = family === "caladea" ? "times" : "helvetica";
  return { standardName: STD_FONT_NAMES[sub][idx] };
}

/**
 * Inline editor shown over a text run while editing it in place. It's a
 * transient input (not a persisted annotation) — on commit the underlying
 * PDFium text object is rewritten and the page re-renders from real bytes.
 */
function InlineTextEditor({
  edit,
  saving,
  onCommit,
  onCancel,
}: {
  edit: InlineEdit;
  saving: boolean;
  onCommit: (
    text: string,
    colorHex: string,
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(edit.original);
  const [colorHex, setColorHex] = useState(edit.colorHex);
  const [sizePt, setSizePt] = useState(Math.round(edit.fontSize));
  const [family, setFamily] = useState(edit.fontFamily);
  const [bold, setBold] = useState(edit.bold);
  const [italic, setItalic] = useState(edit.italic);
  const done = useRef(false);

  useEffect(() => {
    window.getSelection()?.removeAllRanges();
    const t = ref.current;
    if (t) {
      t.focus({ preventScroll: true });
      t.select();
    }
  }, []);

  // Commit once — guard against Enter followed by the unmount blur firing twice.
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value, colorHex, sizePt, family, bold, italic);
  };

  // Live-preview the size change on screen (px per point from the original).
  const pxPerPt = edit.fontPx / (edit.fontSize || 1);
  const fontPx = sizePt * pxPerPt;
  const boxH = Math.max(edit.height, fontPx * 1.25);
  const top = edit.top + edit.height / 2 - boxH / 2;

  const stepBtn =
    "flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <div
      className="absolute z-30"
      style={{ left: edit.left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      // Commit when focus leaves the whole editor (bar or textarea).
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) finish();
      }}
    >
      {/* Options bar: font, color, size. Native <select> (not the base-ui one)
          so the dropdown doesn't portal focus out and commit prematurely. */}
      <div className="absolute bottom-full left-0 mb-1 flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-1.5 py-1 shadow-md">
        <select
          value={family}
          disabled={saving}
          onChange={(e) => setFamily(e.target.value)}
          title="Font"
          className="h-6 rounded border border-input bg-background px-1 text-xs text-foreground"
        >
          <option value="helvetica">Helvetica</option>
          <option value="times">Times</option>
          <option value="courier">Courier</option>
          <option value="carlito">Carlito</option>
          <option value="caladea">Caladea</option>
        </select>
        <button
          type="button"
          className={cn(stepBtn, bold && "bg-accent text-foreground")}
          title="Bold"
          disabled={saving}
          onClick={() => setBold((v) => !v)}
        >
          <Bold className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={cn(stepBtn, italic && "bg-accent text-foreground")}
          title="Italic"
          disabled={saving}
          onClick={() => setItalic((v) => !v)}
        >
          <Italic className="h-3 w-3" />
        </button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <ColorSwatch
          value={colorHex}
          disabled={saving}
          onChange={setColorHex}
          title="Text color"
          className="h-5 w-5"
        />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <button
          type="button"
          className={stepBtn}
          title="Smaller"
          disabled={saving}
          onClick={() => setSizePt((s) => Math.max(4, s - 1))}
        >
          −
        </button>
        <span className="w-6 text-center text-[11px] tabular-nums">{sizePt}</span>
        <button
          type="button"
          className={stepBtn}
          title="Larger"
          disabled={saving}
          onClick={() => setSizePt((s) => Math.min(200, s + 1))}
        >
          +
        </button>
      </div>

      <textarea
        ref={ref}
        value={value}
        disabled={saving}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        className="block resize-none overflow-hidden whitespace-pre rounded-[2px] bg-white shadow-sm outline outline-2 outline-primary"
        style={{
          width: Math.max(edit.width + 24, 60),
          height: boxH,
          fontSize: fontPx,
          lineHeight: `${boxH}px`,
          color: colorHex,
          padding: "0 1px",
          fontFamily: FONT_CSS[family] ?? "Helvetica, Arial, sans-serif",
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? "italic" : "normal",
        }}
      />
    </div>
  );
}

interface ScreenObj {
  index: number;
  kind: "text" | "image" | "path";
  pdf: { left: number; bottom: number; right: number; top: number };
  rect: { left: number; top: number; width: number; height: number };
  fill: [number, number, number, number] | null;
  stroke: [number, number, number, number] | null;
  strokeWidth: number;
}

/**
 * A small color swatch that opens the native picker and commits the chosen
 * color once — on the input's native `change` event (fired when the picker
 * closes), not on blur or React's continuous onChange. The swatch previews the
 * live value while the picker is open.
 */
function ColorChip({
  label,
  hex,
  disabled,
  onPreview,
  onPick,
}: {
  label: string;
  hex: string;
  disabled: boolean;
  onPreview: (hex: string) => void;
  onPick: (hex: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(hex);
  useEffect(() => setPreview(hex), [hex]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => onPick(el.value);
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [onPick]);
  return (
    <div
      className="z-10 flex w-max items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <label
        className="relative block h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-black/15 shadow-sm dark:border-white/20"
        style={{ backgroundColor: preview }}
        title="Change color"
      >
        <input
          ref={ref}
          type="color"
          defaultValue={hex}
          disabled={disabled}
          className="absolute -inset-2 cursor-pointer opacity-0"
          onInput={(e) => {
            setPreview(e.currentTarget.value);
            onPreview(e.currentTarget.value);
          }}
        />
      </label>
    </div>
  );
}

const toHex = (c: [number, number, number, number]) =>
  "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
const rgbaOf = (h: string): [number, number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];

/**
 * Contextual properties panel shown above a selected page object: the relevant
 * fields for that object (fill/stroke color, stroke width), its size, and a
 * delete action. Anchored to the selection like a shadcn popover.
 */
function ObjectProperties({
  obj,
  busy,
  onFillPreview,
  onStyle,
  onDelete,
}: {
  obj: ScreenObj;
  busy: boolean;
  onFillPreview: (hex: string | null) => void;
  onStyle: (patch: {
    fill?: [number, number, number, number];
    stroke?: [number, number, number, number];
    strokeWidth?: number;
  }) => void;
  onDelete: () => void;
}) {
  const wPt = Math.round(obj.pdf.right - obj.pdf.left);
  const hPt = Math.round(obj.pdf.top - obj.pdf.bottom);
  const kindLabel = obj.kind === "text" ? "Text" : obj.kind === "image" ? "Image" : "Shape";
  const hasStroke = obj.kind === "path" && !!obj.stroke && obj.strokeWidth > 0;
  const widths = [...new Set([0.5, 1, 1.5, 2, 3, 4, 6, obj.strokeWidth].filter((w) => w > 0))].sort(
    (a, b) => a - b,
  );

  return (
    <>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {kindLabel}
      </span>
      {obj.fill && (
        <ColorChip
          label={obj.kind === "text" ? "Text" : "Fill"}
          hex={toHex(obj.fill)}
          disabled={busy}
          onPreview={(h) => {
            if (obj.kind === "path") onFillPreview(h);
          }}
          onPick={(h) => {
            onFillPreview(null);
            onStyle({ fill: rgbaOf(h) });
          }}
        />
      )}
      {hasStroke && (
        <ColorChip
          label="Stroke"
          hex={toHex(obj.stroke!)}
          disabled={busy}
          onPreview={() => {}}
          onPick={(h) => onStyle({ stroke: rgbaOf(h) })}
        />
      )}
      {hasStroke && (
        <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          Width
          <Select
            className="h-6 w-14 px-1.5 text-xs"
            value={String(obj.strokeWidth || 1)}
            disabled={busy}
            onChange={(e) => onStyle({ strokeWidth: Number(e.target.value) })}
          >
            {widths.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </label>
      )}
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
        {wPt}×{hPt} pt
      </span>
      <div className="h-4 w-px bg-border" />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title="Delete object"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

type Corner = "nw" | "ne" | "sw" | "se";
const HANDLE = 9; // px hit radius for resize handles

/**
 * Object editor (active on the Select tool in edit mode): click any existing
 * text run, image or vector shape (rectangles, lines, fills) to select it, drag
 * to move, drag a corner (images/shapes) to resize, recolor via the color chip,
 * or press Delete to remove it. Everything commits through PDFium — true
 * content-stream edits, unified undo.
 */
function ObjectLayer({
  pdf,
  pageIndex,
  scale,
  canvasRef,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const app = useApp();
  const layerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<any>(null);
  const [objects, setObjects] = useState<ScreenObj[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Live color while the picker is open (overlay only — the real recolor is
  // committed once on picker close to avoid a PDFium reload per input event).
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  // Live drag state: the moving/resizing box + a ghost image of the content.
  const [drag, setDrag] = useState<null | {
    orig: ScreenObj["rect"];
    box: ScreenObj["rect"];
    ghost?: string;
  }>(null);
  const dragRef = useRef<null | {
    mode: "move" | "resize";
    corner?: Corner;
    startX: number;
    startY: number;
    obj: ScreenObj;
    box: ScreenObj["rect"];
  }>(null);

  // (Re)load object rects whenever the page bytes change (pdf proxy swaps).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale });
        viewportRef.current = viewport;
        const objs = await app.getPageObjects(pageIndex);
        const mapped: ScreenObj[] = objs.map((o) => {
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
            o.left,
            o.bottom,
            o.right,
            o.top,
          ]);
          return {
            index: o.index,
            kind: o.kind,
            pdf: { left: o.left, bottom: o.bottom, right: o.right, top: o.top },
            rect: {
              left: Math.min(x1, x2),
              top: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            },
            fill: o.fill,
            stroke: o.stroke,
            strokeWidth: o.strokeWidth,
          };
        });
        if (alive) setObjects(mapped);
      } catch {
        if (alive) setObjects([]);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageIndex, scale]);

  const selObj = objects.find((o) => o.index === sel) ?? null;

  // Delete removes the selected object.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel != null && !busy) {
        e.preventDefault();
        setBusy(true);
        const idx = sel;
        setSel(null);
        app
          .removeObjectAt(pageIndex, idx)
          .catch(() => toast.error("Couldn't delete that object."))
          .finally(() => setBusy(false));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, busy, app, pageIndex]);

  const cornerAt = (o: ScreenObj, px: number, py: number): Corner | null => {
    const { left, top, width, height } = o.rect;
    const pts: Record<Corner, [number, number]> = {
      nw: [left, top],
      ne: [left + width, top],
      sw: [left, top + height],
      se: [left + width, top + height],
    };
    for (const c of Object.keys(pts) as Corner[]) {
      const [hx, hy] = pts[c];
      if (Math.abs(px - hx) <= HANDLE && Math.abs(py - hy) <= HANDLE) return c;
    }
    return null;
  };

  // Grab a bitmap of the object's content from the rendered page canvas.
  const cropGhost = (rect: ScreenObj["rect"]): string | undefined => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return undefined;
    const s = canvas.width / (layerRef.current?.clientWidth || canvas.width);
    const sw = Math.max(1, Math.round(rect.width * s));
    const sh = Math.max(1, Math.round(rect.height * s));
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const ctx = tmp.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(
      canvas,
      Math.round(rect.left * s),
      Math.round(rect.top * s),
      sw,
      sh,
      0,
      0,
      sw,
      sh,
    );
    return tmp.toDataURL();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    const lr = layerRef.current!.getBoundingClientRect();
    const px = e.clientX - lr.left;
    const py = e.clientY - lr.top;

    // Resize handle of the current selection (images and shapes)?
    if (selObj && (selObj.kind === "image" || selObj.kind === "path")) {
      const c = cornerAt(selObj, px, py);
      if (c) {
        e.preventDefault();
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
        dragRef.current = {
          mode: "resize",
          corner: c,
          startX: e.clientX,
          startY: e.clientY,
          obj: selObj,
          box: selObj.rect,
        };
        setDrag({ orig: selObj.rect, box: selObj.rect, ghost: cropGhost(selObj.rect) });
        return;
      }
    }

    // Otherwise pick the smallest object under the point → select + move.
    const hit = objects
      .filter(
        (o) =>
          px >= o.rect.left &&
          px <= o.rect.left + o.rect.width &&
          py >= o.rect.top &&
          py <= o.rect.top + o.rect.height,
      )
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!hit) {
      setSel(null);
      return;
    }
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    setSel(hit.index);
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      obj: hit,
      box: hit.rect,
    };
    setDrag({ orig: hit.rect, box: hit.rect, ghost: cropGhost(hit.rect) });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      const box = { ...d.obj.rect, left: d.obj.rect.left + dx, top: d.obj.rect.top + dy };
      d.box = box;
      setDrag((p) => (p ? { ...p, box } : p));
    } else {
      // Aspect-locked resize about the opposite corner.
      const r = d.obj.rect;
      const anchor = {
        x: d.corner === "nw" || d.corner === "sw" ? r.left + r.width : r.left,
        y: d.corner === "nw" || d.corner === "ne" ? r.top + r.height : r.top,
      };
      const ox = (d.corner === "ne" || d.corner === "se" ? r.left + r.width : r.left) - anchor.x;
      const oy = (d.corner === "sw" || d.corner === "se" ? r.top + r.height : r.top) - anchor.y;
      const nx = e.clientX - (layerRef.current!.getBoundingClientRect().left + anchor.x);
      const ny = e.clientY - (layerRef.current!.getBoundingClientRect().top + anchor.y);
      const denom = ox * ox + oy * oy;
      let s = denom ? (nx * ox + ny * oy) / denom : 1;
      s = Math.max(0.05, s);
      const nw = r.width * s;
      const nh = r.height * s;
      const box = {
        left: Math.min(anchor.x, anchor.x + Math.sign(ox || 1) * nw),
        top: Math.min(anchor.y, anchor.y + Math.sign(oy || 1) * nh),
        width: nw,
        height: nh,
      };
      d.box = box;
      setDrag((p) => (p ? { ...p, box } : p));
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) {
      setDrag(null);
      return;
    }
    const vp = viewportRef.current;
    const box = d.box; // live box from the ref (not stale React state)
    setDrag(null);
    if (!vp || !box) return;
    const moved =
      Math.abs(box.left - d.obj.rect.left) > 1 ||
      Math.abs(box.top - d.obj.rect.top) > 1 ||
      Math.abs(box.width - d.obj.rect.width) > 1;
    if (!moved) return;

    setBusy(true);
    (async () => {
      try {
        if (d.mode === "move") {
          // Screen delta → page-space translation (rotation-correct).
          const [ax, ay] = vp.convertToPdfPoint(0, 0);
          const [bx, by] = vp.convertToPdfPoint(
            box.left - d.obj.rect.left,
            box.top - d.obj.rect.top,
          );
          await app.applyObjectTransform(pageIndex, d.obj.index, {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            e: bx - ax,
            f: by - ay,
          });
        } else {
          const s = box.width / d.obj.rect.width;
          // Anchor = the screen-opposite corner, in PDF page space. Corners are
          // named in SCREEN space, so the Y axis is flipped: a screen-bottom
          // (s*) handle drags the PDF bottom, anchoring the PDF top, etc.
          const p = d.obj.pdf;
          const ax = d.corner === "nw" || d.corner === "sw" ? p.right : p.left;
          const ay = d.corner === "nw" || d.corner === "ne" ? p.bottom : p.top;
          await app.applyObjectTransform(pageIndex, d.obj.index, {
            a: s,
            b: 0,
            c: 0,
            d: s,
            e: ax * (1 - s),
            f: ay * (1 - s),
          });
        }
      } catch {
        toast.error("Couldn't edit that object.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{ cursor: busy ? "wait" : "default", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Hover/selectable outlines for each object. */}
      {objects.map((o) => (
        <div
          key={o.index}
          className={cn(
            "absolute rounded-[1px]",
            o.index === sel
              ? "outline outline-2 outline-primary"
              : "hover:outline hover:outline-1 hover:outline-primary/50",
          )}
          style={{
            left: o.rect.left,
            top: o.rect.top,
            width: o.rect.width,
            height: o.rect.height,
            cursor: "move",
          }}
        />
      ))}

      {/* Live color preview while the picker is open (shape fills only). */}
      {previewHex && selObj && selObj.kind === "path" && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: selObj.rect.left,
            top: selObj.rect.top,
            width: selObj.rect.width,
            height: selObj.rect.height,
            backgroundColor: previewHex,
          }}
        />
      )}

      {/* Resize handles for a selected image or shape. */}
      {selObj &&
        (selObj.kind === "image" || selObj.kind === "path") &&
        !drag &&
        (["nw", "ne", "sw", "se"] as Corner[]).map((c) => {
          const r = selObj.rect;
          const x = c === "ne" || c === "se" ? r.left + r.width : r.left;
          const y = c === "sw" || c === "se" ? r.top + r.height : r.top;
          const cur = c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize";
          return (
            <div
              key={c}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white bg-primary shadow"
              style={{ left: x, top: y, cursor: cur }}
            />
          );
        })}

      {/* Contextual properties popover for the selected object. */}
      {selObj && !drag && (
        <Popover open onOpenChange={(o: boolean) => !o && setSel(null)}>
          <PopoverContent
            anchor={{
              getBoundingClientRect: () => {
                const lr = layerRef.current?.getBoundingClientRect();
                const l = lr?.left ?? 0;
                const t = lr?.top ?? 0;
                return new DOMRect(
                  l + selObj.rect.left,
                  t + selObj.rect.top,
                  selObj.rect.width,
                  selObj.rect.height,
                );
              },
            }}
            side="top"
            align="start"
            sideOffset={8}
            className="flex items-center gap-2 px-2 py-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ObjectProperties
              obj={selObj}
              busy={busy}
              onFillPreview={setPreviewHex}
              onStyle={(patch) => {
                setBusy(true);
                app
                  .applyObjectStyle(pageIndex, selObj.index, patch)
                  .catch(() => toast.error("Couldn't restyle that object."))
                  .finally(() => setBusy(false));
              }}
              onDelete={() => {
                const idx = selObj.index;
                setSel(null);
                setBusy(true);
                app
                  .removeObjectAt(pageIndex, idx)
                  .catch(() => toast.error("Couldn't delete that object."))
                  .finally(() => setBusy(false));
              }}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Drag preview: dim the original, float a ghost of the content. */}
      {drag && (
        <>
          <div
            className="absolute bg-white/60"
            style={{
              left: drag.orig.left,
              top: drag.orig.top,
              width: drag.orig.width,
              height: drag.orig.height,
            }}
          />
          {drag.ghost && (
            <img
              src={drag.ghost}
              alt=""
              className="absolute opacity-90 outline-dashed outline-1 outline-primary"
              style={{
                left: drag.box.left,
                top: drag.box.top,
                width: drag.box.width,
                height: drag.box.height,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

interface LinkRect {
  left: number;
  top: number;
  width: number;
  height: number;
  url?: string;
  destPage?: number;
}

/** Renders the PDF's own link annotations as clickable overlays. */
function LinkLayer({
  pdf,
  pageIndex,
  scale,
  visible,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  visible: boolean;
}) {
  const app = useApp();
  const [links, setLinks] = useState<LinkRect[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const annots = await page.getAnnotations();
        const vp = page.getViewport({ scale: 1 });
        const out: LinkRect[] = [];
        for (const a of annots) {
          if (a.subtype !== "Link" || !a.rect) continue;
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          const rect = {
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          };
          if (a.url) {
            out.push({ ...rect, url: a.url });
          } else if (a.destPage !== undefined) {
            // The engine resolves internal destinations to a page index.
            out.push({ ...rect, destPage: a.destPage });
          }
        }
        if (alive) setLinks(out);
      } catch {
        /* no annotations */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, pageIndex, visible]);

  // Links are active while reading; in edit mode they'd fight the tools.
  if (app.editMode || !links.length) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {links.map((l, i) => (
        <a
          key={i}
          href={l.url ?? "#"}
          target={l.url ? "_blank" : undefined}
          rel={l.url ? "noopener noreferrer" : undefined}
          title={l.url ?? `Go to page ${(l.destPage ?? 0) + 1}`}
          onClick={(e) => {
            if (l.destPage !== undefined) {
              e.preventDefault();
              app.scrollToPage(l.destPage);
            }
          }}
          className="absolute rounded-sm hover:bg-blue-500/10 hover:ring-1 hover:ring-blue-400/50"
          style={{
            left: l.left * scale,
            top: l.top * scale,
            width: l.width * scale,
            height: l.height * scale,
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface FormFieldSpec {
  key: string;
  name: string;
  kind: "text" | "multiline" | "checkbox" | "radio" | "dropdown";
  left: number;
  top: number;
  width: number;
  height: number;
  options?: Array<{ value: string; label: string }>;
  /** Export value of this radio widget. */
  buttonValue?: string;
  initial: unknown;
  readOnly: boolean;
  maxLen?: number;
}

/** Renders the PDF's AcroForm fields as fillable inputs. */
function FormLayer({
  pdf,
  pageIndex,
  scale,
  visible,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  visible: boolean;
}) {
  const app = useApp();
  const [fields, setFields] = useState<FormFieldSpec[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const annots = await page.getAnnotations();
        const vp = page.getViewport({ scale: 1 });
        const out: FormFieldSpec[] = [];
        for (const a of annots as any[]) {
          if (a.subtype !== "Widget" || !a.fieldName || a.hidden) continue;
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          const base = {
            key: a.id ?? `${a.fieldName}-${out.length}`,
            name: a.fieldName as string,
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
            readOnly: !!a.readOnly,
          };
          if (a.fieldType === "Tx") {
            out.push({
              ...base,
              kind: a.multiLine ? "multiline" : "text",
              initial: a.fieldValue ?? "",
              maxLen: a.maxLen || undefined,
            });
          } else if (a.fieldType === "Btn" && a.checkBox) {
            out.push({
              ...base,
              kind: "checkbox",
              initial: !!a.fieldValue && a.fieldValue !== "Off",
            });
          } else if (a.fieldType === "Btn" && a.radioButton) {
            out.push({
              ...base,
              kind: "radio",
              buttonValue: a.buttonValue ?? "",
              initial: a.fieldValue ?? "",
            });
          } else if (a.fieldType === "Ch") {
            out.push({
              ...base,
              kind: "dropdown",
              options: (a.options ?? []).map((o: any) => ({
                value: String(o.exportValue ?? o.displayValue ?? ""),
                label: String(o.displayValue ?? o.exportValue ?? ""),
              })),
              initial: Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue ?? "",
            });
          }
        }
        if (alive) setFields(out);
      } catch {
        /* no form */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, pageIndex, visible]);

  if (!fields.length) return null;

  const inputCls =
    "absolute rounded-[2px] border border-blue-400/50 bg-sky-400/10 text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white disabled:opacity-60";

  // Edit mode: existing fields become selectable designer objects.
  if (app.editMode) {
    return (
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {fields.map((f) => (
          <FieldDesigner key={f.key} field={f} pageIndex={pageIndex} scale={scale} />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {fields.map((f) => {
        const opKey = fieldOpKey(f, pageIndex);
        const op = app.fieldOps[opKey];
        if (op?.deleted) return null;
        const rect = op?.newRect ?? {
          x: f.left,
          y: f.top,
          w: f.width,
          h: f.height,
        };
        const style: React.CSSProperties = {
          left: rect.x * scale,
          top: rect.y * scale,
          width: rect.w * scale,
          height: rect.h * scale,
          pointerEvents: "auto",
          fontSize: Math.min(24, Math.max(9, rect.h * scale * 0.55)),
        };
        const current = app.formValues[f.name];

        if (f.kind === "checkbox") {
          const checked = current !== undefined ? !!current : !!f.initial;
          return (
            <input
              key={f.key}
              type="checkbox"
              checked={checked}
              disabled={f.readOnly}
              onChange={(e) => app.setFormValue(f.name, e.target.checked)}
              className={cn(inputCls, "accent-blue-600")}
              style={style}
            />
          );
        }
        if (f.kind === "radio") {
          const groupValue = current !== undefined ? current : f.initial;
          return (
            <input
              key={f.key}
              type="radio"
              name={`pdf-radio-${pageIndex}-${f.name}`}
              checked={groupValue === f.buttonValue}
              disabled={f.readOnly}
              onChange={() => app.setFormValue(f.name, f.buttonValue)}
              className={cn(inputCls, "accent-blue-600")}
              style={style}
            />
          );
        }
        if (f.kind === "dropdown") {
          const value = String(current !== undefined ? current : f.initial ?? "");
          return (
            <select
              key={f.key}
              value={value}
              disabled={f.readOnly}
              onChange={(e) => app.setFormValue(f.name, e.target.value)}
              className={inputCls}
              style={style}
            >
              <option value="" />
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        }
        const value = String(current !== undefined ? current : f.initial ?? "");
        if (f.kind === "multiline") {
          return (
            <textarea
              key={f.key}
              value={value}
              disabled={f.readOnly}
              maxLength={f.maxLen}
              onChange={(e) => app.setFormValue(f.name, e.target.value)}
              className={cn(inputCls, "resize-none p-1")}
              style={style}
            />
          );
        }
        return (
          <input
            key={f.key}
            type="text"
            value={value}
            disabled={f.readOnly}
            maxLength={f.maxLen}
            onChange={(e) => app.setFormValue(f.name, e.target.value)}
            className={cn(inputCls, "px-1")}
            style={style}
          />
        );
      })}
    </div>
  );
}

function fieldOpKey(f: FormFieldSpec, pageIndex: number): string {
  return `${f.name}|${pageIndex}|${Math.round(f.left)},${Math.round(f.top)}`;
}

/** Selectable/movable/deletable overlay for an EXISTING form field (edit mode). */
function FieldDesigner({
  field,
  pageIndex,
  scale,
}: {
  field: FormFieldSpec;
  pageIndex: number;
  scale: number;
}) {
  const app = useApp();
  const key = fieldOpKey(field, pageIndex);
  const base = {
    key,
    fieldName: field.name,
    pageIndex,
    origRect: { x: field.left, y: field.top, w: field.width, h: field.height },
  };
  const op = app.fieldOps[key];
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  if (op?.deleted) return null;

  const rect = live ?? op?.newRect ?? base.origRect;
  const isSelected = app.selectedField?.key === key;
  const displayName = op?.newName ?? field.name;

  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (app.tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    app.setSelectedField(base);
    app.setSelected(null);
    const start = { x: e.clientX, y: e.clientY };
    const orig = op?.newRect ?? base.origRect;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      setLive(
        mode === "move"
          ? { ...orig, x: orig.x + dx, y: orig.y + dy }
          : { ...orig, w: Math.max(10, orig.w + dx), h: Math.max(10, orig.h + dy) },
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLive((finalRect) => {
        if (finalRect) app.upsertFieldOp(base, { newRect: finalRect });
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Delete key removes the selected existing field.
  useEffect(() => {
    if (!isSelected) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        app.upsertFieldOp(base, { deleted: true });
        app.setSelectedField(null);
      }
      if (e.key === "Escape") app.setSelectedField(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected]);

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.w * scale,
        height: rect.h * scale,
        pointerEvents: app.tool === "select" ? "auto" : "none",
        cursor: app.tool === "select" ? "move" : "default",
        touchAction: app.tool === "select" ? "none" : "auto",
      }}
      className={cn(
        "group",
        isSelected && "ring-2 ring-blue-500 ring-offset-1",
        !isSelected && app.tool === "select" && "hover:ring-1 hover:ring-blue-400/60",
      )}
      onPointerDown={(e) => beginDrag(e, "move")}
    >
      <div
        className={cn(
          "relative h-full w-full border border-sky-500/70 bg-sky-400/10",
          field.kind === "radio" ? "rounded-full" : "rounded-[2px]",
        )}
      >
        {/* Field name — hidden by default so it doesn't overlap the form's own
            labels; revealed on hover or when the field is selected. */}
        <span
          className={cn(
            "pointer-events-none absolute -top-[15px] left-0 z-10 whitespace-nowrap rounded-sm bg-sky-600 px-1 text-[9px] font-medium leading-[1.4] text-white opacity-0 transition-opacity",
            isSelected ? "opacity-100" : "group-hover:opacity-100",
          )}
        >
          {displayName}
          {op?.newName && op.newName !== field.name ? " (renamed)" : ""}
        </span>
      </div>
      {isSelected && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          onPointerDown={(e) => beginDrag(e, "resize")}
        />
      )}
    </div>
  );
}

interface DraftShape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function AnnotationLayer({
  pageIndex,
  scale,
  baseDims,
}: {
  pageIndex: number;
  scale: number;
  baseDims: PageDims;
}) {
  const app = useApp();
  const layerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [inkPoints, setInkPoints] = useState<Array<{ x: number; y: number }>>([]);
  const drawing = useRef(false);
  const notePending = useRef<{ x: number; y: number } | null>(null);

  const anns = app.annotations[pageIndex] ?? [];
  const drawingTool = [
    "highlight",
    "rect",
    "ellipse",
    "line",
    "whiteout",
    "redact",
    "ink",
    "formtext",
    "formcheckbox",
    "formdropdown",
    "formradio",
  ].includes(app.tool);

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = layerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(baseDims.width, (e.clientX - rect.left) / scale)),
      y: Math.max(0, Math.min(baseDims.height, (e.clientY - rect.top) / scale)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    // Stamp placement (signature / image)
    if (app.pendingStamp) {
      // Cancel the native mousedown so focus isn't stolen from the page.
      e.preventDefault();
      const p = toLocal(e);
      const wPts = Math.min(200, baseDims.width * 0.4);
      const hPts = wPts * app.pendingStamp.aspect;
      app.addAnnotation(pageIndex, {
        id: uid(),
        kind: "image",
        x: p.x - wPts / 2,
        y: p.y - hPts / 2,
        w: wPts,
        h: hPts,
        dataUrl: app.pendingStamp.dataUrl,
      });
      app.setPendingStamp(null);
      app.setTool("select");
      return;
    }

    if (app.tool === "text") {
      // Cancel the native mousedown default action — otherwise the browser
      // moves focus after the textarea mounts, blurring it immediately and
      // the empty annotation gets cleaned up before the user can type.
      e.preventDefault();
      const p = toLocal(e);
      const ann: TextAnnotation = {
        id: uid(),
        kind: "text",
        x: p.x,
        y: p.y,
        w: 220,
        h: app.fontSize * 2,
        text: "",
        fontSize: app.fontSize,
        color: app.toolColor,
        fontFamily: app.fontFamily,
        bold: app.fontBold,
        italic: app.fontItalic,
        underline: app.fontUnderline,
        strike: app.fontStrike,
        align: app.textAlign,
      };
      app.addAnnotation(pageIndex, ann);
      app.setSelected({ page: pageIndex, id: ann.id });
      app.setTool("select");
      return;
    }

    if (app.tool === "note") {
      // Only remember the spot — the note is created on pointerUP. Creating
      // it here would mount the popover mid-gesture, and the finishing
      // pointerup/click lands outside the popup and dismisses it instantly.
      e.preventDefault();
      notePending.current = toLocal(e);
      return;
    }

    if (!drawingTool) {
      app.setSelected(null);
      return;
    }

    drawing.current = true;
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointers */
    }
    const p = toLocal(e);
    if (app.tool === "ink") {
      setInkPoints([p]);
    } else {
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toLocal(e);
    if (app.tool === "ink") {
      setInkPoints((pts) => {
        const last = pts[pts.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return pts;
        return [...pts, p];
      });
    } else {
      setDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
    }
  };

  const onPointerUp = () => {
    if (notePending.current && app.tool === "note") {
      const p = notePending.current;
      notePending.current = null;
      const ann: NoteAnnotation = {
        id: uid(),
        kind: "note",
        x: p.x,
        y: p.y,
        w: 22,
        h: 22,
        text: "",
        color: "#facc15",
      };
      app.addAnnotation(pageIndex, ann);
      app.setSelected({ page: pageIndex, id: ann.id });
      app.setTool("select");
      return;
    }

    if (!drawing.current) return;
    drawing.current = false;

    if (app.tool === "ink" && inkPoints.length > 1) {
      const xs = inkPoints.map((p) => p.x);
      const ys = inkPoints.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      app.addAnnotation(pageIndex, {
        id: uid(),
        kind: "ink",
        x: minX,
        y: minY,
        w: Math.max(...xs) - minX,
        h: Math.max(...ys) - minY,
        points: inkPoints.map((p) => ({ x: p.x - minX, y: p.y - minY })),
        color: app.toolColor,
        strokeWidth: app.strokeWidth,
      });
    } else if (draft) {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);

      // Form-field tools: click places a default-sized field, drag sizes it.
      if (app.tool.startsWith("form")) {
        const fieldType =
          app.tool === "formtext"
            ? "text"
            : app.tool === "formcheckbox"
              ? "checkbox"
              : app.tool === "formdropdown"
                ? "dropdown"
                : "radio";
        const small = fieldType === "checkbox" || fieldType === "radio";
        const def = small ? { w: 16, h: 16 } : { w: 150, h: 24 };
        const count =
          Object.values(app.annotations)
            .flat()
            .filter((a) => a.kind === "formfield").length + 1;
        const ann: Annotation = {
          id: uid(),
          kind: "formfield",
          fieldType,
          x: draft.x0,
          y: draft.y0,
          w: w > 8 ? w : def.w,
          h: h > 8 ? h : def.h,
          fieldName:
            fieldType === "radio"
              ? "choice_1"
              : `${fieldType === "text" ? "text" : fieldType === "checkbox" ? "check" : "select"}_${count}`,
          options: fieldType === "dropdown" ? ["Option 1", "Option 2"] : undefined,
          optionValue: fieldType === "radio" ? `option${count}` : undefined,
        };
        app.addAnnotation(pageIndex, ann);
        app.setSelected({ page: pageIndex, id: ann.id });
        // Radio/checkbox stay armed for placing several in a row.
        if (!small) app.setTool("select");
        setDraft(null);
        setInkPoints([]);
        return;
      }

      if (w > 3 && h > 3) {
        const base = { id: uid(), x, y, w, h };
        if (app.tool === "highlight") {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: "highlight",
            color: app.highlightColor,
          });
        } else if (app.tool === "whiteout") {
          app.addAnnotation(pageIndex, { ...base, kind: "whiteout" });
          warnWhiteoutOnce();
        } else if (app.tool === "redact") {
          app.addAnnotation(pageIndex, { ...base, kind: "redact" });
        } else if (
          app.tool === "rect" ||
          app.tool === "ellipse" ||
          app.tool === "line"
        ) {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: app.tool,
            color: app.toolColor,
            strokeWidth: app.strokeWidth,
            // Fill applies to rect/ellipse only (a line can't be filled).
            ...(app.tool !== "line" && app.toolFill ? { fill: app.toolFill } : {}),
          });
        }
      }
    }
    setDraft(null);
    setInkPoints([]);
  };

  const interactive =
    drawingTool ||
    app.tool === "text" ||
    app.tool === "note" ||
    !!app.pendingStamp ||
    app.tool === "select";

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{
        pointerEvents: interactive && (drawingTool || app.tool === "text" || app.tool === "note" || app.pendingStamp) ? "auto" : "none",
        // Prevent the page from scrolling under a drawing/placement gesture.
        touchAction: drawingTool || app.pendingStamp ? "none" : "auto",
        cursor: app.pendingStamp
          ? "copy"
          : app.tool === "text"
            ? "text"
            : app.tool === "note"
              ? "copy"
              : drawingTool
                ? "crosshair"
                : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {anns.map((ann) => (
        <AnnotationItem
          key={ann.id}
          ann={ann}
          pageIndex={pageIndex}
          scale={scale}
          baseDims={baseDims}
        />
      ))}

      {/* live draft shape — matches the tool being drawn */}
      {draft && app.tool === "line" && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <line
            x1={draft.x0 * scale}
            y1={draft.y0 * scale}
            x2={draft.x1 * scale}
            y2={draft.y1 * scale}
            stroke={app.toolColor}
            strokeWidth={app.strokeWidth * scale}
            strokeLinecap="round"
            strokeDasharray="5 4"
          />
        </svg>
      )}
      {draft && app.tool !== "line" && (
        <div
          className={cn(
            "absolute border-2 border-dashed",
            app.tool === "ellipse" && "rounded-[50%]",
          )}
          style={{
            left: Math.min(draft.x0, draft.x1) * scale,
            top: Math.min(draft.y0, draft.y1) * scale,
            width: Math.abs(draft.x1 - draft.x0) * scale,
            height: Math.abs(draft.y1 - draft.y0) * scale,
            borderColor:
              app.tool === "highlight"
                ? app.highlightColor
                : app.tool === "whiteout"
                  ? "#94a3b8"
                  : app.tool === "redact"
                    ? "#dc2626"
                    : app.toolColor,
            background:
              app.tool === "highlight"
                ? `${app.highlightColor}4d`
                : app.tool === "whiteout"
                  ? "rgba(255,255,255,0.8)"
                  : app.tool === "redact"
                    ? "rgba(0,0,0,0.85)"
                    : "transparent",
          }}
        />
      )}
      {inkPoints.length > 1 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${baseDims.width} ${baseDims.height}`}
        >
          <polyline
            points={inkPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={app.toolColor}
            strokeWidth={app.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const FIELD_TYPE_LABEL: Record<FormFieldAnnotation["fieldType"], string> = {
  text: "Text",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio",
};

const BORDER_STYLES: Array<{ v: NonNullable<FormFieldAnnotation["borderStyle"]>; label: string }> = [
  { v: "solid", label: "Solid" },
  { v: "dashed", label: "Dashed" },
  { v: "beveled", label: "Beveled" },
  { v: "inset", label: "Inset" },
  { v: "underline", label: "Underline" },
];

/**
 * The form-builder properties panel — anchored beside a selected form field, it
 * exposes every field property (name, behavior, text, border/background, style,
 * options) and patches the annotation live. Baked into a real AcroForm field on
 * save via createFormFields.
 */
function FieldProperties({
  ann,
  onPatch,
}: {
  ann: FormFieldAnnotation;
  onPatch: (p: Partial<FormFieldAnnotation>) => void;
}) {
  const isText = ann.fieldType === "text";
  const isChoice = ann.fieldType === "dropdown" || ann.fieldType === "radio";
  const isCheck = ann.fieldType === "checkbox";
  const sm = "h-7 text-xs px-2";
  const lbl = "text-[10px] font-medium text-muted-foreground";

  return (
    <>
      <div className="text-[11px] font-semibold">{FIELD_TYPE_LABEL[ann.fieldType]} field</div>

      <div className="space-y-0.5">
        <div className={lbl}>Name</div>
        <Input
          key={`name-${ann.id}`}
          className={sm}
          defaultValue={ann.fieldName}
          onBlur={(e) => onPatch({ fieldName: e.target.value.trim() || ann.fieldName })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>

      <div className="space-y-0.5">
        <div className={lbl}>Tooltip</div>
        <Input
          key={`tip-${ann.id}`}
          className={sm}
          defaultValue={ann.tooltip ?? ""}
          placeholder="shown on hover"
          onBlur={(e) => onPatch({ tooltip: e.target.value || undefined })}
        />
      </div>

      {!isCheck && (
        <div className="space-y-0.5">
          <div className={lbl}>{isChoice ? "Default value" : "Default text"}</div>
          <Input
            key={`def-${ann.id}`}
            className={sm}
            defaultValue={ann.defaultValue ?? ""}
            onBlur={(e) => onPatch({ defaultValue: e.target.value || undefined })}
          />
        </div>
      )}

      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-[11px]">
          <Checkbox
            checked={!!ann.required}
            onCheckedChange={(v: boolean) => onPatch({ required: v })}
          />
          Required
        </label>
        <label className="flex items-center gap-1.5 text-[11px]">
          <Checkbox
            checked={!!ann.readOnly}
            onCheckedChange={(v: boolean) => onPatch({ readOnly: v })}
          />
          Read-only
        </label>
      </div>

      {isCheck && (
        <label className="flex items-center gap-1.5 text-[11px]">
          <Checkbox
            checked={ann.defaultValue === "true"}
            onCheckedChange={(v: boolean) => onPatch({ defaultValue: v ? "true" : undefined })}
          />
          Checked by default
        </label>
      )}

      {(isText || isChoice) && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-0.5">
            <div className={lbl}>Font size</div>
            <Select
              className={sm}
              value={String(ann.fontSize ?? 0)}
              onChange={(e) => onPatch({ fontSize: Number(e.target.value) })}
            >
              <option value="0">Auto</option>
              {[8, 9, 10, 11, 12, 14, 16, 18].map((s) => (
                <option key={s} value={s}>
                  {s}pt
                </option>
              ))}
            </Select>
          </div>
          <ToggleGroup
            value={[ann.align ?? "left"]}
            onValueChange={(v: string[]) => v[0] && onPatch({ align: v[0] as FormFieldAnnotation["align"] })}
            aria-label="Text alignment"
          >
            {(["left", "center", "right"] as const).map((a) => (
              <ToggleGroupItem key={a} value={a} title={a} className="text-[11px] capitalize">
                {a[0].toUpperCase()}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      {isText && (
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-[11px]">
            <Checkbox
              checked={!!ann.multiline}
              onCheckedChange={(v: boolean) => onPatch({ multiline: v })}
            />
            Multiline
          </label>
          <div className="flex-1 space-y-0.5">
            <div className={lbl}>Max length</div>
            <Input
              key={`max-${ann.id}`}
              type="number"
              min={0}
              className={sm}
              defaultValue={ann.maxLength ?? ""}
              placeholder="∞"
              onBlur={(e) =>
                onPatch({ maxLength: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
        </div>
      )}

      {isChoice && (
        <div className="space-y-0.5">
          <div className={lbl}>
            {ann.fieldType === "radio" ? "This option's value" : "Options (one per line)"}
          </div>
          {ann.fieldType === "dropdown" ? (
            <Textarea
              key={`opt-${ann.id}`}
              className="min-h-16 px-2 py-1 text-xs"
              defaultValue={(ann.options ?? []).join("\n")}
              onBlur={(e) =>
                onPatch({
                  options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean),
                })
              }
            />
          ) : (
            <Input
              key={`rv-${ann.id}`}
              className={sm}
              defaultValue={ann.optionValue ?? ""}
              onBlur={(e) => onPatch({ optionValue: e.target.value || undefined })}
            />
          )}
        </div>
      )}

      {/* Appearance */}
      <div className="space-y-1.5 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className={lbl}>Border</span>
          <div className="flex items-center gap-1">
            <ColorSwatch
              value={ann.borderColor ?? "#9ca8c8"}
              onChange={(v) => onPatch({ borderColor: v })}
              title="Border color"
            />
            <Select
              className="h-7 w-[4.5rem] px-2 text-xs"
              value={String(ann.borderWidth ?? 1)}
              onChange={(e) => onPatch({ borderWidth: Number(e.target.value) })}
            >
              {[0, 1, 2, 3].map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Select
          className={sm}
          value={ann.borderStyle ?? "solid"}
          onChange={(e) =>
            onPatch({ borderStyle: e.target.value as FormFieldAnnotation["borderStyle"] })
          }
        >
          {BORDER_STYLES.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </Select>
        <div className="flex items-center justify-between gap-2">
          <span className={lbl}>Background</span>
          {ann.backgroundColor ? (
            <div className="flex items-center gap-1">
              <ColorSwatch
                value={ann.backgroundColor}
                onChange={(v) => onPatch({ backgroundColor: v })}
                title="Background color"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onPatch({ backgroundColor: undefined })}
              >
                None
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => onPatch({ backgroundColor: "#eef2fb" })}
            >
              Add fill
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Contextual properties popover for a selected annotation (everything except
 * form fields, which have their own richer panel). Shows the controls relevant
 * to the kind — color, fill, stroke width, font — plus delete.
 */
/** Comment editor shown in the note's popover. Commits on blur (clicking
 *  outside moves focus out of the popup first); an empty comment is removed
 *  by AnnotationItem when the note is deselected. NOTE: no unmount-commit —
 *  StrictMode runs effect cleanups on mount and would delete fresh notes. */
function NoteEditor({
  ann,
  draftRef,
  onPatch,
  onDelete,
}: {
  ann: NoteAnnotation;
  /** Live draft, readable by AnnotationItem when the popover is dismissed
   *  before blur can commit (outside-press closes on pointerdown). */
  draftRef: React.MutableRefObject<string | null>;
  onPatch: (p: Partial<Annotation>) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(ann.text);

  return (
    <div className="flex w-60 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Comment
        </span>
        <div className="flex items-center gap-1">
          <ColorSwatch
            value={ann.color}
            onChange={(v) => onPatch({ color: v } as Partial<Annotation>)}
            title="Marker color"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Delete comment"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        autoFocus={!ann.text}
        rows={3}
        value={text}
        placeholder="Write a comment…"
        className="min-h-16 text-xs"
        onChange={(e) => {
          setText(e.target.value);
          draftRef.current = e.target.value;
        }}
        onBlur={() => {
          if (!text.trim()) {
            if (ann.text) onDelete();
          } else if (text !== ann.text) {
            onPatch({ text } as Partial<Annotation>);
          }
        }}
      />
    </div>
  );
}

function AnnotationProperties({
  ann,
  onPatch,
  onDelete,
}: {
  ann: Annotation;
  onPatch: (p: Partial<Annotation>) => void;
  onDelete: () => void;
}) {
  const a = ann as any;
  const k = ann.kind;
  const isShape = k === "rect" || k === "ellipse" || k === "line";
  const isFillable = k === "rect" || k === "ellipse";
  const hasStroke = isShape || k === "ink";
  const isText = k === "text";
  // Text gets its swatch from TextStyleControls.
  const hasColor = isShape || k === "ink" || k === "highlight" || k === "whiteout";
  const colorLabel = k === "whiteout" ? "Patch" : isShape || k === "ink" ? "Stroke" : "Color";

  return (
    <>
      {isText && (
        <TextStyleControls
          value={textStyleValue(ann as TextAnnotation)}
          onPatch={(p) => {
            // Alignment is a box property — always patch the annotation.
            const { align, ...runPatch } = p;
            if (align !== undefined) onPatch({ align } as Partial<Annotation>);
            if (!Object.keys(runPatch).length) return;
            const editor = activeTextEditor.current;
            // Editing → style the current selection; an empty box has nothing
            // to style yet (applyStyle returns false) → patch the box itself.
            if (editor && editor.annId === ann.id && editor.applyStyle(runPatch)) return;
            onPatch({
              ...runPatch,
              ...(runPatch.fontFamily !== undefined ? { displayFontCss: undefined } : {}),
            } as Partial<Annotation>);
          }}
        />
      )}

      {hasColor && (
        <ColorSwatch
          value={a.color ?? (k === "whiteout" ? "#ffffff" : "#111111")}
          onChange={(v) => onPatch({ color: v } as Partial<Annotation>)}
          title={colorLabel}
        />
      )}

      {hasStroke && (
        <StrokeWidthSelect
          value={a.strokeWidth ?? 2}
          onChange={(w) => onPatch({ strokeWidth: w } as Partial<Annotation>)}
        />
      )}

      {isFillable && (
        <FillControl
          value={a.fill ?? null}
          onChange={(c) => onPatch({ fill: c ?? undefined } as Partial<Annotation>)}
        />
      )}

      <div className="h-4 w-px bg-border" />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title="Delete"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

function AnnotationItem({
  ann,
  pageIndex,
  scale,
  baseDims,
}: {
  ann: Annotation;
  pageIndex: number;
  scale: number;
  baseDims: PageDims;
}) {
  const app = useApp();
  const isSelected =
    app.selected?.page === pageIndex && app.selected?.id === ann.id;
  const [editing, setEditing] = useState(
    ann.kind === "text" && ann.text === "",
  );
  const richRef = useRef<RichTextHandle | null>(null);
  // Tracks whether the box has any typed content, updated live from
  // RichTextEditor's onRunsChange (ann.text itself only updates on commit) —
  // drives the "empty placeholder" look (dashed border, hint text, handles).
  const [hasContent, setHasContent] = useState(
    ann.kind !== "text" || !!ann.text.trim(),
  );

  // Commit the comment draft when the note is deselected — the popover can
  // be dismissed on pointerDOWN, before the textarea's blur ever fires, so
  // blur alone loses text typed right before clicking away. An empty note
  // is dropped instead. (Transition-based, not unmount-based: StrictMode
  // remounts must not delete a note the user is about to type into.)
  const wasSelected = useRef(isSelected);
  const selectedAt = useRef(0);
  const noteDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSelected) selectedAt.current = performance.now();
    if (wasSelected.current && !isSelected && ann.kind === "note") {
      const draft = noteDraftRef.current;
      noteDraftRef.current = null;
      const finalText = draft ?? ann.text;
      if (!finalText.trim()) {
        app.removeAnnotation(pageIndex, ann.id);
      } else if (finalText !== ann.text) {
        app.updateAnnotation(pageIndex, { ...ann, text: finalText });
      }
    }
    wasSelected.current = isSelected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected]);

  // Open the editor when requested externally (e.g. "edit existing text").
  useEffect(() => {
    if (app.editRequestId === ann.id && ann.kind === "text") {
      setEditing(true);
      app.setEditRequestId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.editRequestId, ann.id, ann.kind]);

  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // While editing, the box auto-grows to fit the typed text (RichTextEditor
  // reports run changes via onRunsChange → measureRichText).
  const [editSize, setEditSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const lastDownAt = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const maxTextWidth = Math.max(40, baseDims.width - ann.x - 2);

  // Seed / clear the auto-grow size as editing toggles.
  useEffect(() => {
    if (editing && ann.kind === "text") {
      setEditSize(measureRichText(ann, getRuns(ann), maxTextWidth));
    } else {
      setEditSize(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const box =
    live ??
    (editing && editSize ? { ...ann, w: editSize.w, h: editSize.h } : ann);

  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    // While reading, clicking a comment marker just opens its popup.
    if (ann.kind === "note" && app.tool === "read") {
      e.stopPropagation();
      e.preventDefault();
      app.setSelected({ page: pageIndex, id: ann.id });
      return;
    }
    // Highlighter over an existing highlight = un-highlight (browser-style).
    if (ann.kind === "highlight" && app.tool === "highlight") {
      e.stopPropagation();
      e.preventDefault();
      app.removeAnnotation(pageIndex, ann.id);
      return;
    }
    if (app.tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    app.setSelected({ page: pageIndex, id: ann.id });

    // Canceling pointerdown suppresses the browser's dblclick, so detect
    // double-press by timing to open the text editor.
    const now = performance.now();
    const isDouble = mode === "move" && now - lastDownAt.current < 400;
    lastDownAt.current = now;
    if (isDouble && ann.kind === "text") {
      setEditing(true);
      return;
    }
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: ann.x, y: ann.y, w: ann.w, h: ann.h },
    };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / scale;
      const dy = (ev.clientY - d.startY) / scale;
      if (d.mode === "move") {
        setLive({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy });
      } else if (ann.kind === "image") {
        // Images keep their aspect ratio while resizing.
        const w = Math.max(8, d.orig.w + dx);
        setLive({ ...d.orig, w, h: Math.max(8, w * (d.orig.h / d.orig.w)) });
      } else {
        setLive({
          ...d.orig,
          w: Math.max(8, d.orig.w + dx),
          h: Math.max(8, d.orig.h + dy),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLive((finalBox) => {
        if (finalBox) {
          app.updateAnnotation(pageIndex, { ...ann, ...finalBox });
        }
        return null;
      });
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Comment markers stay clickable while reading (comments are for readers
  // too); with the highlighter armed, clicking an existing highlight removes
  // it (browser-style un-highlight); everything else needs the Select tool.
  const selectable = app.tool === "select" && !ann.locked;
  const noteInRead = ann.kind === "note" && app.tool === "read" && !ann.locked;
  const unhighlight =
    ann.kind === "highlight" && app.tool === "highlight" && !ann.locked;
  const style: React.CSSProperties = {
    position: "absolute",
    left: box.x * scale,
    top: box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
    pointerEvents: selectable || noteInRead || unhighlight ? "auto" : "none",
    cursor: selectable ? "move" : noteInRead || unhighlight ? "pointer" : "default",
    touchAction: selectable ? "none" : "auto",
  };

  let body: React.ReactNode = null;
  switch (ann.kind) {
    case "note":
      body = (
        <div
          className="flex h-full w-full items-center justify-center"
          title={ann.text || "Comment"}
        >
          <MessageSquare
            className="h-full w-full drop-shadow-sm"
            style={{ color: ann.color }}
            fill="currentColor"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
        </div>
      );
      break;
    case "highlight":
      body = (
        <div
          className="h-full w-full"
          style={{ background: ann.color, opacity: 0.35 }}
        />
      );
      break;
    case "whiteout":
      body = (
        <div
          className="h-full w-full"
          style={{ background: ann.color ?? "#ffffff" }}
        />
      );
      break;
    case "redact":
      // Pending redaction: solid black fill (previews the result) with a red
      // dashed outline so it reads as "marked, not yet applied".
      body = (
        <div
          className="h-full w-full bg-black"
          style={{ outline: `${Math.max(1, scale)}px dashed #dc2626`, outlineOffset: "-1px" }}
        />
      );
      break;
    case "rect":
      body = (
        <div
          className="h-full w-full"
          style={{
            border: ann.strokeWidth > 0 ? `${ann.strokeWidth * scale}px solid ${ann.color}` : undefined,
            backgroundColor: ann.fill,
          }}
        />
      );
      break;
    case "ellipse":
      body = (
        <div
          className="h-full w-full rounded-[50%]"
          style={{
            border: ann.strokeWidth > 0 ? `${ann.strokeWidth * scale}px solid ${ann.color}` : undefined,
            backgroundColor: ann.fill,
          }}
        />
      );
      break;
    case "line":
      body = (
        <svg className="h-full w-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${Math.max(1, box.w)} ${Math.max(1, box.h)}`}>
          <line
            x1={0}
            y1={box.h}
            x2={box.w}
            y2={0}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
        </svg>
      );
      break;
    case "ink":
      body = (
        <svg
          className="h-full w-full overflow-visible"
          viewBox={`0 0 ${Math.max(1, ann.w)} ${Math.max(1, ann.h)}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={ann.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
      break;
    case "image":
      body = (
        <img
          src={ann.dataUrl}
          alt="stamp"
          className="h-full w-full select-none object-contain"
          draggable={false}
        />
      );
      break;
    case "formfield": {
      if (app.editMode) {
        // Designer look while editing: dashed outline + field name.
        const label =
          ann.fieldType === "radio"
            ? `${ann.fieldName} · ${ann.optionValue}`
            : ann.fieldName;
        body = (
          <div className="relative h-full w-full rounded-[3px] border-2 border-dashed border-violet-500/80 bg-violet-500/5">
            <span className="absolute -top-[15px] left-0 whitespace-nowrap text-[9px] font-medium leading-none text-violet-600">
              {label}
            </span>
            {ann.fieldType === "dropdown" && (
              <span className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[9px] text-violet-500">
                ▾
              </span>
            )}
            {ann.fieldType === "radio" && (
              <span className="absolute inset-1 rounded-full border border-violet-400/60" />
            )}
          </div>
        );
      } else {
        // View mode: preview exactly like the fillable field it becomes on save.
        body = (
          <div
            className={cn(
              "relative h-full w-full border border-blue-400/50 bg-sky-400/10",
              ann.fieldType === "radio" ? "rounded-full" : "rounded-[2px]",
            )}
          >
            {ann.fieldType === "dropdown" && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-500">
                ▾
              </span>
            )}
          </div>
        );
      }
      break;
    }
    case "text": {
      const textAnn = ann;
      body = editing ? (
        <RichTextEditor
          ref={richRef}
          ann={textAnn}
          scale={scale}
          maxWidth={maxTextWidth}
          style={{ lineHeight: TEXT_LINE_HEIGHT, textAlign: textAnn.align ?? "left" }}
          onRunsChange={(runs) => {
            setEditSize(measureRichText(textAnn, runs, maxTextWidth));
            setHasContent(!!runsText(runs).trim());
          }}
          onCommit={(runs, focusTo) => {
            // Focus moving to a style control (popover or toolbar) means the
            // user is styling, not finishing — commit text, keep editing.
            const toControls =
              focusTo?.closest?.("[data-ann-controls]") ??
              document.activeElement?.closest("[data-ann-controls]");
            const plain = runsText(runs);
            if (!plain.trim()) {
              if (!toControls) {
                setEditing(false);
                app.removeAnnotation(pageIndex, ann.id);
              }
              return;
            }
            const size = measureRichText(textAnn, runs, maxTextWidth);
            const rich = mergeRuns(runs);
            app.updateAnnotation(pageIndex, {
              ...textAnn,
              text: plain,
              runs: rich.length > 1 || (rich[0] && Object.keys(rich[0]).length > 1) ? rich : undefined,
              w: size.w,
              h: size.h,
            });
            if (!toControls) setEditing(false);
          }}
        />
      ) : (
        <div
          className="h-full w-full whitespace-pre-wrap"
          style={{ lineHeight: TEXT_LINE_HEIGHT, textAlign: textAnn.align ?? "left" }}
          dangerouslySetInnerHTML={{ __html: runsToHtml(getRuns(textAnn), textAnn, scale) }}
        />
      );
      break;
    }
  }

  // Text boxes keep one consistent dashed look — hovering, selected, blank,
  // mid-type, or re-selected later all look the same; only the placeholder
  // hint is specific to the still-blank state.
  const isTextSelected = ann.kind === "text" && isSelected;
  const isEmptyText = ann.kind === "text" && editing && !hasContent;

  return (
    <div
      ref={wrapRef}
      style={style}
      className={cn(
        isTextSelected
          ? "rounded-md border-2 border-dashed border-blue-400"
          : isSelected && "ring-2 ring-blue-500 ring-offset-1",
        isEmptyText && "bg-blue-50/40",
        !isSelected &&
          (ann.kind === "text"
            ? selectable && "hover:rounded-md hover:border-2 hover:border-dashed hover:border-blue-400/60"
            : (selectable || noteInRead) && "hover:ring-1 hover:ring-blue-400/60"),
      )}
      onPointerDown={(e) => beginDrag(e, "move")}
      onDoubleClick={(e) => {
        if (ann.kind === "text") {
          e.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {isEmptyText && ann.kind === "text" && (
        // Previews the picked color/font/weight so it's obvious *before*
        // typing, not just once the first character lands.
        <div
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2 opacity-45"
          style={{
            color: ann.color,
            fontSize: ann.fontSize * scale,
            fontFamily: ann.displayFontCss || FONT_CSS[ann.fontFamily ?? "helvetica"],
            fontWeight: ann.bold ? 700 : 400,
            fontStyle: ann.italic ? "italic" : "normal",
            textDecoration:
              [ann.underline && "underline", ann.strike && "line-through"]
                .filter(Boolean)
                .join(" ") || "none",
          }}
        >
          Start typing here…
        </div>
      )}
      {body}
      {isSelected && ann.kind !== "note" && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          onPointerDown={(e) => beginDrag(e, "resize")}
        />
      )}
      {ann.kind === "formfield" && (
        <Popover
          open={isSelected}
          onOpenChange={(o: boolean) => {
            if (!o) app.setSelected(null);
          }}
        >
          <PopoverContent
            anchor={wrapRef}
            side="right"
            align="start"
            sideOffset={12}
            className="scrollbar-soft max-h-[72vh] w-64 space-y-2 overflow-y-auto p-2.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <FieldProperties
              ann={ann}
              onPatch={(p) =>
                app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
              }
            />
          </PopoverContent>
        </Popover>
      )}
      {ann.kind !== "formfield" && !ann.locked && (
        <Popover
          // Text keeps its style controls visible WHILE editing so color /
          // font can be changed mid-type; other kinds show them when selected.
          open={isSelected && (ann.kind === "text" || !editing)}
          onOpenChange={(o: boolean, details?: { reason?: string; event?: Event }) => {
            if (o) return;
            const age = performance.now() - selectedAt.current;
            if (import.meta.env.DEV) {
              // Debug trace for popover dismissal issues.
              console.debug(
                `[${ann.kind}] popover close — reason: ${details?.reason ?? "?"}, ${Math.round(age)}ms after open`,
              );
            }
            const pressLike =
              details?.reason === "outside-press" || details?.reason === "focus-out";
            if (pressLike) {
              const target = details?.event?.target as HTMLElement | null;
              // Interacting with the annotation itself (caret moves in the
              // text editor, dragging the box) or with any style-controls
              // surface (top toolbar) must not dismiss the popover.
              if (
                target &&
                (wrapRef.current?.contains(target) || target.closest?.("[data-ann-controls]"))
              ) {
                return;
              }
              // While a text box is being edited, the editor's blur/commit
              // owns ending the session — never the popover's outside-press.
              if (ann.kind === "text" && editing) return;
              // The trusted click that finishes placing/selecting lands
              // outside the freshly-mounted popup — ignore that tail.
              if (age < 500) return;
            }
            app.setSelected(null);
          }}
        >
          <PopoverContent
            data-ann-controls
            anchor={wrapRef}
            side="top"
            align="start"
            sideOffset={10}
            className="flex flex-wrap items-center gap-2 px-2 py-1.5"
            onPointerDown={(e) => e.stopPropagation()}
            // A text box being typed into must keep the caret focused — Base
            // UI's popover normally grabs focus for accessibility, which was
            // silently stealing it from the just-mounted RichTextEditor.
            initialFocus={ann.kind === "text" && editing ? false : undefined}
          >
            {ann.kind === "note" ? (
              <NoteEditor
                ann={ann}
                draftRef={noteDraftRef}
                onPatch={(p) =>
                  app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
                }
                onDelete={() => app.removeAnnotation(pageIndex, ann.id)}
              />
            ) : (
              <AnnotationProperties
                ann={ann}
                onPatch={(p) =>
                  app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
                }
                onDelete={() => app.removeAnnotation(pageIndex, ann.id)}
              />
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { pdfjsLib } from "../../lib/pdf";
import { toast } from "sonner";
import { useApp } from "../../store";
import type { Annotation, TextAnnotation, WhiteoutAnnotation } from "../../types";
import { cn, uid } from "../../lib/utils";

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

const WELL_MATCHED_FONT =
  /helvetica|arial|liberation\s?sans|times|liberation\s?serif|courier|liberation\s?mono|calibri|carlito|cambria|caladea/i;
const warnedFonts = new Set<string>();

const FAMILY_LABEL: Record<string, string> = {
  helvetica: "Helvetica",
  times: "Times",
  courier: "Courier",
  carlito: "Carlito (Calibri-compatible)",
  caladea: "Caladea (Cambria-compatible)",
};

/**
 * Sample the rendered page around a text run: background color from the
 * rect's perimeter (median), text color from inner pixels that differ
 * strongly from the background (average). Falls back to white/dark.
 */
function sampleTextRunColors(
  canvas: HTMLCanvasElement | null,
  pageRect: DOMRect,
  spanRect: DOMRect,
): { bg: string; text: string } {
  const fallback = { bg: "#ffffff", text: "#111111" };
  if (!canvas || !canvas.width) return fallback;
  try {
    const sx = canvas.width / pageRect.width;
    const sy = canvas.height / pageRect.height;
    const pad = Math.max(2, Math.round(4 * sx));
    const ex = Math.max(0, Math.round((spanRect.left - pageRect.left) * sx) - pad);
    const ey = Math.max(0, Math.round((spanRect.top - pageRect.top) * sy) - pad);
    const ew = Math.min(canvas.width - ex, Math.round(spanRect.width * sx) + pad * 2);
    const eh = Math.min(canvas.height - ey, Math.round(spanRect.height * sy) + pad * 2);
    if (ew < 4 || eh < 4) return fallback;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    const img = ctx.getImageData(ex, ey, ew, eh).data;
    const at = (px: number, py: number) => (py * ew + px) * 4;

    // Background: median of perimeter pixels.
    const perim: number[] = [];
    const stepX = Math.max(1, Math.floor(ew / 48));
    const stepY = Math.max(1, Math.floor(eh / 24));
    for (let px = 0; px < ew; px += stepX) perim.push(at(px, 0), at(px, eh - 1));
    for (let py = 0; py < eh; py += stepY) perim.push(at(0, py), at(ew - 1, py));
    const median = (vals: number[]) => {
      const s = [...vals].sort((a, b) => a - b);
      return s[s.length >> 1];
    };
    const bg = [0, 1, 2].map((c) => median(perim.map((i) => img[i + c])));

    // Text: average of inner pixels far from the background color.
    let tr = 0, tg = 0, tb = 0, tn = 0;
    for (let py = pad; py < eh - pad; py += 2) {
      for (let px = pad; px < ew - pad; px += 2) {
        const i = at(px, py);
        const dist =
          Math.abs(img[i] - bg[0]) +
          Math.abs(img[i + 1] - bg[1]) +
          Math.abs(img[i + 2] - bg[2]);
        if (dist > 140) {
          tr += img[i];
          tg += img[i + 1];
          tb += img[i + 2];
          tn++;
        }
      }
    }
    const hex = (r: number, g: number, b: number) =>
      "#" +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
        .join("");
    const bgLum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
    return {
      bg: hex(bg[0], bg[1], bg[2]),
      text: tn > 8 ? hex(tr / tn, tg / tn, tb / tn) : bgLum > 0.5 ? "#111111" : "#f5f5f5",
    };
  } catch {
    return fallback;
  }
}

/** CSS font properties for displaying a text annotation on screen. */
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
          color: "#facc15",
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
      if ((e.key === "Delete" || e.key === "Backspace") && app.selected) {
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
        app.setSelected(null);
        app.setPendingStamp(null);
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

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

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
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/60 bg-background/75 px-2 py-1 opacity-80 shadow-shell backdrop-blur-md transition-opacity hover:opacity-100">
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
        <button
          className="h-6 min-w-11 rounded-full px-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Cycle zoom: fit width → fit page → 100%"
          onClick={() => {
            if (app.fitMode === "width") app.setFitMode("page");
            else if (app.fitMode === "page") {
              app.setFitMode(null);
              app.setScale(1);
            } else app.setFitMode("width");
          }}
        >
          {app.fitMode === "width"
            ? "Fit W"
            : app.fitMode === "page"
              ? "Fit P"
              : `${Math.round(effectiveScale * 100)}%`}
        </button>
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

        <button className={navBtn} title="Fullscreen" onClick={toggleFullscreen}>
          {isFullscreen ? (
            <Minimize className="h-4 w-4" />
          ) : (
            <Maximize className="h-4 w-4" />
          )}
        </button>
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
  pdf: PDFDocumentProxy;
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
      let page: PDFPageProxy;
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
      const task = page.render({ canvasContext: ctx, viewport } as any);
      renderTask.current = task as any;
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }

      // Text layer at CSS scale
      if (cancelled) return;
      textDiv.innerHTML = "";
      const textViewport = page.getViewport({ scale });
      textDiv.style.setProperty("--scale-factor", String(scale));
      try {
        const layer = new (pdfjsLib as any).TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport: textViewport,
        });
        await layer.render();
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

  const textSelectable =
    (app.tool === "select" || app.tool === "edittext") && !app.pendingStamp;

  // "Edit existing text": clicking a rendered text line covers it with a
  // whiteout and opens an editable text box with the same content on top.
  const onTextLayerClick = async (e: React.MouseEvent) => {
    if (app.tool !== "edittext") return;
    const span = (e.target as HTMLElement).closest(
      ".textLayer span",
    ) as HTMLElement | null;
    if (!span || !span.textContent?.trim() || !wrapRef.current) return;
    const pr = wrapRef.current.getBoundingClientRect();
    const sr = span.getBoundingClientRect();
    const x = (sr.left - pr.left) / scale;
    const y = (sr.top - pr.top) / scale;
    const wPts = sr.width / scale;
    const hPts = sr.height / scale;
    // Match the patch to the page background and the retyped text to the
    // original ink color (handles light text on dark backgrounds).
    const colors = sampleTextRunColors(canvasRef.current, pr, sr);
    const computed = getComputedStyle(span);
    const fontPx = parseFloat(computed.fontSize);
    const fontSize = Math.max(
      6,
      Math.round((Number.isFinite(fontPx) ? fontPx : sr.height * 0.85) / scale),
    );

    // Detect the original font so the replacement matches: generic family
    // from pdf.js text styles, weight/slant from the embedded font's name,
    // and the exact loaded @font-face for pixel-true on-screen display.
    let fontFamily: TextAnnotation["fontFamily"] = "helvetica";
    let bold = false;
    let italic = false;
    let displayFontCss: string | undefined = computed.fontFamily || undefined;
    try {
      const page = await pdf.getPage(pageIndex + 1);
      const tc = await page.getTextContent();
      const spans = Array.from(
        textLayerRef.current?.querySelectorAll(":scope > span") ?? [],
      );
      const item = tc.items[spans.indexOf(span)] as any;
      if (item?.fontName) {
        const style = (tc as any).styles?.[item.fontName];
        const generic = String(style?.fontFamily ?? "");
        if (/monospace/i.test(generic)) fontFamily = "courier";
        else if (/(^|[^-])serif/i.test(generic) && !/sans-serif/i.test(generic))
          fontFamily = "times";
        try {
          const loaded = page.commonObjs.get(item.fontName) as { name?: string };
          const name = loaded?.name ?? "";
          bold = /bold|black|heavy|semi|demi/i.test(name);
          italic = /italic|oblique/i.test(name);
          if (/times|georgia|garamond|roman|book|serif/i.test(name) && !/sans/i.test(name))
            fontFamily = "times";
          if (/courier|mono/i.test(name)) fontFamily = "courier";

          // Bundled metric-compatible replacements for the Office defaults.
          // Use the full bundled font on screen too (instead of the embedded
          // subset) so newly typed characters render in the same face.
          if (/calibri|carlito/i.test(name)) {
            fontFamily = "carlito";
            displayFontCss = undefined;
          } else if (/cambria|caladea/i.test(name)) {
            fontFamily = "caladea";
            displayFontCss = undefined;
          }

          // Warn (once per font) when the original font has no close
          // substitute among the embeddable standard fonts.
          const readable = name
            .replace(/^[A-Z]{6}\+/, "") // subset prefix, e.g. "ABCDEF+"
            .replace(/[-_]\d+$/, ""); // subset suffix, e.g. "-2000"
          if (readable && !WELL_MATCHED_FONT.test(readable) && !warnedFonts.has(readable)) {
            warnedFonts.add(readable);
            toast.warning(`Font “${readable}” is not available`, {
              description: `It's only partially embedded in this PDF, so edited text uses the closest match (${FAMILY_LABEL[fontFamily ?? "helvetica"]}) and may look slightly different — especially in the saved file.`,
              duration: 8000,
            });
          }
        } catch {
          /* font object not resolved yet — keep generic detection */
        }
      }
    } catch {
      /* detection is best-effort */
    }

    // Pair the whiteout with the retyped text: the whiteout is locked in
    // place (clicks pass through) and both are removed together.
    const groupId = uid();
    const whiteout: WhiteoutAnnotation = {
      id: uid(),
      kind: "whiteout",
      x: x - 1.5,
      y: y - 1.5,
      w: wPts + 3,
      h: hPts + 3,
      color: colors.bg,
      groupId,
      locked: true,
    };
    const textAnn: TextAnnotation = {
      id: uid(),
      kind: "text",
      groupId,
      x,
      y: y - 1,
      w: Math.max(wPts + 12, 60),
      h: Math.max(hPts * 1.1, fontSize * 1.3),
      text: span.textContent,
      fontSize,
      color: colors.text,
      fontFamily,
      bold,
      italic,
      displayFontCss,
    };
    app.addAnnotations(pageIndex, [whiteout, textAnn]);
    app.setSelected({ page: pageIndex, id: textAnn.id });
    app.setEditRequestId(textAnn.id);
    app.setTool("select");
    toast.info(
      "Original line covered — edit the text box, then drag to fine-tune. Undo with Ctrl+Z.",
    );
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
      <FormLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      <AnnotationLayer pageIndex={pageIndex} scale={scale} baseDims={baseDims} />
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
  pdf: PDFDocumentProxy;
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
          } else if (a.dest) {
            try {
              let dest = a.dest;
              if (typeof dest === "string") dest = await pdf.getDestination(dest);
              if (Array.isArray(dest) && dest[0]) {
                out.push({ ...rect, destPage: await pdf.getPageIndex(dest[0]) });
              }
            } catch {
              /* unresolvable destination */
            }
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
  pdf: PDFDocumentProxy;
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
      }}
      className={cn(
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
        <span className="absolute -top-[15px] left-0 whitespace-nowrap text-[9px] font-medium leading-none text-sky-600">
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

  const anns = app.annotations[pageIndex] ?? [];
  const drawingTool = [
    "highlight",
    "rect",
    "ellipse",
    "line",
    "whiteout",
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
      };
      app.addAnnotation(pageIndex, ann);
      app.setSelected({ page: pageIndex, id: ann.id });
      app.setTool("select");
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
            color: "#facc15",
          });
        } else if (app.tool === "whiteout") {
          app.addAnnotation(pageIndex, { ...base, kind: "whiteout" });
          warnWhiteoutOnce();
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
          });
        }
      }
    }
    setDraft(null);
    setInkPoints([]);
  };

  const interactive =
    drawingTool || app.tool === "text" || !!app.pendingStamp || app.tool === "select";

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{
        pointerEvents: interactive && (drawingTool || app.tool === "text" || app.pendingStamp) ? "auto" : "none",
        cursor: app.pendingStamp
          ? "copy"
          : app.tool === "text"
            ? "text"
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
        />
      ))}

      {/* live draft shape */}
      {draft && (
        <div
          className="absolute border-2 border-dashed"
          style={{
            left: Math.min(draft.x0, draft.x1) * scale,
            top: Math.min(draft.y0, draft.y1) * scale,
            width: Math.abs(draft.x1 - draft.x0) * scale,
            height: Math.abs(draft.y1 - draft.y0) * scale,
            borderColor:
              app.tool === "highlight"
                ? "#eab308"
                : app.tool === "whiteout"
                  ? "#94a3b8"
                  : app.toolColor,
            background:
              app.tool === "highlight"
                ? "rgba(250,204,21,0.3)"
                : app.tool === "whiteout"
                  ? "rgba(255,255,255,0.8)"
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

function AnnotationItem({
  ann,
  pageIndex,
  scale,
}: {
  ann: Annotation;
  pageIndex: number;
  scale: number;
}) {
  const app = useApp();
  const isSelected =
    app.selected?.page === pageIndex && app.selected?.id === ann.id;
  const [editing, setEditing] = useState(
    ann.kind === "text" && ann.text === "",
  );
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  // Open the editor when requested externally (e.g. "edit existing text").
  useEffect(() => {
    if (app.editRequestId === ann.id && ann.kind === "text") {
      setEditing(true);
      app.setEditRequestId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.editRequestId, ann.id, ann.kind]);

  useEffect(() => {
    if (!editing) return;
    // Focus after the browser has finished dispatching the originating
    // pointer event, so nothing steals focus back.
    const raf = requestAnimationFrame(() => {
      const el = editRef.current;
      if (el && document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const lastDownAt = useRef(0);

  const box = live ?? ann;

  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
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

  const style: React.CSSProperties = {
    position: "absolute",
    left: box.x * scale,
    top: box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
    pointerEvents:
      app.editMode && app.tool === "select" && !ann.locked ? "auto" : "none",
    cursor:
      app.editMode && app.tool === "select" && !ann.locked ? "move" : "default",
  };

  let body: React.ReactNode = null;
  switch (ann.kind) {
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
    case "rect":
      body = (
        <div
          className="h-full w-full"
          style={{
            border: `${ann.strokeWidth * scale}px solid ${ann.color}`,
          }}
        />
      );
      break;
    case "ellipse":
      body = (
        <div
          className="h-full w-full rounded-[50%]"
          style={{
            border: `${ann.strokeWidth * scale}px solid ${ann.color}`,
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
    case "text":
      body = editing ? (
        <textarea
          ref={editRef}
          autoFocus
          defaultValue={ann.text}
          className="h-full w-full resize-none border-0 bg-transparent p-0 outline-none"
          style={{
            fontSize: ann.fontSize * scale,
            lineHeight: 1.25,
            color: ann.color,
            ...textAnnCss(ann),
          }}
          onBlur={(e) => {
            setEditing(false);
            const text = e.target.value;
            if (!text.trim()) {
              app.removeAnnotation(pageIndex, ann.id);
            } else {
              const lines = text.split("\n").length;
              app.updateAnnotation(pageIndex, {
                ...ann,
                text,
                h: Math.max(ann.h, lines * ann.fontSize * 1.3),
              });
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="h-full w-full whitespace-pre-wrap"
          style={{
            fontSize: ann.fontSize * scale,
            lineHeight: 1.25,
            color: ann.color,
            ...textAnnCss(ann),
          }}
        >
          {ann.text}
        </div>
      );
      break;
  }

  return (
    <div
      style={style}
      className={cn(
        isSelected && "ring-2 ring-blue-500 ring-offset-1",
        !isSelected &&
          app.editMode &&
          app.tool === "select" &&
          !ann.locked &&
          "hover:ring-1 hover:ring-blue-400/60",
      )}
      onPointerDown={(e) => beginDrag(e, "move")}
      onDoubleClick={(e) => {
        if (ann.kind === "text") {
          e.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {body}
      {isSelected && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          onPointerDown={(e) => beginDrag(e, "resize")}
        />
      )}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Bot,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FilePlus2,
  FileText,
  Maximize,
  MessageSquare,
  Minimize,
  MoveHorizontal,
  PenLine,
  Scan,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PdfDoc, PdfPage } from "../../lib/pdf";
import { renderTextLayer } from "../../lib/pdf";
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
import { activeInlineEdit } from "../../lib/activeInlineEdit";
import type { TextObject, TextRunEdit } from "../../lib/pdfium";
import { missingGlyphs, newCharacters } from "../../lib/fontcoverage";
import {
  type InlineEdit,
  type InlineEditRun,
  styleKey,
  familyRoot,
  collectLine,
  mapLineEditToRuns,
  detectFontFromName,
  resolveTextFont,
  FONT_CSS,
} from "./textedit";
import { FloatingNav } from "./FloatingNav";
import type { PageDims } from "./types";
import { InlineTextEditor } from "./InlineTextEditor";
import { ObjectLayer } from "./objectlayer";
import { LinkLayer } from "./LinkLayer";
import { AnnotationLayer } from "./annotations";
import {
  FormLayer,
  FieldPreviewInput,
  MultiFieldTools,
  FieldProperties,
  fieldWidgetCss,
} from "./form";
import { toast } from "sonner";
import { useApp } from "../../store";
import { MARKUP_COLORS, MARKUP_LABEL, squigglyPath } from "../../lib/markup";
import {
  DATE_FORMATS,
  FIELD_DND_MIME,
  FIELD_FOR_TOOL,
  FIELD_META,
  buildFormField,
  paletteDrag,
  snapMovingRect,
  snapResizingRect,
} from "../../lib/formbuilder";
import type {
  Annotation,
  FormFieldAnnotation,
  MarkupStyle,
  NoteAnnotation,
  ShapeAnnotation,
  TextAnnotation,
} from "../../types";
import { cn, uid, ROTATABLE_KINDS } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ColorSwatch } from "../ui/color-swatch";
import { Input } from "../ui/input";
import { Popover, PopoverContent } from "../ui/popover";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

const PAGE_GAP = 24;

/**
 * Fonts whose substitution is close enough not to warn about: the PDF
 * standard families and their common metric-compatible equivalents.
 */



export function Viewer() {
  const app = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<PageDims[]>([]);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  // Hand/pan tool: drag anywhere on the scroll surface to move the page.
  const panRef = useRef({ active: false, x: 0, y: 0, left: 0, top: 0 });

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
      // In spread mode two pages (plus the inter-page gap) share the width.
      const widthUnit = app.spread ? maxPage.width * 2 + PAGE_GAP : maxPage.width;
      if (app.fitMode === "width") {
        return Math.min(2.5, Math.max(0.3, (containerSize.w - 64) / widthUnit));
      }
      if (app.fitMode === "page") {
        return Math.min(
          2.5,
          Math.max(
            0.2,
            Math.min(
              (containerSize.w - 64) / widthUnit,
              (containerSize.h - 48) / maxPage.height,
            ),
          ),
        );
      }
    }
    return app.scale;
  }, [app.fitMode, app.scale, app.spread, maxPage, containerSize]);

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
    const step = app.spread ? 2 : 1;
    let acc = 0;
    for (let i = 0; i < dims.length; i += step) {
      // A spread row is as tall as its tallest page.
      const rowH =
        step === 2 && i + 1 < dims.length
          ? Math.max(dims[i].height, dims[i + 1].height)
          : dims[i].height;
      const h = rowH * effectiveScale + PAGE_GAP;
      if (mid < acc + h) {
        if (app.currentPage !== i) app.setCurrentPage(i);
        return;
      }
      acc += h;
    }
  }, [dims, effectiveScale, app]);

  // Convert the current text selection into highlight / text-markup
  // annotations (detail.style: "highlight" | "underline" | "strikeout" |
  // "squiggly"; missing = highlight).
  useEffect(() => {
    const handler = (e: Event) => {
      const style = ((e as CustomEvent).detail?.style ?? "highlight") as
        | "highlight"
        | MarkupStyle;
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
        const box = {
          id: uid(),
          groupId,
          x: (r.left - pr.left) / effectiveScale,
          y: (r.top - pr.top) / effectiveScale,
          w: r.width / effectiveScale,
          h: r.height / effectiveScale,
        };
        list.push(
          style === "highlight"
            ? { ...box, kind: "highlight", color: app.highlightColor }
            : { ...box, kind: "markup", style, color: app.markupColor },
        );
        perPage.set(idx, list);
      }
      perPage.forEach((list, page) => app.addAnnotations(page, list));
      if (perPage.size) {
        sel.removeAllRanges();
        toast.success(
          style === "highlight"
            ? "Selection highlighted"
            : `Selection marked (${MARKUP_LABEL[style].toLowerCase()})`,
        );
      }
    };
    window.addEventListener("pdfwb:highlight-selection", handler);
    return () => window.removeEventListener("pdfwb:highlight-selection", handler);
  }, [app, effectiveScale]);

  // With a text-marking tool armed, finishing a drag over text turns the
  // selection into marks — underline/strikeout/squiggly, or a highlight when
  // the highlighter is in "text" mode — no separate click needed. Reuses the
  // handler above by re-dispatching its event.
  useEffect(() => {
    const style: "highlight" | MarkupStyle | null =
      app.tool === "underline" || app.tool === "strikeout" || app.tool === "squiggly"
        ? (app.tool as MarkupStyle)
        : app.tool === "highlight" && app.highlightMode === "text"
          ? "highlight"
          : null;
    if (!style) return;
    const onUp = () => {
      const sel = window.getSelection();
      // After a drag-select the selection is complete at mouseup (a plain
      // click leaves it collapsed → skipped). The handler above reads it,
      // builds the marks and clears the selection.
      if (!sel || sel.isCollapsed) return;
      if (!sel.anchorNode?.parentElement?.closest(".textLayer")) return;
      window.dispatchEvent(
        new CustomEvent("pdfwb:highlight-selection", { detail: { style } }),
      );
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [app.tool, app.highlightMode]);

  // While a highlight/markup tool is armed the annotation layer is inert (so
  // text stays selectable), so clicking empty space doesn't clear a selected
  // mark the way the Select tool does. Clear it here — but keep the selection
  // when the click lands on the mark itself (its handler stops propagation, so
  // this never fires) or on the toolbar controls (recoloring / deleting it).
  useEffect(() => {
    const armed =
      app.tool === "highlight" ||
      app.tool === "underline" ||
      app.tool === "strikeout" ||
      app.tool === "squiggly";
    if (!armed || !app.selected) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-ann-controls]")) return;
      app.setSelected(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [app.tool, app.selected]);

  // Delete key removes selected annotation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (inField) return;
      // A live multi-selection routes delete/nudge to every member at once.
      const multi =
        app.multiSelected && app.multiSelected.ids.length > 1
          ? app.multiSelected
          : null;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        app.selected &&
        app.editMode
      ) {
        if (multi) app.removeAnnotations(multi.page, multi.ids);
        else app.removeAnnotation(app.selected.page, app.selected.id);
      }
      if (
        app.selected &&
        app.editMode &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        if (multi) {
          app.translateAnnotations(multi.page, multi.ids, dx, dy);
        } else {
          const ann = (app.annotations[app.selected.page] ?? []).find(
            (a) => a.id === app.selected!.id,
          );
          if (ann) {
            app.updateAnnotation(app.selected.page, {
              ...ann,
              x: ann.x + dx,
              y: ann.y + dy,
            });
          }
        }
      }
      // Form builder: Ctrl+A selects every field on the current page.
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "a" &&
        app.formBuilder &&
        !app.formPreview
      ) {
        const page = app.selected?.page ?? app.currentPage;
        const ids = (app.annotations[page] ?? [])
          .filter((a) => a.kind === "formfield")
          .map((a) => a.id);
        if (ids.length) {
          e.preventDefault();
          app.setSelected({ page, id: ids[0] });
          app.setMultiSelected(ids.length > 1 ? { page, ids } : null);
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
      // Annotation clipboard. Ctrl+C only steps in when an annotation is
      // selected and no text selection exists — copying page text stays native.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const textSel = window.getSelection();
        if (app.editMode && app.selected && (!textSel || textSel.isCollapsed)) {
          if (app.copySelectedAnnotation()) {
            e.preventDefault();
            toast.success("Annotation copied — Ctrl+V to paste");
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && app.editMode) {
        app.pasteAnnotationClipboard();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && app.selected && app.editMode) {
        e.preventDefault();
        app.duplicateSelectedAnnotation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  if (!pdf) return <EmptyState />;

  // Pan tool: drag the scroll surface. Ignored on interactive descendants so
  // it never fights the pointer with a control the user meant to click.
  const isPan = app.tool === "pan";
  const onPanDown = (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!isPan || !el || e.button !== 0) return;
    panRef.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!panRef.current.active || !el) return;
    el.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x);
    el.scrollTop = panRef.current.top - (e.clientY - panRef.current.y);
  };
  const onPanUp = (e: React.PointerEvent) => {
    if (!panRef.current.active) return;
    panRef.current.active = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  // Group pages into rows: single-page (continuous) or pairs (spread).
  const rows: number[][] = [];
  if (app.spread) {
    for (let i = 0; i < dims.length; i += 2) {
      rows.push(i + 1 < dims.length ? [i, i + 1] : [i]);
    }
  } else {
    for (let i = 0; i < dims.length; i++) rows.push([i]);
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        onScroll={onScroll}
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onPointerCancel={onPanUp}
        className={cn(
          "scrollbar-soft h-full overflow-auto bg-muted/60 px-8 py-6 dark:bg-background",
          isPan && (panRef.current.active ? "cursor-grabbing" : "cursor-grab"),
        )}
      >
        <div className="mx-auto flex w-fit flex-col items-center" style={{ gap: PAGE_GAP }}>
          {rows.map((row) => (
            <div
              key={`${app.docVersion}-row-${row[0]}`}
              className="flex items-start"
              style={{ gap: PAGE_GAP }}
            >
              {row.map((i) => (
                <PageView
                  key={`${app.docVersion}-${i}`}
                  pdf={pdf}
                  pageIndex={i}
                  baseDims={dims[i]}
                  scale={effectiveScale}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <FloatingNav effectiveScale={effectiveScale} wrapperRef={containerRef} />
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            app.setScreen("templates");
          }}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          Create a blank PDF
        </button>
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
  const [painted, setPainted] = useState(false);
  // Tracks the last content-edit revision this page painted, to tell an
  // in-place repaint (no skeleton) from a fresh render (skeleton).
  const lastRevRef = useRef(0);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(0);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // Highlighted while a palette field is dragged over this page.
  const [fieldDropActive, setFieldDropActive] = useState(false);

  const w = baseDims.width * scale;
  const h = baseDims.height * scale;

  // Drop a field dragged from the sidebar palette, centered on the cursor.
  const onFieldDrop = (e: React.DragEvent) => {
    const type = paletteDrag.type;
    setFieldDropActive(false);
    if (!type) return;
    e.preventDefault();
    paletteDrag.type = null;
    const rect = wrapRef.current!.getBoundingClientRect();
    const meta = FIELD_META[type];
    let x = (e.clientX - rect.left) / scale - meta.defaultSize.w / 2;
    let y = (e.clientY - rect.top) / scale - meta.defaultSize.h / 2;
    if (app.gridEnabled) {
      x = Math.round(x / app.gridSize) * app.gridSize;
      y = Math.round(y / app.gridSize) * app.gridSize;
    }
    x = Math.max(0, Math.min(baseDims.width - meta.defaultSize.w, x));
    y = Math.max(0, Math.min(baseDims.height - meta.defaultSize.h, y));
    const ann = buildFormField(app.annotations, type, { x, y });
    app.addAnnotation(pageIndex, ann);
    app.setSelected({ page: pageIndex, id: ann.id });
  };

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
    if (!visible) {
      setPainted(false);
      return;
    }
    // An in-place content edit (contentRev bumped) just repaints over the
    // existing canvas — don't drop to the skeleton, which would gray-flash on
    // every object move. The skeleton still shows for first paint / zoom.
    const contentOnly = lastRevRef.current !== app.contentRev;
    lastRevRef.current = app.contentRev;
    if (!contentOnly) setPainted(false);
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
      setPainted(true);
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
    // app.contentRev: an existing-object edit mutated the live doc in place —
    // repaint from the same handle (no pdf identity change to key off).
  }, [pdf, pageIndex, scale, visible, app.contentRev]);

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

    hitSpans.forEach((span) => {
      // The active match is the one whose run index matches — not a DOM
      // position — so it stays correct even though spans render in reading
      // order rather than extraction order.
      const isActive =
        !!active &&
        active.page === pageIndex &&
        Number(span.dataset.run) === active.itemIndex;
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
          isActive ? "search-mark search-mark-active" : "search-mark";
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

  // Text-marking tools drag over text to mark it: the selection becomes
  // underline/strikeout/squiggly marks — or a highlight when the highlighter
  // is in "text" mode (see the mark-on-mouseup effect). They need a selectable
  // text layer, like read. (Highlighter "area" mode free-draws a box instead.)
  const textMarkTool =
    app.tool === "underline" ||
    app.tool === "strikeout" ||
    app.tool === "squiggly" ||
    (app.tool === "highlight" && app.highlightMode === "text");

  // Text is selectable for reading/copy (read tool), click-to-edit (edittext),
  // and while a text-marking tool is armed. The Select tool grabs page OBJECTS
  // instead (via ObjectLayer), so text stays non-selectable there.
  const textSelectable =
    (app.tool === "read" || app.tool === "edittext" || textMarkTool) &&
    !app.pendingStamp &&
    // Honor the copy restriction of protected documents (read-tool selection
    // exists to copy; edittext and marking only annotate, never extract text).
    (app.tool === "edittext" || textMarkTool || app.docPermissions.copy);

  // "Edit existing text": a click selects the whole visual LINE around the
  // hit run (PDFs fragment lines into many small runs), and the inline editor
  // shows the joined text. On commit the diff is mapped back onto the
  // underlying content-stream objects and rewritten in place — no whiteout
  // patch, no overlay copy, original text truly gone.
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

    // Join the visual line's fragments into one editable string, remembering
    // each run's span so the edit can be mapped back per run.
    const lineRuns = collectLine(objs, hit);
    let joined = "";
    const runs: InlineEditRun[] = [];
    for (let i = 0; i < lineRuns.length; i++) {
      const o = lineRuns[i];
      const next = lineRuns[i + 1];
      // Infer a visual space where the PDF split words into separate runs.
      const sep =
        next &&
        next.left - o.right > 0.15 * hit.fontSize &&
        !o.text.endsWith(" ") &&
        !next.text.startsWith(" ")
          ? " "
          : "";
      runs.push({
        objectIndex: o.index,
        text: o.text,
        start: joined.length,
        sep,
        originX: o.originX,
        originY: o.originY,
        fontName: o.fontName,
      });
      joined += o.text + sep;
    }

    // Map the line's PDF-space box to the exact on-screen rectangle.
    const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
      Math.min(...lineRuns.map((o) => o.left)),
      Math.min(...lineRuns.map((o) => o.bottom)),
      Math.max(...lineRuns.map((o) => o.right)),
      Math.max(...lineRuns.map((o) => o.top)),
    ]);
    const [r, g, b] = hit.color;
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    const f = detectFontFromName(hit.fontName || "");

    // Per-face proven glyphs: all page text drawn with each font. Coverage is
    // per-subset — a 'c' in the regular face proves nothing about the bold
    // face's subset — so the preflight checks each edited run's own font.
    const fontChars: Record<string, string> = {};
    for (const o of objs) {
      fontChars[o.fontName] = (fontChars[o.fontName] ?? "") + o.text;
    }

    // Other styles of the same family embedded in the page (a real Bold or
    // Regular face beats a synthesized one when the user toggles B/I).
    const root = familyRoot(hit.fontName || "");
    const siblings: Partial<Record<string, number>> = {};
    if (root) {
      for (const o of objs) {
        if (o.fontName === hit.fontName || familyRoot(o.fontName) !== root) continue;
        const st = detectFontFromName(o.fontName);
        const key = styleKey(st.bold, st.italic);
        if (siblings[key] == null) siblings[key] = o.index;
      }
    }

    // Load the clicked run's real embedded font so the on-screen editor shows
    // the page's actual face and metrics — but only when that subset can render
    // the current line's characters. A bare-CFF/CID subset fontkit can't parse
    // (or that lacks a Unicode cmap) would draw tofu in the textarea, so in that
    // case we keep the CSS fallback instead.
    let embeddedFont: Uint8Array | null = null;
    try {
      const fi = await app.getTextFontInfo(pageIndex, hit.index);
      if (fi?.data) {
        const chars = [...new Set(joined.replace(/\s+/g, ""))];
        const miss = await missingGlyphs(fi.data, chars);
        if (miss && miss.length === 0) embeddedFont = fi.data;
      }
    } catch {
      /* keep the CSS fallback */
    }

    setInlineEdit({
      runs,
      original: joined,
      left: Math.min(vx1, vx2),
      top: Math.min(vy1, vy2),
      width: Math.max(Math.abs(vx2 - vx1), 24),
      height: Math.max(Math.abs(vy2 - vy1), hit.fontSize * scale),
      fontPx: hit.fontSize * scale,
      color: `rgb(${r}, ${g}, ${b})`,
      colorHex: hex,
      fontSize: hit.fontSize,
      fontName: (hit.fontName || "").replace(/^[A-Z]{6}\+/, ""),
      fallbackFamily: f.family,
      embeddedFont,
      bold: f.bold,
      italic: f.italic,
      anchor: [runs[0].originX, runs[0].originY],
      fontChars,
      siblings,
    });
  };

  /**
   * Recreate the line's runs with a different face. Preference order: a face
   * of the same family the document already embeds (perfect match), then the
   * closest bundled/standard family. Used for explicit font replacement, for
   * un-bolding/un-italicizing (the regular face isn't synthesizable), and as
   * the offered fallback when the embedded subset lacks a typed glyph.
   */
  const commitRecreate = async (
    edit: InlineEdit,
    runEdits: TextRunEdit[],
    fill: [number, number, number, number] | undefined,
    fontSize: number | undefined,
    family: string,
    bold: boolean,
    italic: boolean,
    // Glyph-fallback: replace only the edited run(s), keeping the untouched
    // neighbors' original embedded faces. Explicit restyles cover the line.
    changedOnly = false,
  ) => {
    // Every run needs explicit text on the recreate path.
    const withText = edit.runs
      .map((r, i) => ({
        objectIndex: r.objectIndex,
        text: runEdits[i].text ?? r.text,
        changed: runEdits[i].text != null,
      }))
      .filter((r) => !changedOnly || r.changed)
      .map(({ objectIndex, text }) => ({ objectIndex, text }));

    let font: { standardName?: string; bytes?: Uint8Array } | null = null;
    if (family === "original") {
      const sib = edit.siblings[styleKey(bold, italic)];
      if (sib != null) {
        const info = await app.getTextFontInfo(pageIndex, sib);
        if (info?.data) {
          // The sibling is a subset too — only use it if it covers the text.
          const chars = [...new Set(withText.map((r) => r.text).join(""))];
          const missing = await missingGlyphs(info.data, chars);
          if (missing !== null && missing.length === 0) font = { bytes: info.data };
        }
      }
      if (!font) font = await resolveTextFont(edit.fallbackFamily, bold, italic);
    } else {
      font = await resolveTextFont(family, bold, italic);
    }
    await app.applyTextRuns(pageIndex, withText, { font, fontSize, fill });
  };

  /** Returns true when the edit session is finished (editor should close). */
  const commitInlineEdit = async (
    text: string,
    colorHex: string,
    fontSize: number,
    family: string,
    bold: boolean,
    italic: boolean,
  ): Promise<boolean> => {
    const edit = inlineEdit;
    if (!edit) return true;
    const textChanged = text !== edit.original && text.trim().length > 0;
    const colorChanged = colorHex.toLowerCase() !== edit.colorHex.toLowerCase();
    const sizeChanged = fontSize > 0 && fontSize !== Math.round(edit.fontSize);
    const familyReplaced = family !== "original";
    const boldOn = bold && !edit.bold;
    const boldOff = !bold && edit.bold;
    const italicOn = italic && !edit.italic;
    const italicOff = !italic && edit.italic;
    if (
      !textChanged &&
      !colorChanged &&
      !sizeChanged &&
      !familyReplaced &&
      !boldOn &&
      !boldOff &&
      !italicOn &&
      !italicOff
    ) {
      setInlineEdit(null);
      return true;
    }
    const fill: [number, number, number, number] = [
      parseInt(colorHex.slice(1, 3), 16),
      parseInt(colorHex.slice(3, 5), 16),
      parseInt(colorHex.slice(5, 7), 16),
      255,
    ];
    const runEdits = mapLineEditToRuns(edit, textChanged ? text : edit.original);
    const newFill = colorChanged ? fill : undefined;
    const newSize = sizeChanged ? fontSize : undefined;
    // Turning OFF a real bold/italic needs a different face — recreate.
    const needsRecreate = familyReplaced || boldOff || italicOff;

    setSavingEdit(true);
    try {
      if (needsRecreate) {
        await commitRecreate(edit, runEdits, newFill, newSize, family, bold, italic);
        setInlineEdit(null);
        return true;
      }

      // Glyph preflight: embedded fonts are subsets that only carry the glyphs
      // the document already uses — coverage is per FACE (a 'c' in the regular
      // face proves nothing about the bold subset), so each edited run is
      // checked against its own font. Any character the run's face can't render
      // (or that fontkit can't verify) means the in-place FPDFText_SetText would
      // bake blanks/garbage. Rather than block the edit, we substitute a close
      // full font for just the affected runs so the change always lands. A run
      // that only reuses characters already on the page in its face is left
      // in-place, keeping the original embedded face pixel-for-pixel.
      let substitute = false;
      let badFace = edit.fontName;
      const badChars: string[] = [];
      if (textChanged) {
        for (let i = 0; i < edit.runs.length; i++) {
          const newText = runEdits[i].text;
          if (!newText) continue; // unchanged or removed run
          const run = edit.runs[i];
          const fresh = newCharacters(
            newText,
            run.text,
            edit.fontChars[run.fontName] ?? "",
          );
          if (!fresh.length) continue;
          const info = await app.getTextFontInfo(pageIndex, run.objectIndex);
          const missing = info?.data ? await missingGlyphs(info.data, fresh) : null;
          const runBad = missing === null ? fresh : missing;
          if (runBad.length) {
            if (!substitute) badFace = run.fontName.replace(/^[A-Z]{6}\+/, "");
            substitute = true;
            badChars.push(...runBad);
          }
        }
      }
      if (substitute) {
        // Recreate only the edited runs with a close bundled/standard face; the
        // untouched neighbors keep their original embedded fonts.
        await commitRecreate(edit, runEdits, newFill, newSize, family, bold, italic, true);
        const chars = [...new Set(badChars)].map((c) => `"${c}"`).join(" ");
        toast.info(
          `The embedded font "${badFace}" doesn't include ${chars}, so the edited text was set in a close matching font.`,
        );
        setInlineEdit(null);
        return true;
      }

      await app.applyTextRuns(pageIndex, runEdits, {
        fill: newFill,
        fontScale: sizeChanged ? fontSize / edit.fontSize : undefined,
        anchor: edit.anchor,
        synthBold: boldOn || undefined,
        synthItalic: italicOn || undefined,
      });
      setInlineEdit(null);
      return true;
    } catch {
      toast.error(
        "Couldn't edit this text in place — use the Text tool to overlay a correction instead.",
      );
      setInlineEdit(null);
      return true;
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      data-page-index={pageIndex}
      className={cn(
        "relative shrink-0 bg-white shadow-shell ring-1 ring-border/60",
        fieldDropActive && "ring-2 ring-primary",
      )}
      style={{ width: w, height: h, scrollMarginTop: 16 }}
      onPointerDown={() => {
        if (app.tool === "select") {
          app.setSelected(null);
          app.setSelectedField(null);
        }
      }}
      onDragOver={(e) => {
        // Only intercept palette-field drags (dataTransfer data is
        // unreadable here, so the module holder is the source of truth).
        if (!paletteDrag.type) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!fieldDropActive) setFieldDropActive(true);
      }}
      onDragLeave={(e) => {
        // Ignore leaves into child elements of this page.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFieldDropActive(false);
        }
      }}
      onDrop={onFieldDrop}
    >
      {visible && !painted && (
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
      )}
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
          cursor: app.tool === "edittext" || textMarkTool ? "text" : undefined,
        }}
        onClick={onTextLayerClick}
      />
      <LinkLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      {/* Existing-content editing lives on its own "Move objects" tool
          (app.tool === "editobject"), kept separate from Select so moving your
          own annotations never fights with grabbing underlying page text /
          images. Rendered BELOW the form and annotation layers so form fields
          and your own annotations keep priority — clicks that miss them fall
          through here. */}
      {app.tool === "editobject" && visible && (
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




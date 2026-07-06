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

/** Pencil cursor for the freehand tool (lucide pencil with a white halo so it
 *  reads on any page color); hotspot at the pencil tip, crosshair fallback. */
const PENCIL_PATH =
  "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z";
const PENCIL_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='${PENCIL_PATH}' stroke='white' stroke-width='4.5' stroke-linejoin='round'/><path d='${PENCIL_PATH}' fill='%23111827' stroke='%23111827' stroke-width='1' stroke-linejoin='round'/></svg>") 2 22, crosshair`;


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
  // Note: underline / strikeout / squiggly mark existing text via selection
  // (handled on the text layer + mark-on-mouseup effect), not by dragging a box
  // here. Highlight free-draws a box only in "area" mode; in "text" mode it
  // marks selected text like the others.
  const drawingTool =
    [
      "rect",
      "ellipse",
      "line",
      "arrow",
      "callout",
      "whiteout",
      "redact",
      "ink",
      "formtext",
      "formcheckbox",
      "formdropdown",
      "formradio",
      "formdate",
      "formsignature",
      "formbutton",
    ].includes(app.tool) ||
    (app.tool === "highlight" && app.highlightMode === "area");

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
        const fieldType = FIELD_FOR_TOOL[app.tool]!;
        const meta = FIELD_META[fieldType];
        let fx = draft.x0;
        let fy = draft.y0;
        if (app.formBuilder && app.gridEnabled) {
          fx = Math.round(fx / app.gridSize) * app.gridSize;
          fy = Math.round(fy / app.gridSize) * app.gridSize;
        }
        const ann = buildFormField(app.annotations, fieldType, {
          x: fx,
          y: fy,
          w,
          h,
        });
        app.addAnnotation(pageIndex, ann);
        app.setSelected({ page: pageIndex, id: ann.id });
        // Radio/checkbox stay armed for placing several in a row.
        if (!meta.small) app.setTool("select");
        setDraft(null);
        setInkPoints([]);
        return;
      }

      // Arrows and callouts accept any drag direction (including pure
      // horizontal / vertical), unlike box tools which need a real area.
      if ((app.tool === "arrow" || app.tool === "callout") && (w > 3 || h > 3)) {
        const bw = Math.max(1, w);
        const bh = Math.max(1, h);
        const frac = (v: number, min: number, span: number) =>
          Math.max(0, Math.min(1, (v - min) / span));
        const arrow: ShapeAnnotation = {
          id: uid(),
          kind: "arrow",
          x,
          y,
          w: bw,
          h: bh,
          color: app.toolColor,
          strokeWidth: app.strokeWidth,
          // Tail at the drag start, head at the drag end…
          ax: frac(draft.x0, x, bw),
          ay: frac(draft.y0, y, bh),
          bx: frac(draft.x1, x, bw),
          by: frac(draft.y1, y, bh),
        };
        if (app.tool === "callout") {
          // …except for callouts, where the drag STARTS on the target: the
          // head points there and the text box sits at the drag end.
          [arrow.ax, arrow.ay, arrow.bx, arrow.by] = [arrow.bx, arrow.by, arrow.ax, arrow.ay];
          const groupId = uid();
          arrow.groupId = groupId;
          const text: TextAnnotation = {
            id: uid(),
            kind: "text",
            groupId,
            x: draft.x1,
            y: draft.y1 - app.fontSize,
            w: 180,
            h: app.fontSize * 2,
            text: "",
            fontSize: app.fontSize,
            color: app.toolColor,
            fontFamily: app.fontFamily,
            align: app.textAlign,
          };
          app.addAnnotations(pageIndex, [arrow, text]);
          app.setSelected({ page: pageIndex, id: text.id });
        } else {
          app.addAnnotation(pageIndex, arrow);
          app.setSelected({ page: pageIndex, id: arrow.id });
        }
        app.setTool("select");
        setDraft(null);
        setInkPoints([]);
        return;
      }

      // A line accepts any drag direction (including pure horizontal /
      // vertical), like arrows. The box branch below needs BOTH dimensions,
      // so a straight line — where one dimension is ~0 — would be dropped.
      // Clamp the box to a minimum of 1 so the on-screen SVG stroke keeps a
      // real thickness (a 0-height box collapses the stroke to nothing).
      if (app.tool === "line" && (w > 3 || h > 3)) {
        app.addAnnotation(pageIndex, {
          id: uid(),
          kind: "line",
          x,
          y,
          w: Math.max(1, w),
          h: Math.max(1, h),
          color: app.toolColor,
          strokeWidth: app.strokeWidth,
          // Keep the drag's diagonal direction — the box alone can't tell
          // "\" from "/" (both normalize to the same rect).
          down: (draft.x1 - draft.x0) * (draft.y1 - draft.y0) > 0,
        });
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
        } else if (
          app.tool === "underline" ||
          app.tool === "strikeout" ||
          app.tool === "squiggly"
        ) {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: "markup",
            style: app.tool,
            color: MARKUP_COLORS[app.tool],
          });
        } else if (app.tool === "whiteout") {
          app.addAnnotation(pageIndex, { ...base, kind: "whiteout" });
          warnWhiteoutOnce();
        } else if (app.tool === "redact") {
          app.addAnnotation(pageIndex, { ...base, kind: "redact" });
        } else if (app.tool === "rect" || app.tool === "ellipse") {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: app.tool,
            color: app.toolColor,
            strokeWidth: app.strokeWidth,
            ...(app.toolFill ? { fill: app.toolFill } : {}),
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
              : app.tool === "ink"
                ? PENCIL_CURSOR
                : drawingTool
                  ? "crosshair"
                  : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* form-builder grid (design aid only — never printed or saved) */}
      {app.formBuilder && app.gridEnabled && !app.formPreview && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(99,102,241,0.13) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.13) 1px, transparent 1px)",
            backgroundSize: `${app.gridSize * scale}px ${app.gridSize * scale}px`,
          }}
        />
      )}

      {anns.map((ann) => (
        <AnnotationItem
          key={ann.id}
          ann={ann}
          pageIndex={pageIndex}
          scale={scale}
          baseDims={baseDims}
        />
      ))}

      {/* alignment guides while a field snaps to its neighbors */}
      {app.snapGuides?.page === pageIndex && (
        <>
          {app.snapGuides.v.map((x, i) => (
            <div
              key={`v${i}`}
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-pink-500/80"
              style={{ left: x * scale }}
            />
          ))}
          {app.snapGuides.h.map((y, i) => (
            <div
              key={`h${i}`}
              className="pointer-events-none absolute left-0 right-0 h-px bg-pink-500/80"
              style={{ top: y * scale }}
            />
          ))}
        </>
      )}

      {/* live draft shape — matches the tool being drawn */}
      {draft && (app.tool === "line" || app.tool === "arrow" || app.tool === "callout") && (
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
      {draft && app.tool !== "line" && app.tool !== "arrow" && app.tool !== "callout" && (
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
                : app.tool === "underline" || app.tool === "strikeout" || app.tool === "squiggly"
                  ? MARKUP_COLORS[app.tool]
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
  // Form-builder state for this annotation: live-preview inputs and
  // multi-selection membership.
  const previewing =
    ann.kind === "formfield" && app.formBuilder && app.formPreview;
  const isMulti =
    ann.kind === "formfield" &&
    app.multiSelected?.page === pageIndex &&
    app.multiSelected.ids.includes(ann.id) &&
    app.multiSelected.ids.length > 1;
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
  // Rotation while the rotate handle is being dragged (committed on release).
  const [liveRot, setLiveRot] = useState<number | null>(null);
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
    // Clicking an existing highlight / markup with its own tool armed SELECTS
    // it (the contextual row then shows a color swatch + delete), so the mark
    // can be recolored or removed deliberately — not deleted on a stray click.
    // (Quick removal still lives on the eraser and the Delete key.)
    if (
      (ann.kind === "highlight" && app.tool === "highlight") ||
      (ann.kind === "markup" &&
        ["underline", "strikeout", "squiggly"].includes(app.tool))
    ) {
      e.stopPropagation();
      e.preventDefault();
      app.setSelected({ page: pageIndex, id: ann.id });
      return;
    }
    // Eraser removes whatever element is clicked, regardless of kind.
    if (app.tool === "eraser") {
      e.stopPropagation();
      e.preventDefault();
      app.removeAnnotation(pageIndex, ann.id);
      return;
    }
    // Live preview: fields act as real inputs, not draggable designer boxes.
    if (previewing) return;
    if (app.tool !== "select") return;
    // Shift-click builds a multi-selection of form fields.
    if (ann.kind === "formfield" && e.shiftKey) {
      e.stopPropagation();
      e.preventDefault();
      app.toggleMultiSelected(pageIndex, ann.id);
      return;
    }
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
    // Form-builder aids: snap candidates on this page, and (when the pressed
    // field is part of a multi-selection) the ids that drag along with it.
    const isField = ann.kind === "formfield";
    const groupIds =
      isField &&
      mode === "move" &&
      app.multiSelected &&
      app.multiSelected.page === pageIndex &&
      app.multiSelected.ids.includes(ann.id) &&
      app.multiSelected.ids.length > 1
        ? app.multiSelected.ids
        : null;
    const snapOthers =
      isField && app.formBuilder
        ? (app.annotations[pageIndex] ?? []).filter(
            (a) =>
              a.kind === "formfield" &&
              a.id !== ann.id &&
              !groupIds?.includes(a.id),
          )
        : [];
    const snapOpts = {
      snap: app.formBuilder && app.snapEnabled,
      grid: app.formBuilder && app.gridEnabled,
      gridSize: app.gridSize,
      threshold: 6 / scale,
    };
    const pageBox = { w: baseDims.width, h: baseDims.height };
    let finalBox: { x: number; y: number; w: number; h: number } | null = null;
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / scale;
      const dy = (ev.clientY - d.startY) / scale;
      if (d.mode === "move") {
        let next = { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy };
        // Alt suspends snapping for fine positioning.
        if (isField && app.formBuilder && !ev.altKey) {
          const s = snapMovingRect(next, snapOthers, pageBox, snapOpts);
          next = { ...next, x: s.x, y: s.y };
          app.setSnapGuides(
            s.v.length || s.h.length ? { page: pageIndex, v: s.v, h: s.h } : null,
          );
        }
        finalBox = next;
        if (groupIds) {
          app.setGroupDrag({
            page: pageIndex,
            ids: groupIds,
            dx: next.x - d.orig.x,
            dy: next.y - d.orig.y,
          });
        }
      } else if (ann.kind === "image") {
        // Images keep their aspect ratio while resizing.
        const w = Math.max(8, d.orig.w + dx);
        finalBox = { ...d.orig, w, h: Math.max(8, w * (d.orig.h / d.orig.w)) };
      } else {
        let next = {
          ...d.orig,
          w: Math.max(8, d.orig.w + dx),
          h: Math.max(8, d.orig.h + dy),
        };
        if (isField && app.formBuilder && !ev.altKey) {
          const s = snapResizingRect(next, snapOthers, pageBox, snapOpts);
          next = { ...next, w: s.w, h: s.h };
          app.setSnapGuides(
            s.v.length || s.h2.length
              ? { page: pageIndex, v: s.v, h: s.h2 }
              : null,
          );
        }
        finalBox = next;
      }
      setLive(finalBox);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Commit outside the state updater — updating the store from within
      // one triggers React's setState-during-render warning.
      if (finalBox) {
        if (groupIds) {
          // The whole selection moves in one undo step.
          app.translateAnnotations(
            pageIndex,
            groupIds,
            finalBox.x - ann.x,
            finalBox.y - ann.y,
          );
        } else {
          app.updateAnnotation(pageIndex, { ...ann, ...finalBox });
        }
      }
      if (isField) {
        app.setGroupDrag(null);
        app.setSnapGuides(null);
      }
      setLive(null);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Drag the rotate handle: angle from the box center to the pointer, with
  // soft snapping to 15° steps (Shift forces the snap).
  const beginRotate = (e: React.PointerEvent) => {
    if (app.tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    // getBoundingClientRect of a rotated element is its AABB — the center is
    // still the true rotation center.
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let current: number | null = null;
    const onMove = (ev: PointerEvent) => {
      // Handle sits above the top edge, so straight up = 0°.
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      const snapped = Math.round(a / 15) * 15;
      if (ev.shiftKey || Math.abs(a - snapped) < 4) a = snapped;
      current = ((a % 360) + 360) % 360;
      setLiveRot(current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Commit outside the state updater — updating the store from within
      // one triggers React's setState-during-render warning.
      if (current !== null) {
        app.updateAnnotation(pageIndex, {
          ...ann,
          rotation: current === 0 ? undefined : current,
        });
      }
      setLiveRot(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Comment markers stay clickable while reading (comments are for readers
  // too); with a highlight/markup tool armed, clicking an existing mark of
  // that kind selects it so it can be recolored or deleted; the eraser removes
  // any element it touches; everything else needs the Select tool.
  const selectable = app.tool === "select" && !ann.locked;
  const noteInRead = ann.kind === "note" && app.tool === "read" && !ann.locked;
  const editMarkArmed =
    ((ann.kind === "highlight" && app.tool === "highlight") ||
      (ann.kind === "markup" &&
        ["underline", "strikeout", "squiggly"].includes(app.tool))) &&
    !ann.locked;
  const erasable = app.tool === "eraser" && !ann.locked;
  // While a multi-selection drags, the other members preview the same offset.
  const gd = app.groupDrag;
  const groupOffset =
    gd && gd.page === pageIndex && gd.ids.includes(ann.id) && !live
      ? { x: gd.dx, y: gd.dy }
      : { x: 0, y: 0 };
  const rotationDeg = liveRot ?? ann.rotation ?? 0;
  const style: React.CSSProperties = {
    position: "absolute",
    left: (box.x + groupOffset.x) * scale,
    top: (box.y + groupOffset.y) * scale,
    width: box.w * scale,
    height: box.h * scale,
    transform: rotationDeg ? `rotate(${rotationDeg}deg)` : undefined,
    transformOrigin: "center",
    pointerEvents: selectable || noteInRead || editMarkArmed || erasable ? "auto" : "none",
    cursor: selectable
      ? "move"
      : noteInRead || editMarkArmed || erasable
        ? "pointer"
        : "default",
    touchAction: selectable || erasable ? "none" : "auto",
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
    case "markup": {
      const mw = Math.max(1, box.w);
      const mh = Math.max(1, box.h);
      const t = Math.max(0.75, mh * 0.06);
      body = (
        <svg
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox={`0 0 ${mw} ${mh}`}
        >
          {ann.style === "squiggly" ? (
            <path
              d={squigglyPath(mw, mh * 0.95, Math.max(1.2, mh * 0.14), Math.max(2.4, mh * 0.22))}
              fill="none"
              stroke={ann.color}
              strokeWidth={t}
              strokeLinejoin="round"
            />
          ) : (
            <line
              x1={0}
              x2={mw}
              y1={ann.style === "underline" ? mh * 0.92 : mh * 0.55}
              y2={ann.style === "underline" ? mh * 0.92 : mh * 0.55}
              stroke={ann.color}
              strokeWidth={ann.style === "underline" ? t : Math.max(1, mh * 0.08)}
            />
          )}
        </svg>
      );
      break;
    }
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
            y1={ann.down ? 0 : box.h}
            x2={box.w}
            y2={ann.down ? box.h : 0}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
        </svg>
      );
      break;
    case "arrow": {
      const aw = Math.max(1, box.w);
      const ah = Math.max(1, box.h);
      const x1 = (ann.ax ?? 0) * aw;
      const y1 = (ann.ay ?? 0) * ah;
      const x2 = (ann.bx ?? 1) * aw;
      const y2 = (ann.by ?? 1) * ah;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(6, ann.strokeWidth * 3.5);
      const spread = Math.PI / 7;
      const hx1 = x2 - headLen * Math.cos(angle - spread);
      const hy1 = y2 - headLen * Math.sin(angle - spread);
      const hx2 = x2 - headLen * Math.cos(angle + spread);
      const hy2 = y2 - headLen * Math.sin(angle + spread);
      body = (
        <svg
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox={`0 0 ${aw} ${ah}`}
        >
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.color} strokeWidth={ann.strokeWidth} strokeLinecap="round" />
          <polyline
            points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`}
            fill="none"
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
      break;
    }
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
      if (previewing) {
        // Live preview (form builder): a real, fillable input.
        body = <FieldPreviewInput ann={ann} scale={scale} />;
      } else if (app.editMode) {
        // Designer look while editing: dashed outline + field name.
        const label =
          ann.fieldType === "radio"
            ? `${ann.fieldName} · ${ann.optionValue}`
            : ann.fieldName;
        body = (
          <div
            className="relative h-full w-full rounded-[3px]"
            style={{
              // Dashed violet = "designer object" marker; the box itself
              // shows the real border/background it will have when saved.
              outline: "2px dashed rgba(139, 92, 246, 0.7)",
              outlineOffset: 1.5,
              ...fieldWidgetCss(ann, scale),
              backgroundColor:
                ann.backgroundColor ?? "rgba(139, 92, 246, 0.05)",
            }}
          >
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
            {ann.fieldType === "date" && (
              <Calendar className="absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-violet-500/80" />
            )}
            {ann.fieldType === "signature" && (
              <>
                <PenLine className="absolute left-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-violet-500/70" />
                <span className="absolute bottom-1.5 left-6 right-2 border-b border-violet-400/60" />
              </>
            )}
            {ann.fieldType === "button" && (
              <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] font-medium text-violet-600">
                {ann.buttonCaption ?? ann.fieldName}
              </span>
            )}
          </div>
        );
      } else {
        // View mode: preview exactly like the fillable field it becomes on save.
        body = (
          <div
            className={cn(
              "relative h-full w-full",
              ann.fieldType === "radio" ? "rounded-full" : "rounded-[2px]",
            )}
            style={{
              ...fieldWidgetCss(ann, scale),
              backgroundColor:
                ann.backgroundColor ??
                (ann.fieldType === "button"
                  ? "rgba(203, 213, 225, 0.4)"
                  : "rgba(56, 189, 248, 0.1)"),
            }}
          >
            {ann.fieldType === "dropdown" && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-500">
                ▾
              </span>
            )}
            {ann.fieldType === "date" && (
              <Calendar className="absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
            )}
            {ann.fieldType === "signature" && (
              <span className="absolute bottom-1.5 left-2 right-2 border-b border-slate-400/70" />
            )}
            {ann.fieldType === "button" && (
              <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] font-medium text-slate-600">
                {ann.buttonCaption ?? ann.fieldName}
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
          : (isSelected || isMulti) &&
              !previewing &&
              "ring-2 ring-blue-500 ring-offset-1",
        isEmptyText && "bg-blue-50/40",
        erasable && "hover:ring-2 hover:ring-red-400/80",
        !isSelected &&
          !erasable &&
          (ann.kind === "text"
            ? selectable && "hover:rounded-md hover:border-2 hover:border-dashed hover:border-blue-400/60"
            : (selectable || noteInRead) && "hover:ring-1 hover:ring-blue-400/60"),
      )}
      onPointerDown={(e) => beginDrag(e, "move")}
      onPointerEnter={(e) => {
        // Drag-erase: sweeping across elements with the button held removes
        // each one entered (the pointerdown already removed the first).
        if (erasable && e.buttons & 1) app.removeAnnotation(pageIndex, ann.id);
      }}
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
      {isSelected && !previewing && ann.kind !== "note" && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          onPointerDown={(e) => beginDrag(e, "resize")}
        />
      )}
      {isSelected && ROTATABLE_KINDS.has(ann.kind) && (
        <>
          {/* stem + grab-knob above the top edge; rotates with the element */}
          <div className="pointer-events-none absolute -top-5 left-1/2 h-5 w-px -translate-x-1/2 bg-blue-400/80" />
          <div
            title="Drag to rotate (Shift snaps to 15°)"
            className="absolute -top-6 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-white bg-blue-500 active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={beginRotate}
          />
        </>
      )}
      {ann.kind === "formfield" && !previewing && (
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
            {isMulti ? (
              <MultiFieldTools page={pageIndex} />
            ) : (
              <FieldProperties
                ann={ann}
                onPatch={(p) =>
                  app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
                }
              />
            )}
          </PopoverContent>
        </Popover>
      )}
      {ann.kind === "note" && !ann.locked && (
        <Popover
          // Comments keep their own popup (you type the note text in it). Every
          // other annotation's style controls now live in the toolbar's second
          // row, so no floating properties popover for them.
          open={isSelected}
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
          >
            <NoteEditor
              ann={ann}
              draftRef={noteDraftRef}
              onPatch={(p) =>
                app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
              }
              onDelete={() => app.removeAnnotation(pageIndex, ann.id)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

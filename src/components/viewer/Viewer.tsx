import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilePlus2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { cn, uid } from "../../lib/utils";
import { MARKUP_LABEL } from "../../lib/markup";
import type { Annotation, MarkupStyle } from "../../types";
import { FloatingNav } from "./FloatingNav";
import { PageView } from "./PageView";
import type { PageDims } from "./types";
import { Select } from "../ui/select";


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


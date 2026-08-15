import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Combine,
  Crop,
  Droplets,
  FileCheck2,
  FileOutput,
  FilePlus2,
  FileText,
  FolderOpen,
  GitCompare,
  Heading,
  LayoutGrid,
  type LucideIcon,
  Minimize2,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { useAppSelector, shallowEqual } from "../../store";
import { cn, uid } from "../../lib/utils";
import { attachTextSelection } from "../../lib/textselect";
import { MARKUP_LABEL } from "../../lib/markup";
import type { Annotation, MarkupStyle, Screen } from "../../types";
import { FloatingNav } from "./FloatingNav";
import { PageView } from "./PageView";
import type { PageDims } from "./types";
import { Select } from "../ui/select";
import { Tip } from "../ui/tooltip";
import { BrandLogo } from "../layout/BrandLogo";


const PAGE_GAP = 24;

/**
 * Fonts whose substitution is close enough not to warn about: the PDF
 * standard families and their common metric-compatible equivalents.
 */



// Memoized so a parent (PaneShell/Shell) re-render on unrelated state (sidebar,
// search, AI panel) doesn't re-render the whole editor. The selector below then
// limits its own re-renders to the editing/viewer fields it actually reads.
export const Viewer = memo(ViewerImpl);

function ViewerImpl() {
  const app = useAppSelector(
    (s) => ({
      addAnnotations: s.addAnnotations,
      annotations: s.annotations,
      copySelectedAnnotation: s.copySelectedAnnotation,
      currentPage: s.currentPage,
      docVersion: s.docVersion,
      duplicateSelectedAnnotation: s.duplicateSelectedAnnotation,
      editMode: s.editMode,
      fitMode: s.fitMode,
      formBuilder: s.formBuilder,
      formPreview: s.formPreview,
      highlightColor: s.highlightColor,
      highlightMode: s.highlightMode,
      markupColor: s.markupColor,
      multiSelected: s.multiSelected,
      pasteAnnotationClipboard: s.pasteAnnotationClipboard,
      pdf: s.pdf,
      pendingStamp: s.pendingStamp,
      redo: s.redo,
      removeAnnotation: s.removeAnnotation,
      removeAnnotations: s.removeAnnotations,
      scale: s.scale,
      selected: s.selected,
      setCurrentPage: s.setCurrentPage,
      setEditRequestId: s.setEditRequestId,
      setMultiSelected: s.setMultiSelected,
      setPendingStamp: s.setPendingStamp,
      setSelected: s.setSelected,
      setTool: s.setTool,
      spread: s.spread,
      tool: s.tool,
      translateAnnotations: s.translateAnnotations,
      undo: s.undo,
      updateAnnotation: s.updateAnnotation,
    }),
    shallowEqual,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<PageDims[]>([]);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  // Hand/pan tool: drag anywhere on the scroll surface to move the page.
  const panRef = useRef({ active: false, x: 0, y: 0, left: 0, top: 0 });

  const pdf = app.pdf;

  // Measure base page sizes (scale 1, rotation applied). Dict-level reads —
  // loading every page here froze the UI on large documents.
  useEffect(() => {
    if (!pdf) {
      setDims([]);
      return;
    }
    const out: PageDims[] = [];
    for (let i = 0; i < pdf.numPages; i++) out.push(pdf.pageSize(i));
    setDims(out);
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

  // Word-like text selection: caret placement from PDFium char geometry
  // instead of browser hit-testing (see textselect.ts). The container only
  // exists once a document is open.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pdf) return;
    return attachTextSelection(el);
  }, [pdf]);

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
      const selectedAnn = app.selected
        ? (app.annotations[app.selected.page] ?? []).find(
            (annotation) => annotation.id === app.selected!.id,
          )
        : null;
      // A live multi-selection routes delete/nudge to every member at once.
      const multi =
        app.multiSelected && app.multiSelected.ids.length > 1
          ? app.multiSelected
          : null;
      const unlockedMultiIds = multi
        ? multi.ids.filter(
            (id) =>
              !(app.annotations[multi.page] ?? []).find(
                (annotation) => annotation.id === id,
              )?.locked,
          )
        : [];
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        app.selected &&
        app.editMode &&
        selectedAnn &&
        !selectedAnn.locked
      ) {
        if (multi && unlockedMultiIds.length) {
          app.removeAnnotations(multi.page, unlockedMultiIds);
        }
        else app.removeAnnotation(app.selected.page, app.selected.id);
      }
      if (
        app.selected &&
        app.editMode &&
        selectedAnn &&
        !selectedAnn.locked &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const ann = selectedAnn;
        // A selected text box uses Shift+Arrow for precise resizing. Plain
        // arrows still nudge it; other annotation kinds retain the familiar
        // Shift = 10pt fast-nudge behavior.
        if (ann?.kind === "text" && e.shiftKey && !multi) {
          const step = e.ctrlKey || e.metaKey ? 10 : 1;
          app.updateAnnotation(app.selected.page, {
            ...ann,
            w: Math.max(
              8,
              ann.w +
                (e.key === "ArrowRight"
                  ? step
                  : e.key === "ArrowLeft"
                    ? -step
                    : 0),
            ),
            h: Math.max(
              8,
              ann.h +
                (e.key === "ArrowDown"
                  ? step
                  : e.key === "ArrowUp"
                    ? -step
                    : 0),
            ),
          });
        } else if (multi && unlockedMultiIds.length) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
          const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
          app.translateAnnotations(multi.page, unlockedMultiIds, dx, dy);
        } else if (ann) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
          const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
          app.updateAnnotation(app.selected.page, {
            ...ann,
            x: ann.x + dx,
            y: ann.y + dy,
          });
        }
      }
      if (
        app.selected &&
        app.editMode &&
        selectedAnn &&
        !selectedAnn.locked &&
        (e.key === "Enter" || e.key === "F2")
      ) {
        const ann = selectedAnn;
        if (ann?.kind === "text") {
          e.preventDefault();
          app.setEditRequestId(ann.id);
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
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "d" &&
        app.selected &&
        app.editMode &&
        !selectedAnn?.locked
      ) {
        e.preventDefault();
        app.duplicateSelectedAnnotation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  if (!pdf) return <WelcomeScreen />;

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


// The document tools, mirroring the Tools menu (label + icon + target screen)
// so the empty-state grid stays in sync with it. Each opens its screen just like
// the menu does — screens that need an open document show their own prompt. The
// per-tool colour is a literal class string so Tailwind's scanner keeps it.
const QUICK_TOOLS: Array<{
  screen: Screen;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
}> = [
  // The first four are the most-used and show by default; the rest reveal via
  // "Show more" on the welcome screen.
  { screen: "organize", label: "Organize", desc: "Reorder, rotate, delete or add pages", icon: LayoutGrid, color: "text-violet-500" },
  { screen: "merge", label: "Merge", desc: "Combine multiple PDFs into one", icon: Combine, color: "text-blue-500" },
  // The create tools sit up front: like Merge they work without an open document.
  { screen: "createimages", label: "Images to PDF", desc: "Turn PNG or JPEG images into a PDF", icon: FilePlus2, color: "text-rose-500" },
  { screen: "createdoc", label: "Word / text to PDF", desc: "Convert a .docx or .txt file into a PDF", icon: FilePlus2, color: "text-orange-500" },
  { screen: "split", label: "Split & extract", desc: "Extract pages or split into files", icon: Scissors, color: "text-emerald-500" },
  { screen: "compress", label: "Compress", desc: "Shrink images with adjustable quality", icon: Minimize2, color: "text-red-500" },
  { screen: "watermark", label: "Watermark", desc: "Add text or image watermarks", icon: Droplets, color: "text-amber-500" },
  { screen: "headerfooter", label: "Headers & footers", desc: "Add page numbers, headers & footers", icon: Heading, color: "text-sky-500" },
  { screen: "crop", label: "Crop", desc: "Crop pages and adjust page size", icon: Crop, color: "text-purple-500" },
  { screen: "export", label: "Export", desc: "Convert to text, HTML or images", icon: FileOutput, color: "text-indigo-500" },
  { screen: "compare", label: "Compare", desc: "Compare two PDFs side by side", icon: GitCompare, color: "text-teal-500" },
  { screen: "pdfa", label: "PDF/A check", desc: "Preflight for archival readiness", icon: FileCheck2, color: "text-lime-600" },
];

/** How many tools show before the "Show more" toggle on the welcome screen. */
const PRIMARY_TOOL_COUNT = 4;

/** Relative "opened N ago" label for the Recent list. */
function relTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** A VS Code-style "Start" link: coloured icon + text, underline on hover. */
function StartAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-2 text-left">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-sm text-foreground transition-colors group-hover:text-primary group-hover:underline">
        {label}
      </span>
    </button>
  );
}

// Welcome screen shown when no document is open — a VS Code-style landing with a
// "Start" column (open / create), a "Recent" list, and the tools as a
// walkthrough-like column. A PDF can still be dropped anywhere on the page.
export function WelcomeScreen() {
  const app = useAppSelector(
    (s) => ({
      openFile: s.openFile,
      requestOpen: s.requestOpen,
      openFolder: s.openFolder,
      openRecent: s.openRecent,
      recentFiles: s.recentFiles,
      setScreen: s.setScreen,
    }),
    shallowEqual,
  );
  const [dragOver, setDragOver] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const recent = app.recentFiles.slice(0, 6);
  const shownTools = showAllTools ? QUICK_TOOLS : QUICK_TOOLS.slice(0, PRIMARY_TOOL_COUNT);
  const hiddenToolCount = QUICK_TOOLS.length - PRIMARY_TOOL_COUNT;

  return (
    <div
      className={cn(
        "scrollbar-soft h-full overflow-auto px-8 py-12 md:px-14 md:py-16",
        dragOver && "bg-accent/40",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        // This empty-state handler also captures the file-system handle for
        // save-in-place. Keep the same drop from bubbling to the global
        // DropZone, which would otherwise read and open large PDFs a second
        // time.
        e.stopPropagation();
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
            const h = handles[i];
            await app.openFile(f, h?.kind === "file" ? h : undefined);
          }
        })();
      }}
    >
      <div className="mx-auto w-full max-w-4xl">
        <BrandLogo
          className="flex-wrap gap-3"
          markClassName="h-20 w-20 sm:h-24 sm:w-24"
          wordmarkClassName="text-4xl font-semibold sm:text-5xl"
        />
        <p className="pt-1 text-sm text-muted-foreground">
          Read, annotate, sign &amp; edit PDFs.
        </p>
        <p className="pt-0.5 text-xs text-muted-foreground/70">
          Tip: drag a PDF anywhere onto this page to open it.
        </p>

        <div className="grid gap-10 pt-10 md:grid-cols-2">
          {/* Left: Start actions + Recent files */}
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">Start</h2>
            <div className="flex flex-col items-start gap-2.5 pt-3">
              <StartAction icon={FileText} label="Open a PDF…" onClick={() => void app.requestOpen()} />
              <StartAction icon={FolderOpen} label="Open a folder of PDFs…" onClick={() => void app.openFolder()} />
              <StartAction icon={FilePlus2} label="Create a blank PDF" onClick={() => app.setScreen("templates")} />
            </div>

            <h2 className="pt-8 text-sm font-medium text-muted-foreground">Recent</h2>
            <div className="flex flex-col items-start gap-2 pt-3">
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">
                  No recent files yet — open a PDF to get started.
                </p>
              ) : (
                recent.map((r) => (
                  <Tip key={r.id} label={r.name}>
                    <button
                      type="button"
                      onClick={() => void app.openRecent(r.id)}
                      className="group flex max-w-full items-center gap-2 text-left"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      <span className="truncate text-sm text-foreground transition-colors group-hover:text-primary group-hover:underline">
                        {r.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        {relTime(r.lastOpened)}
                      </span>
                    </button>
                  </Tip>
                ))
              )}
            </div>
          </div>

          {/* Right: tools, presented like VS Code's walkthroughs column */}
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">Tools</h2>
            <div className="flex flex-col gap-2 pt-3">
              {shownTools.map((t) => (
                <button
                  key={t.screen}
                  type="button"
                  onClick={() => app.setScreen(t.screen)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-foreground/30 hover:bg-accent"
                >
                  <t.icon className={cn("h-5 w-5 shrink-0", t.color)} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{t.label}</p>
                    <p className="pt-0.5 text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            {hiddenToolCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllTools((v) => !v)}
                aria-expanded={showAllTools}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", showAllTools && "rotate-180")}
                />
                {showAllTools ? "Show fewer tools" : `Show ${hiddenToolCount} more tools`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */


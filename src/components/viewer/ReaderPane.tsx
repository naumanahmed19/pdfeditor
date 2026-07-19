import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PdfDoc, PdfPage } from "../../lib/pdf";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { renderTextLayer } from "../../lib/pdf";
import { attachTextSelection } from "../../lib/textselect";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import { Tip } from "../ui/tooltip";

const PAGE_GAP = 20;

interface PageDims {
  width: number;
  height: number;
}

/**
 * Lightweight, read-only continuous viewer used for the side-by-side
 * reference pane. Renders pages (canvas + selectable text layer) with its
 * own fit-width / zoom, independent of the editable primary Viewer.
 */
export function ReaderPane({ docId }: { docId: string }) {
  const app = useApp();
  const doc = app.docById(docId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<PageDims[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const pdf = doc?.pdf ?? null;

  useEffect(() => {
    let alive = true;
    if (!pdf) return;
    (async () => {
      const out: PageDims[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        out.push({ width: vp.width, height: vp.height });
      }
      if (alive) setDims(out);
    })();
    return () => {
      alive = false;
    };
  }, [pdf]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    obs.observe(el);
    setContainerWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Word-like text selection (same controller as the primary Viewer).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pdf) return;
    return attachTextSelection(el);
  }, [pdf]);

  const maxWidth = useMemo(
    () => dims.reduce((m, d) => Math.max(m, d.width), 0),
    [dims],
  );
  const scale = useMemo(() => {
    if (manualScale != null) return manualScale;
    if (maxWidth > 0 && containerWidth > 0) {
      return Math.min(2.5, Math.max(0.2, (containerWidth - 40) / maxWidth));
    }
    return 1;
  }, [manualScale, maxWidth, containerWidth]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let acc = 0;
    for (let i = 0; i < dims.length; i++) {
      const h = dims[i].height * scale + PAGE_GAP;
      if (mid < acc + h) {
        setPage(i);
        return;
      }
      acc += h;
    }
  }, [dims, scale]);

  const goToPage = (p: number) => {
    const idx = Math.max(0, Math.min((doc?.numPages ?? 1) - 1, p));
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-rp-page="${idx}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!doc || !pdf) return null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-muted/40 dark:bg-background">
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="scrollbar-soft h-full overflow-auto px-4 py-4"
        >
          <div className="mx-auto flex w-fit flex-col items-center" style={{ gap: PAGE_GAP }}>
            {dims.map((d, i) => (
              <ReaderPage
                key={i}
                pdf={pdf}
                pageIndex={i}
                baseDims={d}
                scale={scale}
              />
            ))}
          </div>
        </div>

        {/* mini nav pill */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/60 bg-background/80 px-1.5 py-1 opacity-80 shadow-shell backdrop-blur-md transition-opacity hover:opacity-100">
            <Tip label="Previous page"><button className={navBtn} aria-label="Previous page" disabled={page <= 0} onClick={() => goToPage(page - 1)}><ChevronLeft className="h-4 w-4" /></button></Tip>
            <span className="px-1 text-xs tabular-nums text-muted-foreground">
              {page + 1}/{doc.numPages}
            </span>
            <Tip label="Next page"><button className={navBtn} aria-label="Next page" disabled={page >= doc.numPages - 1} onClick={() => goToPage(page + 1)}><ChevronRight className="h-4 w-4" /></button></Tip>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Tip label="Zoom out"><button className={navBtn} aria-label="Zoom out" onClick={() => setManualScale(Math.max(0.2, scale - 0.15))}><ZoomOut className="h-4 w-4" /></button></Tip>
            <Tip label="Fit width"><button className="h-6 min-w-10 rounded-full px-1 text-xs font-medium tabular-nums text-muted-foreground hover:bg-accent" aria-label="Fit width" onClick={() => setManualScale(null)}>{manualScale == null ? "Fit" : `${Math.round(scale * 100)}%`}</button></Tip>
            <Tip label="Zoom in"><button className={navBtn} aria-label="Zoom in" onClick={() => setManualScale(Math.min(3, scale + 0.15))}><ZoomIn className="h-4 w-4" /></button></Tip>
          </div>
        </div>
      </div>
    </div>
  );
}

const navBtn =
  "flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

function ReaderPage({
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [painted, setPainted] = useState(false);

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

  useEffect(() => {
    if (!visible) {
      setPainted(false);
      return;
    }
    setPainted(false);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const canvas = canvasRef.current;
      const textDiv = textLayerRef.current;
      if (!canvas || !textDiv) return;
      let p: PdfPage;
      try {
        p = await pdf.getPage(pageIndex + 1);
      } catch {
        return;
      }
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.getViewport({ scale: scale * dpr });
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        await p.render({ canvasContext: ctx, viewport: vp } as any).promise;
      } catch {
        return;
      }
      if (cancelled) return;
      setPainted(true);
      try {
        renderTextLayer(p, textDiv, scale);
      } catch {
        /* text layer optional */
      }
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, pageIndex, scale, visible]);

  return (
    <div
      ref={wrapRef}
      data-rp-page={pageIndex}
      className={cn(
        "relative shrink-0 bg-white shadow-shell ring-1 ring-border/60",
      )}
      style={{ width: w, height: h, scrollMarginTop: 12 }}
    >
      {visible && !painted && (
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
      )}
      {visible && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
      <div ref={textLayerRef} className="textLayer" />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { BookOpen, SlidersHorizontal } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import { renderPageToCanvas, getOutline } from "../../lib/pdf";
import type { OutlineNode, Screen } from "../../types";

export function Sidebar() {
  const app = useApp();
  const [tab, setTab] = useState<"pages" | "outline">("pages");

  return (
    <aside className="flex w-[288px] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {app.pdf && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 px-3 pt-2">
            <TabButton
              active={tab === "pages"}
              onClick={() => setTab("pages")}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              label="Pages"
            />
            <TabButton
              active={tab === "outline"}
              onClick={() => setTab("outline")}
              icon={<BookOpen className="h-3.5 w-3.5" />}
              label="Outline"
            />
          </div>
          {tab === "pages" ? (
            <ThumbnailList />
          ) : (
            <OutlinePanel pdf={app.pdf} />
          )}
        </div>
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ThumbnailList() {
  const app = useApp();
  if (!app.pdf) return null;
  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div className="flex flex-col gap-2">
        {Array.from({ length: app.numPages }, (_, i) => (
          <Thumbnail
            key={`${app.docVersion}-${i}`}
            pdf={app.pdf!}
            pageIndex={i}
            active={app.currentPage === i}
            onClick={() => {
              app.setScreen("viewer");
              app.scrollToPage(i);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function Thumbnail({
  pdf,
  pageIndex,
  active,
  onClick,
  width = 150,
}: {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  active?: boolean;
  onClick?: () => void;
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    rendered.current = false;
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || rendered.current) return;
        rendered.current = true;
        const page = await pdf.getPage(pageIndex + 1);
        const vp = page.getViewport({ scale: 1 });
        const scale = width / vp.width;
        if (canvasRef.current) {
          await renderPageToCanvas(pdf, pageIndex, canvasRef.current, scale);
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [pdf, pageIndex, width]);

  return (
    <div
      ref={wrapRef}
      onClick={onClick}
      className={cn(
        "mx-auto w-fit cursor-pointer rounded-lg border bg-background p-1.5 transition-colors",
        active
          ? "border-foreground/50 ring-1 ring-foreground/30"
          : "border-sidebar-border hover:border-foreground/25",
      )}
    >
      <canvas
        ref={canvasRef}
        className="rounded-sm bg-white"
        style={{ width }}
      />
      <p className="pt-1 text-center text-[11px] text-muted-foreground">
        {pageIndex + 1}
      </p>
    </div>
  );
}

function OutlinePanel({ pdf }: { pdf: PDFDocumentProxy }) {
  const app = useApp();
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);

  useEffect(() => {
    let alive = true;
    setOutline(null);
    getOutline(pdf).then((o) => {
      if (alive) setOutline(o);
    });
    return () => {
      alive = false;
    };
  }, [pdf]);

  if (outline === null) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>;
  }
  if (!outline.length) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        This document has no outline.
      </p>
    );
  }
  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <OutlineTree nodes={outline} depth={0} onGoto={(p) => app.scrollToPage(p)} />
    </div>
  );
}

function OutlineTree({
  nodes,
  depth,
  onGoto,
}: {
  nodes: OutlineNode[];
  depth: number;
  onGoto: (page: number) => void;
}) {
  return (
    <div className="flex flex-col">
      {nodes.map((n, i) => (
        <div key={i}>
          <button
            disabled={n.pageIndex === null}
            onClick={() => n.pageIndex !== null && onGoto(n.pageIndex)}
            className="w-full truncate rounded px-2 py-1 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-60"
            style={{ paddingLeft: 8 + depth * 14 }}
            title={n.title}
          >
            {n.title}
          </button>
          {n.children.length > 0 && (
            <OutlineTree nodes={n.children} depth={depth + 1} onGoto={onGoto} />
          )}
        </div>
      ))}
    </div>
  );
}

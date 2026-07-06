import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize,
  Minimize,
  MoveHorizontal,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useApp } from "../../store";

/** Translucent page/zoom pill floating at the bottom of the viewer. */
export function FloatingNav({
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
                    app.setSpread(!app.spread);
                  }}
                >
                  <Columns2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">Two-page spread</span>
                  {app.spread && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
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

import { useEffect, useRef } from "react";
import { ArrowLeft, FileText, Plus, X } from "lucide-react";
import { AppProvider, useApp } from "./store";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { cn } from "./lib/utils";
import { Toaster } from "./components/ui/sonner";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { Viewer } from "./components/viewer/Viewer";
import { EditorToolbar } from "./components/viewer/Toolbar";
import { SignatureModal } from "./components/viewer/SignatureModal";
import { AiPanel } from "./components/ai/AiPanel";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import {
  MergeScreen,
  OrganizeScreen,
  SplitScreen,
  WatermarkScreen,
} from "./components/tools/ToolsScreens";

const SCREEN_TITLES: Record<string, string> = {
  viewer: "Viewer & Editor",
  organize: "Organize pages",
  merge: "Merge PDFs",
  split: "Split & extract",
  watermark: "Watermark & numbers",
  settings: "Settings",
};

function ContentHeader() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  // Viewer screen with open documents: the header row IS the tab strip.
  if (app.screen === "viewer" && app.tabs.length > 0) {
    return (
      <div className="sticky top-0 z-20 flex h-11 shrink-0 items-center rounded-tl-lg border-b bg-background/95 px-2 backdrop-blur">
        {app.tabs.map((t) => {
          const isActive = t.id === app.activeTabId;
          return (
            <div
              key={t.id}
              onClick={() => app.switchTab(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) app.closeTab(t.id);
              }}
              title={t.name}
              className={cn(
                "group relative flex h-full min-w-0 max-w-52 cursor-pointer items-center gap-1.5 px-3 text-xs transition-colors",
                isActive
                  ? "bg-muted/60 font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-primary"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="truncate">{t.name}</span>
              {t.hasEdits && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                  title="Unsaved edits"
                />
              )}
              <button
                className="shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  app.closeTab(t.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Open another PDF"
          onClick={() => fileRef.current?.click()}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {app.editMode && (
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
              Editing
            </span>
          )}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {app.numPages} pages
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={async (e) => {
            for (const f of Array.from(e.target.files ?? [])) {
              await app.openFile(f);
            }
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  // Other screens (and viewer with nothing open): plain title header.
  return (
    <div className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 rounded-tl-lg border-b bg-background/95 px-4 backdrop-blur">
      {app.screen !== "viewer" && (
        <button
          onClick={() => app.setScreen("viewer")}
          className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Back to document"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      {app.screen === "viewer" ? (
        <>
          <button
            className="-ml-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open a PDF"
            onClick={() => fileRef.current?.click()}
          >
            <Plus className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={async (e) => {
              for (const f of Array.from(e.target.files ?? [])) {
                await app.openFile(f);
              }
              e.target.value = "";
            }}
          />
        </>
      ) : (
        <span className="text-sm font-medium">{SCREEN_TITLES[app.screen]}</span>
      )}
      {app.screen !== "viewer" && app.docName && (
        <>
          <span className="text-muted-foreground">›</span>
          <span className="truncate text-sm text-muted-foreground">
            {app.docName}
          </span>
        </>
      )}
    </div>
  );
}

function Shell() {
  const app = useApp();

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        document.getElementById("global-open-input")?.click();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const input = document.getElementById("doc-search-input") as HTMLInputElement | null;
        input?.focus();
        input?.select();
        return;
      }
      if (mod && e.key.toLowerCase() === "s" && app.pdf) {
        e.preventDefault();
        void app.downloadCurrent();
        return;
      }
      if (mod && e.key.toLowerCase() === "p" && app.pdf) {
        e.preventDefault();
        void app.printCurrent();
        return;
      }
      if (inField || !app.pdf || app.screen !== "viewer") return;

      if (e.key === "+" || e.key === "=") {
        app.setFitMode(null);
        app.setScale(Math.min(3, app.scale + 0.15));
      } else if (e.key === "-") {
        app.setFitMode(null);
        app.setScale(Math.max(0.3, app.scale - 0.15));
      } else if (e.key === "PageDown") {
        e.preventDefault();
        app.scrollToPage(Math.min(app.numPages - 1, app.currentPage + 1));
      } else if (e.key === "PageUp") {
        e.preventDefault();
        app.scrollToPage(Math.max(0, app.currentPage - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        app.scrollToPage(0);
      } else if (e.key === "End") {
        e.preventDefault();
        app.scrollToPage(app.numPages - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-lg border-l border-t bg-background shadow-shell">
          <ContentHeader />
          {app.screen === "viewer" && app.editMode && <EditorToolbar />}
          <div className="min-h-0 flex-1">
            {app.screen === "viewer" && (
              <Viewer key={app.activeTabId ?? "empty"} />
            )}
            {app.screen === "organize" && <OrganizeScreen />}
            {app.screen === "merge" && <MergeScreen />}
            {app.screen === "split" && <SplitScreen />}
            {app.screen === "watermark" && <WatermarkScreen />}
            {app.screen === "settings" && <SettingsScreen />}
          </div>
        </main>
        <AiPanel />
      </div>
      <SignatureModal />
      <Toaster richColors />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ErrorBoundary>
  );
}

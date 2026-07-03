import { useEffect, useRef } from "react";
import { ArrowLeft, Download, FileText, Plus, Printer, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { AppProvider, useApp } from "./store";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { Viewer } from "./components/viewer/Viewer";
import { ReaderPane } from "./components/viewer/ReaderPane";
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

function DocActions() {
  const app = useApp();
  if (!app.pdf) return null;

  const saveBtn = (
    <Button
      variant="default"
      size="sm"
      className="h-7 gap-1.5"
      onClick={() => void app.saveCurrent()}
    >
      <Download className="h-3.5 w-3.5" />
      {app.activeHasHandle ? "Save" : "Save PDF"}
    </Button>
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="hidden h-7 w-7 sm:inline-flex"
        title="Print"
        onClick={() => void app.printCurrent()}
      >
        <Printer className="h-4 w-4" />
      </Button>
      {app.editMode ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => {
              app.setEditMode(false);
              app.setScreen("viewer");
              const hasNewFields = Object.values(app.annotations)
                .flat()
                .some((a) => a.kind === "formfield");
              if (hasNewFields) {
                toast.info("New form fields become fillable after you save the PDF.");
              }
            }}
          >
            Done
          </Button>
          {saveBtn}
        </>
      ) : (
        <>
          {app.hasAnnotations && saveBtn}
          <Button
            variant={app.hasAnnotations ? "outline" : "default"}
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => {
              app.setEditMode(true);
              app.setScreen("viewer");
            }}
          >
            <SquarePen className="h-3.5 w-3.5" />
            Edit
          </Button>
        </>
      )}
    </div>
  );
}

function ContentHeader() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  // Viewer screen with a document open: name + status + doc actions.
  if (app.screen === "viewer" && app.pdf) {
    return (
      <div className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 rounded-tl-lg border-b bg-background/95 px-3 backdrop-blur">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{app.docName}</span>
        {app.hasAnnotations && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
            title="Unsaved edits"
          />
        )}
        {app.editMode && (
          <span className="hidden shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 sm:inline dark:text-blue-400">
            Editing
          </span>
        )}
        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">
          {app.numPages} pages
        </span>
        <div className="ml-auto">
          <DocActions />
        </div>
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
            onClick={() => void app.requestOpen()}
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
        void app.requestOpen();
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
        void app.saveCurrent();
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
    <div className="flex h-full flex-col overflow-hidden bg-sidebar">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-tl-lg lg:border-l lg:border-t lg:shadow-shell">
          <ContentHeader />
          {app.screen === "viewer" && app.editMode && <EditorToolbar />}
          <div className="min-h-0 flex-1">
            {app.screen === "viewer" &&
              (app.splitTabId ? (
                <div className="flex h-full min-h-0 flex-col lg:flex-row">
                  <div className="min-h-0 min-w-0 flex-1 border-b lg:border-b-0 lg:border-r">
                    <Viewer key={app.activeTabId ?? "empty"} />
                  </div>
                  <div className="min-h-0 min-w-0 flex-1">
                    <ReaderPane key={app.splitTabId} docId={app.splitTabId} />
                  </div>
                </div>
              ) : (
                <Viewer key={app.activeTabId ?? "empty"} />
              ))}
            {app.screen === "organize" && <OrganizeScreen />}
            {app.screen === "merge" && <MergeScreen />}
            {app.screen === "split" && <SplitScreen />}
            {app.screen === "watermark" && <WatermarkScreen />}
            {app.screen === "settings" && <SettingsScreen />}
          </div>
        </main>
        <AiPanel />

        {/* Mobile drawer backdrops */}
        {app.sidebarOpen && (
          <div
            className="fixed inset-0 top-[42px] z-30 bg-black/40 lg:hidden"
            onClick={() => app.setSidebarOpen(false)}
          />
        )}
        {app.aiOpen && app.isMobile && (
          <div
            className="fixed inset-0 top-[42px] z-30 bg-black/40 lg:hidden"
            onClick={() => app.setAiOpen(false)}
          />
        )}
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

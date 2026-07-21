import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Columns2,
  EllipsisVertical,
  FileText,
  Plus,
  Printer,
  Save,
  SquarePen,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppProvider, useApp } from "./store";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Button } from "./components/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "./components/ui/menu";
import { cn } from "./lib/utils";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { Toaster } from "./components/ui/sonner";
import { TitleBar } from "./components/layout/TitleBar";
import { UpdateNotifier } from "./components/layout/UpdateNotifier";
import { OnboardingTour } from "./components/layout/OnboardingTour";
import { Sidebar } from "./components/layout/Sidebar";
import { DropZone } from "./components/layout/DropZone";
import { CommandPalette } from "./components/command/CommandPalette";
import { Viewer } from "./components/viewer/Viewer";
import { ReaderPane } from "./components/viewer/ReaderPane";
import { EditorToolbar } from "./components/viewer/Toolbar";
import { SignatureModal } from "./components/viewer/SignatureModal";
import { CalibrateModal } from "./components/viewer/CalibrateModal";
import { AiPanel } from "./components/ai/AiPanel";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import {
  CompressScreen,
  CropScreen,
  ExportScreen,
  HeaderFooterScreen,
  MergeScreen,
  OrganizeScreen,
  SplitScreen,
  WatermarkScreen,
} from "./components/tools/ToolsScreens";
import { CompareScreen } from "./components/tools/CompareScreen";
import { DocToPdfScreen, ImagesToPdfScreen } from "./components/tools/CreatePdfScreen";
import { PdfaScreen } from "./components/tools/PdfaScreen";
import { TemplatesScreen } from "./components/tools/TemplatesScreen";
import { ChromeExtensionBridge } from "./components/ChromeExtensionBridge";

const SCREEN_TITLES: Record<string, string> = {
  viewer: "Viewer & Editor",
  templates: "New from template",
  organize: "Organize pages",
  createimages: "Images to PDF",
  createdoc: "Word or text to PDF",
  merge: "Merge PDFs",
  split: "Split & extract",
  watermark: "Watermark & numbers",
  compress: "Compress",
  crop: "Crop pages",
  headerfooter: "Headers & footers",
  export: "Export",
  compare: "Compare documents",
  pdfa: "PDF/A check",
  settings: "Settings",
};

/**
 * Tool screens that act on the currently open document — their header shows a
 * `filename › tool` breadcrumb. Screens that stand alone (templates, merge,
 * settings) don't, so no misleading file context is implied.
 */
const FILE_SCOPED_SCREENS = new Set([
  "organize",
  "split",
  "watermark",
  "compress",
  "crop",
  "headerfooter",
  "export",
  "compare",
  "pdfa",
]);

function PaneShell({ pane }: { pane: { id: string; docId: string } }) {
  const app = useApp();
  // The editable Viewer is bound to the active document, so only render it
  // when this focused pane's document matches (otherwise it'd show the wrong
  // doc). Any other pane renders its own document read-only.
  const editable = pane.id === app.activePaneId && pane.docId === app.activeTabId;

  return (
    <div
      className={cn(
        "h-full min-h-0 min-w-0",
        pane.id === app.activePaneId && "ring-1 ring-inset ring-primary/30",
      )}
      onPointerDownCapture={() => {
        if (pane.id !== app.activePaneId) app.focusPane(pane.id);
      }}
    >
      {editable ? (
        <Viewer key={`v-${pane.docId}`} />
      ) : (
        <ReaderPane key={`r-${pane.id}-${pane.docId}`} docId={pane.docId} />
      )}
    </div>
  );
}

/** One document segment inside the split main header (replaces per-pane headers). */
function PaneTab({ pane }: { pane: { id: string; docId: string } }) {
  const app = useApp();
  const doc = app.docById(pane.docId);
  const isFocused = pane.id === app.activePaneId;
  const hasEdits = app.tabs.find((t) => t.id === pane.docId)?.hasEdits ?? false;
  if (!doc) return null;

  return (
    <div
      onClick={() => !isFocused && app.focusPane(pane.id)}
      className={cn(
        "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-3",
        isFocused ? "bg-background" : "bg-muted/30 hover:bg-muted/50",
      )}
    >
      <FileText
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isFocused ? "text-foreground" : "text-muted-foreground",
        )}
      />
      <span
        className={cn(
          "truncate text-xs",
          isFocused ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {doc.name}
      </span>
      {hasEdits && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
          title="Unsaved edits"
        />
      )}
      <div
        className="ml-auto flex shrink-0 items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {isFocused && app.hasAnnotations && (
          <Button
            variant="default"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => void app.saveCurrent()}
          >
            <Save className="h-3 w-3" />
            Save
          </Button>
        )}
        <Menu>
          <MenuTrigger
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
            aria-label="Pane menu"
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </MenuTrigger>
          <MenuContent className="min-w-44">
            {!isFocused && (
              <MenuItem
                onClick={() => {
                  app.focusPane(pane.id);
                  app.setScreen("viewer");
                }}
              >
                <SquarePen className="h-4 w-4 text-muted-foreground" />
                Edit this pane
              </MenuItem>
            )}
            <MenuItem onClick={() => void app.printDoc(pane.docId)}>
              <Printer className="h-4 w-4 text-muted-foreground" />
              Print
            </MenuItem>
            <MenuItem onClick={() => app.openInPane(pane.docId)}>
              <Columns2 className="h-4 w-4 text-muted-foreground" />
              Split this document
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => app.closePane(pane.id)}>
              <X className="h-4 w-4 text-muted-foreground" />
              Close pane
            </MenuItem>
            <MenuItem onClick={() => app.exitSplit()}>
              <FileText className="h-4 w-4 text-muted-foreground" />
              Exit split view
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

/** Document title — click to rename (Enter commits, Escape cancels). */
function DocName() {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!app.docName) return null;

  if (!editing) {
    return (
      <button
        className="-mx-1 min-w-0 truncate rounded px-1 text-left text-sm font-medium transition-colors hover:bg-accent"
        title="Double-click to rename"
        onDoubleClick={() => {
          setValue(app.docName!.replace(/\.pdf$/i, ""));
          setEditing(true);
        }}
      >
        {app.docName}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    app.renameDoc(value);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      aria-label="Document name"
      className="h-6 w-56 max-w-[40vw] rounded-md border border-input bg-background px-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

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
      <Save className="h-3.5 w-3.5" />
      Save
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
      {app.hasAnnotations && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            toast("Discard all unsaved edits?", {
              description: "The document will return to its last saved state.",
              action: {
                label: "Discard",
                onClick: () => {
                  void app
                    .clearAnnotations()
                    .then(() => {
                      app.setEditMode(false);
                      toast.success("Edits discarded");
                    })
                    .catch(() => {});
                },
              },
            });
          }}
        >
          Discard
        </Button>
      )}
      {saveBtn}
    </div>
  );
}

function ContentHeader() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  // Split view: the header IS a row of pane segments (aligned with panes).
  // On desktop each segment's width tracks its resizable pane's live size; on
  // mobile the panes stack vertically, so the tab row stays evenly split.
  if (app.screen === "viewer" && app.panes.length >= 2) {
    return (
      <div
        data-tour="document-header"
        className="sticky top-0 z-20 flex h-11 shrink-0 items-stretch overflow-hidden rounded-tl-lg border-b bg-background/95 backdrop-blur"
      >
        {app.panes.map((pane, i) => {
          const size = !app.isMobile ? app.paneSizes[i] : undefined;
          return (
            <div
              key={pane.id}
              className={cn("flex min-w-0", i > 0 && "border-l")}
              style={
                size != null
                  ? { flex: `${size} 1 0%` }
                  : { flex: "1 1 0%" }
              }
            >
              <PaneTab pane={pane} />
            </div>
          );
        })}
      </div>
    );
  }

  // Viewer screen with a single document open: name + status + doc actions.
  if (app.screen === "viewer" && app.pdf) {
    return (
      <div
        data-tour="document-header"
        className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 rounded-tl-lg border-b bg-background/95 px-3 backdrop-blur"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <DocName />
        {app.hasAnnotations && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            title="Unsaved edits"
          />
        )}
        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">
          {app.numPages} pages
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Split editor"
            onClick={() => app.splitView()}
          >
            <Columns2 className="h-4 w-4" />
          </Button>
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
      ) : FILE_SCOPED_SCREENS.has(app.screen) && app.docName ? (
        // Breadcrumb: the open document (click to return) › the tool.
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <button
            className="min-w-0 max-w-[40vw] truncate rounded px-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Back to document"
            onClick={() => app.setScreen("viewer")}
          >
            {app.docName}
          </button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="shrink-0 font-medium">{SCREEN_TITLES[app.screen]}</span>
        </div>
      ) : (
        <span className="text-sm font-medium">{SCREEN_TITLES[app.screen]}</span>
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
      if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pdfwb:open-replace"));
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
          {app.screen === "viewer" && <EditorToolbar />}
          <div className="min-h-0 flex-1">
            {app.screen === "viewer" &&
              (app.panes.length >= 2 ? (
                <ResizablePanelGroup
                  // Remount when the set of panes changes so sizes reset to
                  // equal; on mobile the panes stack (vertical), else side by side.
                  key={app.panes.map((p) => p.id).join("|")}
                  direction={app.isMobile ? "vertical" : "horizontal"}
                  onLayout={(sizes) => app.setPaneSizes(sizes)}
                  className="min-h-0"
                >
                  {app.panes.map((pane, i) => (
                    <Fragment key={pane.id}>
                      {i > 0 && <ResizableHandle withHandle />}
                      <ResizablePanel
                        id={pane.id}
                        order={i}
                        defaultSize={100 / app.panes.length}
                        minSize={15}
                        className="min-h-0 min-w-0"
                      >
                        <PaneShell pane={pane} />
                      </ResizablePanel>
                    </Fragment>
                  ))}
                </ResizablePanelGroup>
              ) : (
                <Viewer key={app.activeTabId ?? "empty"} />
              ))}
            {app.screen === "templates" && <TemplatesScreen />}
            {app.screen === "organize" && <OrganizeScreen />}
            {app.screen === "createimages" && <ImagesToPdfScreen />}
            {app.screen === "createdoc" && <DocToPdfScreen />}
            {app.screen === "merge" && <MergeScreen />}
            {app.screen === "split" && <SplitScreen />}
            {app.screen === "watermark" && <WatermarkScreen />}
            {app.screen === "compress" && <CompressScreen />}
            {app.screen === "crop" && <CropScreen />}
            {app.screen === "headerfooter" && <HeaderFooterScreen />}
            {app.screen === "export" && <ExportScreen />}
            {app.screen === "compare" && <CompareScreen />}
            {app.screen === "pdfa" && <PdfaScreen />}
            {app.screen === "settings" && <SettingsScreen />}
          </div>
        </main>
        <AiPanel key={app.activeTabId ?? "general"} />

        {/* Mobile drawer backdrops */}
        {app.sidebarOpen && (
          <div
            className="fixed inset-0 top-[42px] z-40 bg-black/40 lg:hidden"
            onClick={() => app.setSidebarOpen(false)}
          />
        )}
        {app.aiOpen && app.isMobile && (
          <div
            className="fixed inset-0 top-[42px] z-40 bg-black/40 lg:hidden"
            onClick={() => app.setAiOpen(false)}
          />
        )}
      </div>
      <CommandPalette />
      <SignatureModal />
      <CalibrateModal />
      <DropZone />
      <UpdateNotifier />
      <ChromeExtensionBridge />
      <OnboardingTour
        hasDocument={Boolean(app.pdf)}
        onOpenDocument={() => void app.requestOpen()}
        onChooseComment={() => {
          app.setScreen("viewer");
          app.setEditMode(true);
          app.setTool("note");
        }}
        onOpenComments={() => {
          app.setScreen("viewer");
          app.setSidebarOpen(true);
          if (app.isMobile) app.setAiOpen(false);
          window.dispatchEvent(
            new CustomEvent("pdfwb:open-sidebar-panel", {
              detail: { panel: "comments" },
            }),
          );
        }}
        onFocusSearch={() =>
          window.dispatchEvent(new CustomEvent("pdfwb:focus-document-search"))
        }
        onOpenReplace={() =>
          window.dispatchEvent(new CustomEvent("pdfwb:open-replace"))
        }
        onOpenSplit={() => app.setScreen("split")}
        onOpenCommandPalette={() =>
          window.dispatchEvent(new CustomEvent("pdfwb:open-command-palette"))
        }
      />
      <Toaster />
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

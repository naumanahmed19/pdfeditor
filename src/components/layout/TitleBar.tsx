import { memo, useEffect, useRef, useState } from "react";
import {
  Bot,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Command as CommandIcon,
  Download,
  FileOutput,
  FilePlus2,
  FileSignature,
  FileText,
  FolderOpen,
  Lock,
  LockOpen,
  PanelLeft,
  Printer,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  Regex,
  Replace,
  ReplaceAll,
  Wrench,
  WholeWord,
  X,
} from "lucide-react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { useAppSelector, shallowEqual } from "../../store";
import { Button } from "../ui/button";
import { PropertiesModal } from "../viewer/PropertiesModal";
import { SecurityModal } from "../viewer/SecurityModal";
import { SignModal } from "../viewer/SignModal";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";
import { isTauri, isTauriMacOS } from "../../lib/tauri";
import { WindowControls } from "./WindowControls";
import { AboutModal } from "./AboutModal";
import { PasswordModal } from "./PasswordModal";
import { ConfirmModal } from "./ConfirmModal";
import { PrintModal } from "../viewer/PrintModal";
import { BrandLogo } from "./BrandLogo";
import { Tip } from "../ui/tooltip";
import { ToolsMenuItems } from "../tools/ToolsMenuItems";

// Memoized: it has no props, so it ignores parent (Shell) re-renders and only
// re-renders when its own selected store fields change.
export const TitleBar = memo(TitleBarImpl);

function TitleBarImpl() {
  // Select only what the title bar reads (no editing-tool state), so it stays
  // calm while you draw/select/drag on the page.
  const app = useAppSelector(
    (s) => ({
      activeMatch: s.activeMatch,
      activeProtected: s.activeProtected,
      aiOpen: s.aiOpen,
      applyBytesOp: s.applyBytesOp,
      clearSearch: s.clearSearch,
      closeDocument: s.closeDocument,
      downloadCurrent: s.downloadCurrent,
      gotoMatch: s.gotoMatch,
      isMobile: s.isMobile,
      ocrBusy: s.ocrBusy,
      openFile: s.openFile,
      openRecent: s.openRecent,
      pdf: s.pdf,
      printCurrent: s.printCurrent,
      recentFiles: s.recentFiles,
      requestConfirm: s.requestConfirm,
      requestOpen: s.requestOpen,
      runOcrText: s.runOcrText,
      runSearch: s.runSearch,
      saveCurrent: s.saveCurrent,
      screen: s.screen,
      searchError: s.searchError,
      searchMatches: s.searchMatches,
      searchOptions: s.searchOptions,
      securityModalOpen: s.securityModalOpen,
      setAiOpen: s.setAiOpen,
      setSearchOptions: s.setSearchOptions,
      setScreen: s.setScreen,
      setSecurityModalOpen: s.setSecurityModalOpen,
      signModalOpen: s.signModalOpen,
      setSignModalOpen: s.setSignModalOpen,
      setSidebarOpen: s.setSidebarOpen,
      sidebarOpen: s.sidebarOpen,
      replaceMatch: s.replaceMatch,
      replaceAll: s.replaceAll,
    }),
    shallowEqual,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const nativeMenuActionRef = useRef<(id: string) => void>(() => {});
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);

  useEffect(() => {
    const openReplace = () => {
      setReplaceOpen(true);
      requestAnimationFrame(() => {
        replaceInputRef.current?.focus();
        replaceInputRef.current?.select();
      });
    };
    window.addEventListener("pdfwb:open-replace", openReplace);
    return () => window.removeEventListener("pdfwb:open-replace", openReplace);
  }, []);

  useEffect(() => {
    const openProperties = () => {
      if (app.pdf) setPropsOpen(true);
    };
    const openAbout = () => setAboutOpen(true);
    const focusDocumentSearch = () => {
      if (!app.pdf) return;
      if (app.isMobile) {
        setMobileSearch(true);
        requestAnimationFrame(() => {
          const input = document.getElementById(
            "doc-mobile-search-input",
          ) as HTMLInputElement | null;
          input?.focus();
          input?.select();
        });
        return;
      }
      const input = document.getElementById(
        "doc-search-input",
      ) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    };

    window.addEventListener("pdfwb:open-properties", openProperties);
    window.addEventListener("pdfwb:open-about", openAbout);
    window.addEventListener("pdfwb:focus-document-search", focusDocumentSearch);
    return () => {
      window.removeEventListener("pdfwb:open-properties", openProperties);
      window.removeEventListener("pdfwb:open-about", openAbout);
      window.removeEventListener(
        "pdfwb:focus-document-search",
        focusDocumentSearch,
      );
    };
  }, [app.isMobile, app.pdf]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void app.runSearch(query);
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    void app.runSearch(value);
  };

  const flattenDocument = async () => {
    if (!app.pdf) return;
    const ok = await app.requestConfirm({
      title: "Flatten the document?",
      message:
        "All annotations and form fields are baked permanently into the page content and stop being editable or fillable. This cannot be undone after saving.",
      confirmLabel: "Flatten",
    });
    if (!ok) return;
    await app.applyBytesOp(async (b) => {
      const { flattenPdf } = await import("../../lib/pdfium");
      return flattenPdf(b);
    }, "Document flattened");
  };

  nativeMenuActionRef.current = (id) => {
    switch (id) {
      case "pickpdf.about":
        setAboutOpen(true);
        break;
      case "pickpdf.settings":
        app.setScreen("settings");
        break;
      case "pickpdf.file.open":
        void app.requestOpen();
        break;
      case "pickpdf.file.new-template":
        app.setScreen("templates");
        break;
      case "pickpdf.file.save":
        if (app.pdf) void app.saveCurrent();
        break;
      case "pickpdf.file.download-copy":
        if (app.pdf) void app.downloadCurrent();
        break;
      case "pickpdf.file.print":
        if (app.pdf) void app.printCurrent();
        break;
      case "pickpdf.file.properties":
        if (app.pdf) setPropsOpen(true);
        break;
      case "pickpdf.file.security":
        if (app.pdf) app.setSecurityModalOpen(true);
        break;
      case "pickpdf.file.sign":
        if (app.pdf) app.setSignModalOpen(true);
        break;
      case "pickpdf.file.close-document":
        if (app.pdf) app.closeDocument();
        break;
      case "pickpdf.view.sidebar": {
        const next = !app.sidebarOpen;
        app.setSidebarOpen(next);
        if (next && app.isMobile) app.setAiOpen(false);
        break;
      }
      case "pickpdf.view.search":
        window.dispatchEvent(new CustomEvent("pdfwb:focus-document-search"));
        break;
      case "pickpdf.view.command-palette":
        window.dispatchEvent(new CustomEvent("pdfwb:open-command-palette"));
        break;
      case "pickpdf.tools.organize":
        app.setScreen("organize");
        break;
      case "pickpdf.tools.create-images":
        app.setScreen("createimages");
        break;
      case "pickpdf.tools.create-document":
        app.setScreen("createdoc");
        break;
      case "pickpdf.tools.merge":
        app.setScreen("merge");
        break;
      case "pickpdf.tools.split":
        app.setScreen("split");
        break;
      case "pickpdf.tools.watermark":
        app.setScreen("watermark");
        break;
      case "pickpdf.tools.header-footer":
        app.setScreen("headerfooter");
        break;
      case "pickpdf.tools.crop":
        app.setScreen("crop");
        break;
      case "pickpdf.tools.compress":
        app.setScreen("compress");
        break;
      case "pickpdf.tools.export":
        app.setScreen("export");
        break;
      case "pickpdf.tools.compare":
        app.setScreen("compare");
        break;
      case "pickpdf.tools.pdfa":
        app.setScreen("pdfa");
        break;
      case "pickpdf.tools.ocr":
        if (app.pdf && !app.ocrBusy) void app.runOcrText();
        break;
      case "pickpdf.tools.flatten":
        void flattenDocument();
        break;
    }
  };

  useEffect(() => {
    if (!isTauriMacOS) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("pickpdf:native-menu", (event) => {
          nativeMenuActionRef.current(event.payload);
        }),
      )
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => console.error("Could not connect the macOS menu", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriMacOS) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("sync_native_menu_state", {
          hasPdf: !!app.pdf,
          ocrBusy: app.ocrBusy,
          activeProtected: app.activeProtected,
        }),
      )
      .catch((error) => console.error("Could not update the macOS menu", error));
  }, [app.activeProtected, app.ocrBusy, app.pdf]);

  const optionButtonClass = (active: boolean) =>
    cn(
      "rounded p-0.5 transition-colors hover:bg-accent",
      active && "bg-accent text-foreground",
    );

  const fileItems = (
    <>
      <MenuItem onClick={() => void app.requestOpen()}>
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        Open PDF…
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("templates")}>
        <FilePlus2 className="h-4 w-4 text-muted-foreground" />
        New from template…
      </MenuItem>
      {app.recentFiles.length > 0 && (
        <>
          <MenuSeparator />
          {app.recentFiles.slice(0, 6).map((r) => (
            <MenuItem key={r.id} onClick={() => void app.openRecent(r.id)}>
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
        </>
      )}
      <MenuItem disabled={!app.pdf} onClick={() => void app.saveCurrent()}>
        <Save className="h-4 w-4 text-muted-foreground" />
        Save
      </MenuItem>
      <MenuItem disabled={!app.pdf} onClick={() => void app.downloadCurrent()}>
        <Download className="h-4 w-4 text-muted-foreground" />
        Download a copy
      </MenuItem>
      <MenuItem disabled={!app.pdf} onClick={() => void app.printCurrent()}>
        <Printer className="h-4 w-4 text-muted-foreground" />
        Print…
      </MenuItem>
      <MenuItem disabled={!app.pdf} onClick={() => setPropsOpen(true)}>
        <Info className="h-4 w-4 text-muted-foreground" />
        Document properties…
      </MenuItem>
      <MenuItem disabled={!app.pdf} onClick={() => app.setSecurityModalOpen(true)}>
        {app.activeProtected ? (
          <LockOpen className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Lock className="h-4 w-4 text-muted-foreground" />
        )}
        {app.activeProtected ? "Document security…" : "Protect document…"}
      </MenuItem>
      <MenuItem disabled={!app.pdf} onClick={() => app.setSignModalOpen(true)}>
        <FileSignature className="h-4 w-4 text-muted-foreground" />
        Sign with certificate…
      </MenuItem>
      <MenuSeparator />
      <MenuItem disabled={!app.pdf} onClick={() => app.closeDocument()}>
        <X className="h-4 w-4 text-muted-foreground" />
        Close document
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => setAboutOpen(true)}>
        <Info className="h-4 w-4 text-muted-foreground" />
        About PickPDF
      </MenuItem>
    </>
  );

  const toolsItems = (
    <ToolsMenuItems
      hasPdf={Boolean(app.pdf)}
      ocrBusy={app.ocrBusy}
      onFlatten={() => void flattenDocument()}
      onRunOcr={() => void app.runOcrText()}
      onSelectScreen={app.setScreen}
    />
  );

  const triggerCls =
    "inline-flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground sm:px-2.5";

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex h-[42px] shrink-0 items-center gap-1.5 bg-sidebar pr-2 text-sidebar-foreground sm:gap-2 sm:pr-3",
        isTauri && !isTauriMacOS && "pr-0 sm:pr-0",
        isTauriMacOS && "pl-[76px]",
      )}
    >
      <div
        className={cn(
          "flex h-full w-12 shrink-0 items-center justify-center",
          app.sidebarOpen && "lg:border-r lg:border-sidebar-border/60",
        )}
      >
        <Tip label={app.sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 lg:hidden"
            aria-label={app.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => {
              const next = !app.sidebarOpen;
              app.setSidebarOpen(next);
              if (next && app.isMobile) app.setAiOpen(false);
            }}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </Tip>
        {!isTauriMacOS && (
          <button
            type="button"
            className="hidden h-full w-full items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:flex"
            aria-label="Open welcome page"
            title="Welcome"
            onClick={() => app.setScreen("welcome")}
          >
            <BrandLogo showWordmark={false} markClassName="h-7 w-7" />
          </button>
        )}
      </div>

      {!isTauriMacOS && (
        <button
          type="button"
          className="mr-1 hidden min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
          aria-label="Open welcome page"
          title="Welcome"
          onClick={() => app.setScreen("welcome")}
        >
          <BrandLogo
            className="min-w-0"
            markClassName="h-7 w-7 lg:hidden"
            wordmarkClassName="mt-[5px] text-[24px]"
          />
        </button>
      )}

      {/* File / Tools — icon-only on mobile, text on desktop */}
      {!isTauriMacOS && (
        <>
          <Menu>
            <MenuTrigger className={cn(triggerCls, "gap-1.5")} aria-label="File menu">
              <FolderOpen className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">File</span>
            </MenuTrigger>
            <MenuContent className="min-w-52">{fileItems}</MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger className={cn(triggerCls, "gap-1.5")} aria-label="Tools menu">
              <Wrench className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Tools</span>
            </MenuTrigger>
            <MenuContent className="min-w-48">{toolsItems}</MenuContent>
          </Menu>
        </>
      )}
      <Tip label="Command palette">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Command palette"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("pdfwb:open-command-palette"))
          }
        >
          <CommandIcon className="h-4 w-4" />
        </Button>
      </Tip>
      <input
        ref={fileRef}
        id="global-open-input"
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

      <form
        ref={searchFormRef}
        onSubmit={submitSearch}
        className="mx-auto hidden h-7 w-full max-w-md items-center gap-1 rounded-md border border-sidebar-border bg-background/70 px-2 sm:flex"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          id="doc-search-input"
          value={query}
          onChange={(e) => updateQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              app.gotoMatch(app.activeMatch - 1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              app.gotoMatch(app.activeMatch + 1);
            }
          }}
          placeholder={app.pdf ? "Search in document…" : "Open a PDF to search"}
          disabled={!app.pdf}
          className="h-full min-w-24 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {app.searchError ? (
          <Tip label={app.searchError}>
            <span className="shrink-0 text-[11px] text-destructive">Error</span>
          </Tip>
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {app.searchMatches.length
              ? `${app.activeMatch + 1}/${app.searchMatches.length}`
              : query.trim()
                ? "0/0"
                : ""}
          </span>
        )}
        <Menu>
          <Tip label="Search options">
            <MenuTrigger
              type="button"
              aria-label="Search options"
              className={optionButtonClass(
                app.searchOptions.matchCase ||
                  app.searchOptions.wholeWord ||
                  app.searchOptions.regex ||
                  app.searchOptions.preserveCase ||
                  !app.searchOptions.includePdfText ||
                  !app.searchOptions.includeAnnotations ||
                  !app.searchOptions.includeFormValues,
              )}
            >
              <SlidersHorizontal className="h-3 w-3" />
            </MenuTrigger>
          </Tip>
          <MenuContent align="end" className="min-w-60">
            <MenuGroup>
              <MenuLabel>Match</MenuLabel>
              <MenuItem
                onClick={() => app.setSearchOptions({ matchCase: !app.searchOptions.matchCase })}
              >
                <Checkbox checked={app.searchOptions.matchCase} />
                <CaseSensitive className="h-4 w-4 text-muted-foreground" />
                <span>Match case</span>
              </MenuItem>
              <MenuItem
                onClick={() => app.setSearchOptions({ wholeWord: !app.searchOptions.wholeWord })}
              >
                <Checkbox checked={app.searchOptions.wholeWord} />
                <WholeWord className="h-4 w-4 text-muted-foreground" />
                <span>Whole word</span>
              </MenuItem>
              <MenuItem
                onClick={() => app.setSearchOptions({ regex: !app.searchOptions.regex })}
              >
                <Checkbox checked={app.searchOptions.regex} />
                <Regex className="h-4 w-4 text-muted-foreground" />
                <span>Regular expression</span>
              </MenuItem>
              <MenuItem
                onClick={() =>
                  app.setSearchOptions({ preserveCase: !app.searchOptions.preserveCase })
                }
              >
                <Checkbox checked={app.searchOptions.preserveCase} />
                <span className="w-4 text-center text-[10px] font-semibold text-muted-foreground">
                  AB
                </span>
                <span>Preserve case on replace</span>
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuLabel>Search In</MenuLabel>
              <MenuItem
                onClick={() =>
                  app.setSearchOptions({ includePdfText: !app.searchOptions.includePdfText })
                }
              >
                <Checkbox checked={app.searchOptions.includePdfText} />
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>PDF text</span>
              </MenuItem>
              <MenuItem
                onClick={() =>
                  app.setSearchOptions({
                    includeAnnotations: !app.searchOptions.includeAnnotations,
                  })
                }
              >
                <Checkbox checked={app.searchOptions.includeAnnotations} />
                <SquarePen className="h-4 w-4 text-muted-foreground" />
                <span>Annotations and comments</span>
              </MenuItem>
              <MenuItem
                onClick={() =>
                  app.setSearchOptions({
                    includeFormValues: !app.searchOptions.includeFormValues,
                  })
                }
              >
                <Checkbox checked={app.searchOptions.includeFormValues} />
                <FileOutput className="h-4 w-4 text-muted-foreground" />
                <span>Form values</span>
              </MenuItem>
            </MenuGroup>
          </MenuContent>
        </Menu>
        <Popover open={replaceOpen} onOpenChange={setReplaceOpen}>
          <Tip label="Toggle replace">
            <PopoverTrigger
              type="button"
              aria-label="Toggle replace"
              className={optionButtonClass(replaceOpen)}
            >
              <Replace className="h-3 w-3" />
            </PopoverTrigger>
          </Tip>
          <PopoverContent
            anchor={searchFormRef}
            side="bottom"
            align="center"
            className="w-[min(28rem,calc(100vw-2rem))] p-2"
          >
            <div className="grid gap-2">
              <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2">
                <Replace className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={replaceInputRef}
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="Replace"
                  disabled={!app.pdf}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!app.searchMatches.length}
                  onClick={() => void app.replaceMatch(replacement)}
                >
                  <Replace className="mr-1.5 h-3.5 w-3.5" />
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!app.searchMatches.length}
                  onClick={() => void app.replaceAll(replacement)}
                >
                  <ReplaceAll className="mr-1.5 h-3.5 w-3.5" />
                  All
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {app.searchMatches.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
            <Tip label="Previous match">
              <button
                type="button"
                aria-label="Previous match"
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => app.gotoMatch(app.activeMatch - 1)}
              >
                <ChevronUp className="h-3 w-3" />
              </button>
            </Tip>
            <Tip label="Next match">
              <button
                type="button"
                aria-label="Next match"
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => app.gotoMatch(app.activeMatch + 1)}
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </Tip>
            <Tip label="Clear search">
              <button
                type="button"
                aria-label="Clear search"
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => {
                  setQuery("");
                  app.clearSearch();
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Tip>
          </div>
        )}
      </form>

      <Tip label="Search">
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 sm:hidden"
          aria-label="Search"
          disabled={!app.pdf}
          onClick={() => setMobileSearch(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
      </Tip>

      <Tip label={app.aiOpen ? "Hide AI assistant" : "Show AI assistant"}>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7",
            app.aiOpen && "bg-background text-foreground shadow-sm hover:bg-background",
          )}
          aria-label={app.aiOpen ? "Hide AI assistant" : "Show AI assistant"}
          onClick={() => {
            const next = !app.aiOpen;
            app.setAiOpen(next);
            if (next && app.isMobile) app.setSidebarOpen(false);
          }}
        >
          <Bot className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label="Settings">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7",
            app.screen === "settings" && "bg-background text-foreground shadow-sm hover:bg-background",
          )}
          aria-label="Settings"
          onClick={() => app.setScreen("settings")}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </Tip>

      {/* Frameless-window controls — desktop shell only */}
      {isTauri && !isTauriMacOS && <WindowControls />}

      {/* Mobile full-width search overlay */}
      {mobileSearch && (
        <div className="absolute inset-0 z-50 flex items-center gap-2 bg-sidebar px-2 sm:hidden">
          <form
            onSubmit={(e) => {
              submitSearch(e);
            }}
            className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-sidebar-border bg-background/70 px-2"
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              id="doc-mobile-search-input"
              value={query}
              onChange={(e) => updateQuery(e.target.value)}
              placeholder="Search in document…"
              className="h-full w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {app.searchMatches.length > 0 && (
              <div className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                  {app.activeMatch + 1}/{app.searchMatches.length}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-accent"
                  onClick={() => app.gotoMatch(app.activeMatch - 1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-accent"
                  onClick={() => app.gotoMatch(app.activeMatch + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </form>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => {
              setQuery("");
              app.clearSearch();
              setMobileSearch(false);
            }}
          >
            Done
          </Button>
        </div>
      )}
      <PropertiesModal open={propsOpen} onClose={() => setPropsOpen(false)} />
      <SecurityModal
        open={app.securityModalOpen}
        onClose={() => app.setSecurityModalOpen(false)}
      />
      <SignModal
        open={app.signModalOpen}
        onClose={() => app.setSignModalOpen(false)}
      />
      <PasswordModal />
      <ConfirmModal />
      <PrintModal />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </header>
  );
}

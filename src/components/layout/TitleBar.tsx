import { memo, useEffect, useRef, useState } from "react";
import {
  Bot,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Combine,
  Command as CommandIcon,
  Crop,
  Download,
  Droplets,
  FileOutput,
  FilePlus2,
  FileCheck2,
  FileSignature,
  FileText,
  FolderOpen,
  GitCompare,
  Heading,
  Layers2,
  LayoutGrid,
  Lock,
  LockOpen,
  Minimize2,
  PanelLeft,
  Printer,
  Save,
  ScanText,
  Scissors,
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
import { isTauri } from "../../lib/tauri";
import { WindowControls } from "./WindowControls";
import { AboutModal } from "./AboutModal";
import { PasswordModal } from "./PasswordModal";
import { ConfirmModal } from "./ConfirmModal";
import { PrintModal } from "../viewer/PrintModal";
import { BrandLogo } from "./BrandLogo";

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
    <>
      <MenuItem onClick={() => app.setScreen("organize")}>
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        Organize pages
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("create")}>
        <FilePlus2 className="h-4 w-4 text-muted-foreground" />
        Create PDF…
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("merge")}>
        <Combine className="h-4 w-4 text-muted-foreground" />
        Merge PDFs
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("split")}>
        <Scissors className="h-4 w-4 text-muted-foreground" />
        Split & extract
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("watermark")}>
        <Droplets className="h-4 w-4 text-muted-foreground" />
        Watermark & numbers
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("headerfooter")}>
        <Heading className="h-4 w-4 text-muted-foreground" />
        Headers & footers…
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("crop")}>
        <Crop className="h-4 w-4 text-muted-foreground" />
        Crop pages…
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("compress")}>
        <Minimize2 className="h-4 w-4 text-muted-foreground" />
        Compress…
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => app.setScreen("export")}>
        <FileOutput className="h-4 w-4 text-muted-foreground" />
        Export (text / HTML / images)…
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("compare")}>
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        Compare documents…
      </MenuItem>
      <MenuItem onClick={() => app.setScreen("pdfa")}>
        <FileCheck2 className="h-4 w-4 text-muted-foreground" />
        PDF/A check…
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        disabled={!app.pdf || app.ocrBusy}
        onClick={() => void app.runOcrText()}
      >
        <ScanText className="h-4 w-4 text-muted-foreground" />
        Make searchable (OCR)
      </MenuItem>
      <MenuItem
        disabled={!app.pdf}
        onClick={() => {
          void (async () => {
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
          })();
        }}
      >
        <Layers2 className="h-4 w-4 text-muted-foreground" />
        Flatten document
      </MenuItem>
    </>
  );

  const triggerCls =
    "inline-flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground sm:px-2.5";

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex h-[42px] shrink-0 items-center gap-1.5 bg-sidebar px-2 text-sidebar-foreground sm:gap-2 sm:px-3",
        isTauri && "pr-0 sm:pr-0",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={app.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={() => {
          const next = !app.sidebarOpen;
          app.setSidebarOpen(next);
          if (next && app.isMobile) app.setAiOpen(false);
        }}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <BrandLogo
        className="mr-1 hidden min-w-0 sm:flex"
        markClassName="h-7 w-7"
        wordmarkClassName="mt-[5px] text-[24px]"
      />

      {/* File / Tools — icon-only on mobile, text on desktop */}
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
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Command palette"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("pdfwb:open-command-palette"))
        }
      >
        <CommandIcon className="h-4 w-4" />
      </Button>
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
          <span className="shrink-0 text-[11px] text-destructive" title={app.searchError}>
            Error
          </span>
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
          <MenuTrigger
            type="button"
            className={optionButtonClass(
              app.searchOptions.matchCase ||
                app.searchOptions.wholeWord ||
                app.searchOptions.regex ||
                app.searchOptions.preserveCase ||
                !app.searchOptions.includePdfText ||
                !app.searchOptions.includeAnnotations ||
                !app.searchOptions.includeFormValues,
            )}
            title="Search options"
          >
            <SlidersHorizontal className="h-3 w-3" />
          </MenuTrigger>
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
          <PopoverTrigger
            type="button"
            className={optionButtonClass(replaceOpen)}
            title="Toggle replace"
          >
            <Replace className="h-3 w-3" />
          </PopoverTrigger>
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
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent"
              onClick={() => app.gotoMatch(app.activeMatch - 1)}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent"
              onClick={() => app.gotoMatch(app.activeMatch + 1)}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent"
              onClick={() => {
                setQuery("");
                app.clearSearch();
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </form>

      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-7 w-7 sm:hidden"
        title="Search"
        disabled={!app.pdf}
        onClick={() => setMobileSearch(true)}
      >
        <Search className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          app.aiOpen && "bg-background text-foreground shadow-sm hover:bg-background",
        )}
        title={app.aiOpen ? "Hide AI assistant" : "Show AI assistant"}
        onClick={() => {
          const next = !app.aiOpen;
          app.setAiOpen(next);
          if (next && app.isMobile) app.setSidebarOpen(false);
        }}
      >
        <Bot className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          app.screen === "settings" && "bg-background text-foreground shadow-sm hover:bg-background",
        )}
        title="Settings"
        onClick={() => app.setScreen("settings")}
      >
        <Settings className="h-4 w-4" />
      </Button>

      {/* Frameless-window controls — desktop shell only */}
      {isTauri && <WindowControls />}

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

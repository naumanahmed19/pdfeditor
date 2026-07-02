import { useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Combine,
  Download,
  Droplets,
  FileText,
  FolderOpen,
  LayoutGrid,
  Printer,
  Scissors,
  Search,
  Settings,
  SquarePen,
  X,
} from "lucide-react";
import { Info } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { PropertiesModal } from "../viewer/PropertiesModal";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { cn } from "../../lib/utils";

export function TitleBar() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [propsOpen, setPropsOpen] = useState(false);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void app.runSearch(query);
  };

  return (
    <header className="flex h-[42px] shrink-0 items-center gap-2 bg-sidebar px-3 text-sidebar-foreground">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" />
        PDF Workbench
      </div>

      <Menu>
        <MenuTrigger className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground">
          File
        </MenuTrigger>
        <MenuContent className="min-w-52">
          <MenuItem onClick={() => void app.requestOpen()}>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            Open PDF…
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
            <Download className="h-4 w-4 text-muted-foreground" />
            {app.activeHasHandle ? "Save" : "Save PDF"}
          </MenuItem>
          <MenuItem
            disabled={!app.pdf}
            onClick={() => void app.downloadCurrent()}
          >
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
          <MenuSeparator />
          <MenuItem disabled={!app.pdf} onClick={() => app.closeDocument()}>
            <X className="h-4 w-4 text-muted-foreground" />
            Close document
          </MenuItem>
        </MenuContent>
      </Menu>
      <Menu>
        <MenuTrigger className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground">
          Tools
        </MenuTrigger>
        <MenuContent className="min-w-48">
          <MenuItem onClick={() => app.setScreen("organize")}>
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            Organize pages
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
        </MenuContent>
      </Menu>
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
        onSubmit={submitSearch}
        className="mx-auto flex h-7 w-full max-w-md items-center gap-1.5 rounded-md border border-sidebar-border bg-background/70 px-2"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          id="doc-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={app.pdf ? "Search in document…" : "Open a PDF to search"}
          disabled={!app.pdf}
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

      {app.pdf && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
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
                className="h-7 gap-1.5"
                onClick={() => {
                  app.setEditMode(false);
                  app.setScreen("viewer");
                }}
              >
                Done
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => void app.saveCurrent()}
              >
                <Download className="h-3.5 w-3.5" />
                {app.activeHasHandle ? "Save" : "Save PDF"}
              </Button>
            </>
          ) : (
            <Button
              variant="default"
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
          )}
          <div className="mx-0.5 h-4 w-px bg-sidebar-border" />
        </>
      )}

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          app.aiOpen && "bg-accent text-accent-foreground",
        )}
        title="Toggle AI assistant"
        onClick={() => app.setAiOpen(!app.aiOpen)}
      >
        <Bot className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          app.screen === "settings" && "bg-accent text-accent-foreground",
        )}
        title="Settings"
        onClick={() => app.setScreen("settings")}
      >
        <Settings className="h-4 w-4" />
      </Button>
      <PropertiesModal open={propsOpen} onClose={() => setPropsOpen(false)} />
    </header>
  );
}

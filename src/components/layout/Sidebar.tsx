import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Columns2,
  Download,
  Files,
  FileText,
  Folder,
  FolderOpen,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { PdfDoc } from "../../lib/pdf";
import { useApp, type RecentFile } from "../../store";
import { cn, formatBytes } from "../../lib/utils";
import { renderPageToCanvas, getOutline } from "../../lib/pdf";
import type { OutlineInput } from "../../lib/pdftools";
import type { AttachmentInfo } from "../../lib/pdfium";
import type { FolderNode, NoteAnnotation, OutlineNode } from "../../types";

export function Sidebar() {
  const app = useApp();
  const [tab, setTab] = useState<
    "pages" | "outline" | "comments" | "attachments" | "recent"
  >("recent");

  // Pages/Outline only apply to an open document; fall back to Recent otherwise.
  const activeTab = app.pdf ? tab : "recent";

  return (
    <aside
      className={cn(
        // Mobile: fixed slide-over drawer below the title bar.
        "fixed bottom-0 left-0 top-[42px] z-40 flex w-[280px] max-w-[85vw] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200 ease-out",
        // Desktop: static column.
        "lg:static lg:z-auto lg:w-[288px] lg:max-w-none lg:translate-x-0 lg:border-r-0 lg:shadow-none lg:transition-none",
        app.sidebarOpen ? "translate-x-0" : "-translate-x-full lg:hidden",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-3 pt-2">
          <TabButton
            active={activeTab === "recent"}
            onClick={() => setTab("recent")}
            icon={<History className="h-3.5 w-3.5" />}
            label="Recent"
          />
          {app.pdf && (
            <div className="ml-auto flex items-center gap-1">
              <TabButton
                active={activeTab === "pages"}
                onClick={() => setTab("pages")}
                icon={<Files className="h-4 w-4" />}
                label="Pages"
                iconOnly
              />
              <TabButton
                active={activeTab === "outline"}
                onClick={() => setTab("outline")}
                icon={<BookOpen className="h-4 w-4" />}
                label="Outline"
                iconOnly
              />
              <TabButton
                active={activeTab === "comments"}
                onClick={() => setTab("comments")}
                icon={<MessageSquare className="h-4 w-4" />}
                label="Comments"
                iconOnly
              />
              <TabButton
                active={activeTab === "attachments"}
                onClick={() => setTab("attachments")}
                icon={<Paperclip className="h-4 w-4" />}
                label="Attachments"
                iconOnly
              />
            </div>
          )}
        </div>
        {app.pdf && activeTab === "pages" ? (
          <ThumbnailList />
        ) : app.pdf && activeTab === "outline" ? (
          <OutlinePanel pdf={app.pdf} />
        ) : app.pdf && activeTab === "comments" ? (
          <CommentsPanel />
        ) : app.pdf && activeTab === "attachments" ? (
          <AttachmentsPanel />
        ) : (
          <RecentList />
        )}
      </div>
    </aside>
  );
}

/** All note annotations across pages, with click-to-jump. */
function CommentsPanel() {
  const app = useApp();
  const notes: Array<{ page: number; ann: NoteAnnotation }> = [];
  for (const [p, list] of Object.entries(app.annotations)) {
    for (const a of list) {
      if (a.kind === "note") notes.push({ page: Number(p), ann: a });
    }
  }
  notes.sort((a, b) => a.page - b.page || a.ann.y - b.ann.y);

  if (!notes.length) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        No comments yet. Use the comment tool{" "}
        <MessageSquare className="inline h-3 w-3 align-[-2px]" /> in Edit mode
        to add one.
      </p>
    );
  }

  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <div className="flex flex-col gap-1.5">
        {notes.map(({ page, ann }) => (
          <button
            key={ann.id}
            onClick={() => {
              app.scrollToPage(page);
              app.setSelected({ page, id: ann.id });
              if (app.isMobile) app.setSidebarOpen(false);
            }}
            className="rounded-md border border-sidebar-border bg-background px-2.5 py-2 text-left text-xs shadow-sm transition-colors hover:bg-accent"
          >
            <span className="flex items-center gap-1.5 pb-1">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                style={{ background: ann.color }}
              />
              <span className="text-[10px] font-medium text-muted-foreground">
                Page {page + 1}
              </span>
            </span>
            <span className="line-clamp-3 whitespace-pre-wrap">
              {ann.text || "(empty comment)"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function collectFileNames(
  node: FolderNode | null | undefined,
  set = new Set<string>(),
): Set<string> {
  if (!node) return set;
  if (node.kind === "file") set.add(node.name);
  node.children?.forEach((c) => collectFileNames(c, set));
  return set;
}

function RecentList() {
  const app = useApp();
  // Files that live in the opened folder tree are shown there, not in the
  // flat Open/Recently-closed lists.
  const folderNames = collectFileNames(app.folderRoot);
  const openDocs = app.recentFiles.filter(
    (r) => r.open && !folderNames.has(r.name),
  );
  const closedDocs = app.recentFiles.filter(
    (r) => !r.open && !folderNames.has(r.name),
  );

  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <div className="flex items-center justify-between pb-0.5 pr-0.5">
        <SectionLabel>Open</SectionLabel>
        <div className="flex items-center gap-0.5">
          <button
            title="Open a PDF"
            onClick={() => void app.requestOpen()}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            title="Open a folder of PDFs"
            onClick={() => void app.openFolder()}
            disabled={app.folderBusy}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50"
          >
            {app.folderBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {app.folderRoot && <FolderSection root={app.folderRoot} />}

      {openDocs.length > 0 && (
        <div className="flex flex-col gap-0.5 pb-1">
          {openDocs.map((r) => (
            <RecentRow key={r.id} r={r} />
          ))}
        </div>
      )}

      {!openDocs.length && !app.folderRoot && (
        <p className="px-2 pb-2 text-[11px] text-muted-foreground">
          No document open. Use + to open a file or the folder icon to browse a
          folder.
        </p>
      )}

      {closedDocs.length > 0 && (
        <div className="pt-2">
          <SectionLabel>Recently closed</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {closedDocs.map((r) => (
              <RecentRow key={r.id} r={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FolderSection({ root }: { root: FolderNode }) {
  const app = useApp();
  const [open, setOpen] = useState(true);
  return (
    <div className="pb-1">
      <div className="group flex items-center gap-1 rounded-md pr-0.5 hover:bg-sidebar-accent/50">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-1 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={root.name}>
            {root.name}
          </span>
        </button>
        <button
          onClick={() => void app.openFolder()}
          title="Open another folder"
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <FolderOpen className="h-3 w-3" />
        </button>
        <button
          onClick={() => app.closeFolder()}
          title="Close folder"
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {open &&
        (root.children ?? []).map((n) => (
          <FolderTreeNode key={n.path} node={n} depth={1} />
        ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function RecentRow({ r }: { r: RecentFile }) {
  const app = useApp();
  const isActive = r.id === app.activeTabId;
  const hasEdits = app.tabs.find((t) => t.id === r.id)?.hasEdits ?? false;
  const open = () => {
    void app.openRecent(r.id);
    if (app.isMobile) app.setSidebarOpen(false);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      title={r.name}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "border-primary bg-background font-medium text-foreground shadow-sm"
          : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent",
      )}
    >
      <FileText
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{r.name}</span>
      {r.open ? (
        <>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full group-hover:hidden",
              hasEdits ? "bg-amber-500" : "bg-emerald-500",
            )}
            title={hasEdits ? "Unsaved edits" : "Currently open"}
          />
          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Open in a split pane"
              onClick={(e) => {
                e.stopPropagation();
                app.openInPane(r.id);
              }}
            >
              <Columns2 className="h-3 w-3" />
            </button>
            <button
              className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Close document"
              onClick={(e) => {
                e.stopPropagation();
                app.closeTab(r.id);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </>
      ) : (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {timeAgo(r.lastOpened)}
        </span>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  iconOnly,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={iconOnly ? label : undefined}
      aria-label={label}
      className={cn(
        "flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors",
        iconOnly ? "h-7 w-7 justify-center" : "px-2.5 py-1",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {!iconOnly && label}
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
              if (app.isMobile) app.setSidebarOpen(false);
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
  pdf: PdfDoc;
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
      className="group relative mx-auto w-fit cursor-pointer"
    >
      <div
        className={cn(
          "overflow-hidden rounded-md bg-white ring-1 transition-all",
          active
            ? "shadow-md ring-2 ring-blue-500"
            : "shadow-sm ring-border/70 group-hover:shadow-md group-hover:ring-foreground/25",
        )}
      >
        <canvas ref={canvasRef} className="block" style={{ width }} />
      </div>
      <span
        className={cn(
          "pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums shadow-sm ring-1",
          active
            ? "bg-blue-500 text-white ring-blue-600/30"
            : "bg-background/85 text-foreground/70 ring-black/5 backdrop-blur-sm",
        )}
      >
        {pageIndex + 1}
      </span>
    </div>
  );
}

function FolderTreeNode({ node, depth }: { node: FolderNode; depth: number }) {
  const app = useApp();
  const [open, setOpen] = useState(depth < 2);
  const pad = 6 + depth * 12;

  if (node.kind === "dir") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ paddingLeft: pad }}
          className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        {open &&
          (node.children ?? []).map((c) => (
            <FolderTreeNode key={c.path} node={c} depth={depth + 1} />
          ))}
      </div>
    );
  }

  // A folder file that is currently open is highlighted; the active one gets
  // the accent bar too.
  const openDoc = app.recentFiles.find((r) => r.open && r.name === node.name);
  const isActive = !!openDoc && openDoc.id === app.activeTabId;

  return (
    <button
      onClick={() => {
        if (openDoc) app.openRecent(openDoc.id);
        else void app.openTreeFile(node);
        if (app.isMobile) app.setSidebarOpen(false);
      }}
      title={node.name}
      style={{ paddingLeft: pad + 18 }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md border-l-2 py-1 pr-2 text-left text-xs transition-colors",
        isActive
          ? "border-primary bg-sidebar-accent font-medium text-foreground"
          : openDoc
            ? "border-transparent text-foreground hover:bg-sidebar-accent"
            : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent",
      )}
    >
      <FileText
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          openDoc ? "text-foreground" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {openDoc && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
          title="Open"
        />
      )}
    </button>
  );
}

function OutlinePanel({ pdf }: { pdf: PdfDoc }) {
  const app = useApp();
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [draft, setDraft] = useState<OutlineInput[] | null>(null); // non-null = editing

  useEffect(() => {
    let alive = true;
    setOutline(null);
    setDraft(null);
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

  const startEdit = () =>
    setDraft(structuredClone(outline) as unknown as OutlineInput[]);

  const save = () => {
    if (!draft) return;
    void app
      .applyBytesOp(async (b) => {
        const { setOutline: writeOutline } = await import("../../lib/pdftools");
        return writeOutline(b, draft);
      }, "Outline updated")
      .then(() => setDraft(null));
  };

  if (draft) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-3 pb-1 pt-2">
          <span className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Editing outline
          </span>
          <button
            onClick={() =>
              setDraft((d) => [
                ...(d ?? []),
                { title: `Page ${app.currentPage + 1}`, pageIndex: app.currentPage, children: [] },
              ])
            }
            title="Add an entry for the current page"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {draft.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              No entries. Use + above to add one for the current page.
            </p>
          ) : (
            <OutlineEditorTree nodes={draft} depth={0} onChange={(n) => setDraft(n)} />
          )}
        </div>
        <div className="flex items-center gap-1.5 border-t border-sidebar-border px-3 py-2">
          <button
            onClick={save}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Save outline
          </button>
          <button
            onClick={() => setDraft(null)}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1" />
        <button
          onClick={startEdit}
          title="Edit outline (add / rename / remove entries)"
          className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
      </div>
      {!outline.length ? (
        <p className="px-4 py-1 text-xs text-muted-foreground">
          This document has no outline. Use Edit to create one.
        </p>
      ) : (
        <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <OutlineTree
            nodes={outline}
            depth={0}
            onGoto={(p) => {
              app.scrollToPage(p);
              if (app.isMobile) app.setSidebarOpen(false);
            }}
          />
        </div>
      )}
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

/** Recursive outline editor: rename inline, add child, move up/down, delete. */
function OutlineEditorTree({
  nodes,
  depth,
  onChange,
}: {
  nodes: OutlineInput[];
  depth: number;
  onChange: (next: OutlineInput[]) => void;
}) {
  const app = useApp();
  const patch = (i: number, node: OutlineInput | null) => {
    const next = [...nodes];
    if (node === null) next.splice(i, 1);
    else next[i] = node;
    onChange(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return;
    const next = [...nodes];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const btn =
    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex flex-col">
      {nodes.map((n, i) => (
        <div key={i}>
          <div
            className="group flex items-center gap-0.5 rounded py-0.5 pr-1 hover:bg-sidebar-accent/50"
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            <input
              value={n.title}
              onChange={(e) => patch(i, { ...n, title: e.target.value })}
              className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs text-sidebar-foreground focus:border-input focus:bg-background focus:outline-none"
            />
            <button
              className={cn(btn, "text-[9px] font-semibold tabular-nums")}
              title={
                n.pageIndex === null
                  ? "No target page — click to set to the current page"
                  : `Goes to page ${n.pageIndex + 1} — click to retarget to the current page`
              }
              onClick={() => patch(i, { ...n, pageIndex: app.currentPage })}
            >
              {n.pageIndex === null ? "—" : `p${n.pageIndex + 1}`}
            </button>
            <div className="hidden shrink-0 items-center group-hover:flex">
              <button className={btn} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                className={btn}
                title="Move down"
                disabled={i === nodes.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                className={btn}
                title="Add sub-entry (targets the current page)"
                onClick={() =>
                  patch(i, {
                    ...n,
                    children: [
                      ...n.children,
                      {
                        title: `Page ${app.currentPage + 1}`,
                        pageIndex: app.currentPage,
                        children: [],
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                className={btn}
                title="Remove (children too)"
                onClick={() => patch(i, null)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </div>
          </div>
          {n.children.length > 0 && (
            <OutlineEditorTree
              nodes={n.children}
              depth={depth + 1}
              onChange={(kids) => patch(i, { ...n, children: kids })}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** View / add / remove / save the document's embedded files. */
function AttachmentsPanel() {
  const app = useApp();
  const [list, setList] = useState<AttachmentInfo[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bytes = app.docBytes;

  useEffect(() => {
    let alive = true;
    setList(null);
    if (!bytes) return;
    void import("../../lib/pdfium")
      .then((m) => m.listAttachments(bytes))
      .then((l) => {
        // The PickPDF-lock payload is machinery, not a user attachment.
        if (alive) setList(l.filter((a) => a.name !== "pickpdf-protected.bin"));
      })
      .catch(() => {
        if (alive) setList([]);
      });
    return () => {
      alive = false;
    };
  }, [bytes, app.docVersion]);

  const download = async (att: AttachmentInfo) => {
    if (!bytes) return;
    try {
      const { getAttachmentData } = await import("../../lib/pdfium");
      const data = await getAttachmentData(bytes, att.index);
      const url = URL.createObjectURL(new Blob([data as BlobPart]));
      const a = document.createElement("a");
      a.href = url;
      a.download = att.name || "attachment";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(
        `Could not read attachment: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  };

  const add = async (f: File) => {
    const data = new Uint8Array(await f.arrayBuffer());
    void app.applyBytesOp(async (b) => {
      const { addAttachment } = await import("../../lib/pdfium");
      return addAttachment(b, f.name, data);
    }, `Attached ${f.name}`);
  };

  const remove = (att: AttachmentInfo) => {
    void app.applyBytesOp(async (b) => {
      const { removeAttachment } = await import("../../lib/pdfium");
      return removeAttachment(b, att.index);
    }, `Removed ${att.name}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Attached files
        </span>
        <button
          onClick={() => fileRef.current?.click()}
          title="Attach a file to this document"
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void add(f);
          }}
        />
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {list === null ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">
            No embedded files. Use + above to attach one — it travels inside the
            saved PDF.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {list.map((att) => (
              <div
                key={att.index}
                className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-sidebar-accent"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={att.name}>
                  {att.name || "(unnamed)"}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
                  {formatBytes(att.size)}
                </span>
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Save file"
                    onClick={() => void download(att)}
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                    title="Remove attachment"
                    onClick={() => remove(att)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

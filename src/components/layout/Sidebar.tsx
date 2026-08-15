import { Fragment, memo, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns2,
  Download,
  Eye,
  EyeOff,
  Files,
  FileText,
  Folder,
  FolderOpen,
  FormInput,
  History,
  Layers,
  Layers2,
  Lock,
  LockOpen,
  Loader2,
  MessageSquare,
  MoreVertical,
  Paperclip,
  PanelLeft,
  Pencil,
  Plus,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { PdfDoc } from "../../lib/pdf";
import { useAppSelector, shallowEqual, type RecentFile } from "../../store";
import { cn, formatBytes } from "../../lib/utils";
import { renderPageToCanvas, getOutline } from "../../lib/pdf";
import type { OutlineInput } from "../../lib/pdftools";
import type { AttachmentInfo } from "../../lib/pdfium";
import type { LayerInfo } from "../../lib/ocg";
import type { SignatureInfo } from "../../lib/signatures";
import type { Annotation, FolderNode, NoteAnnotation, OutlineNode } from "../../types";
import { FormBuilderSidebar } from "../form/FormBuilderPanel";
import { Button } from "../ui/button";
import { EmptyStateMessage } from "../ui/empty-state-message";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Tip } from "../ui/tooltip";
import { TOOL_SIDEBAR_CONTENT_ID } from "../tools/ToolFileSidebar";
import {
  CURRENT_PDF_TOOLS,
  GENERAL_TOOLS,
  type ToolScreen,
} from "../tools/toolRegistry";
import { ActivityBar, type ActivityBarItem } from "./ActivityBar";

type SidebarTab =
  | "pages"
  | "outline"
  | "comments"
  | "attachments"
  | "signatures"
  | "layers"
  | "objects"
  | "form"
  | "tools"
  | "recent";

type ToolSidebarTab = "files" | "tools";

const SIDEBAR_ACTIVITIES = [
  { key: "recent", label: "Recent", icon: History },
  { key: "pages", label: "Pages & outline", icon: Files },
  { key: "comments", label: "Comments", icon: MessageSquare },
  { key: "attachments", label: "Attachments & signatures", icon: Paperclip },
  { key: "layers", label: "Layers & objects", icon: Layers },
  { key: "form", label: "Form builder", icon: FormInput },
  { key: "tools", label: "Tools", icon: Wrench },
] satisfies readonly ActivityBarItem<SidebarTab>[];

const TOOL_SIDEBAR_ACTIVITIES = [
  { key: "files", label: "Files", icon: Files },
  { key: "tools", label: "Tools", icon: Wrench },
] satisfies readonly ActivityBarItem<ToolSidebarTab>[];

// Memoized: no props, so parent (Shell) re-renders don't touch it; it and its
// panels track their own store slices via useAppSelector.
export const Sidebar = memo(SidebarImpl);

function SidebarImpl() {
  const app = useAppSelector(
    (s) => ({
      formBuilder: s.formBuilder,
      pdf: s.pdf,
      screen: s.screen,
      sidebarOpen: s.sidebarOpen,
      setFormBuilder: s.setFormBuilder,
      setScreen: s.setScreen,
      setSidebarOpen: s.setSidebarOpen,
    }),
    shallowEqual,
  );
  const [tab, setTab] = useState<SidebarTab>("recent");
  const [pagePanelTab, setPagePanelTab] = useState<"pages" | "outline">("pages");
  const [documentPanelTab, setDocumentPanelTab] = useState<
    "attachments" | "signatures"
  >("attachments");
  const [contentPanelTab, setContentPanelTab] = useState<"layers" | "objects">(
    "objects",
  );
  const [toolTab, setToolTab] = useState<ToolSidebarTab>("files");

  // Entering the form builder brings its palette into view; leaving it
  // (via Done) returns to the Recent list by default.
  useEffect(() => {
    setTab((t) => (app.formBuilder ? "form" : t === "form" ? "recent" : t));
    if (app.formBuilder) app.setSidebarOpen(true);
  }, [app.formBuilder, app.setSidebarOpen]);

  useEffect(() => {
    const openPanel = (event: Event) => {
      const panel = (event as CustomEvent<{ panel?: SidebarTab }>).detail?.panel;
      if (
        panel !== "pages" &&
        panel !== "outline" &&
        panel !== "comments" &&
        panel !== "attachments" &&
        panel !== "signatures" &&
        panel !== "layers" &&
        panel !== "objects" &&
        panel !== "form" &&
        panel !== "tools"
      ) {
        return;
      }

      setTab(panel);
      if (panel === "pages" || panel === "outline") setPagePanelTab(panel);
      if (panel === "attachments" || panel === "signatures") {
        setDocumentPanelTab(panel);
      }
      if (panel === "layers" || panel === "objects") setContentPanelTab(panel);
      app.setSidebarOpen(true);
      if (panel === "form") {
        if (!app.formBuilder) app.setFormBuilder(true);
      } else if (app.formBuilder) {
        app.setFormBuilder(false);
      }
    };

    window.addEventListener("pdfwb:open-sidebar-panel", openPanel);
    return () => window.removeEventListener("pdfwb:open-sidebar-panel", openPanel);
  }, [app.formBuilder, app.setFormBuilder, app.setSidebarOpen]);

  // Pages/Outline only apply to an open document; fall back to Recent otherwise.
  const activeTab = app.pdf || tab === "tools" ? tab : "recent";
  const activeActivityTab =
    activeTab === "outline"
      ? "pages"
      : activeTab === "signatures"
        ? "attachments"
        : activeTab === "objects"
          ? "layers"
          : activeTab;
  const hasToolSidebar = app.screen === "merge" || app.screen === "createimages";
  const activities = SIDEBAR_ACTIVITIES.map((item) => ({
    ...item,
    disabled: item.key !== "recent" && item.key !== "tools" && !app.pdf,
  }));
  const activeLabel =
    SIDEBAR_ACTIVITIES.find((item) => item.key === activeTab)?.label ?? "Recent";

  const selectActivity = (next: SidebarTab) => {
    if (next === activeActivityTab && app.sidebarOpen) {
      app.setSidebarOpen(false);
      return;
    }
    setTab(
      next === "pages"
        ? pagePanelTab
        : next === "attachments"
          ? documentPanelTab
          : next === "layers"
            ? contentPanelTab
            : next,
    );
    app.setSidebarOpen(true);
    if (next === "form") {
      if (!app.formBuilder) app.setFormBuilder(true);
    } else if (app.formBuilder) {
      app.setFormBuilder(false);
    }
  };

  const selectToolActivity = (next: ToolSidebarTab) => {
    if (next === toolTab && app.sidebarOpen) {
      app.setSidebarOpen(false);
      return;
    }
    setToolTab(next);
    app.setSidebarOpen(true);
  };

  const openTool = (screen: ToolScreen) => {
    setTab("tools");
    setToolTab(screen === "merge" || screen === "createimages" ? "files" : "tools");
    app.setScreen(screen);
  };

  const sidebarToggle = (
    <Tip label={app.sidebarOpen ? "Hide sidebar" : "Show sidebar"} side="right">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={app.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={() => app.setSidebarOpen(!app.sidebarOpen)}
      >
        <PanelLeft className="h-[18px] w-[18px]" />
      </Button>
    </Tip>
  );

  return (
    <aside
      className={cn(
        // Mobile: fixed slide-over drawer below the title bar.
        "fixed bottom-0 left-0 top-[42px] z-50 flex w-[280px] max-w-[85vw] overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200 ease-out",
        // Desktop: the activity rail remains visible when its panel is closed.
        "lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:border-r-0 lg:shadow-none",
        app.sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}
    >
      {hasToolSidebar ? (
        <ActivityBar
          items={TOOL_SIDEBAR_ACTIVITIES}
          activeItem={toolTab}
          panelOpen={app.sidebarOpen}
          onSelect={selectToolActivity}
          footer={sidebarToggle}
        />
      ) : (
        <ActivityBar
          items={activities}
          activeItem={activeActivityTab}
          panelOpen={app.sidebarOpen}
          onSelect={selectActivity}
          footer={sidebarToggle}
        />
      )}

      <div
        aria-hidden={!app.sidebarOpen}
        className={cn(
          "min-w-0 overflow-hidden transition-[width,opacity] duration-200 ease-out",
          app.sidebarOpen
            ? "w-[232px] opacity-100 lg:w-[240px]"
            : "pointer-events-none invisible w-0 opacity-0",
        )}
      >
        <div className="flex h-full w-[232px] min-w-0 flex-col lg:w-[240px]">
          {hasToolSidebar ? (
            toolTab === "tools" ? (
              <>
                <SidebarPanelHeader>Tools</SidebarPanelHeader>
                <ToolsPanel onSelectScreen={openTool} />
              </>
            ) : (
              <div
                id={TOOL_SIDEBAR_CONTENT_ID}
                data-testid={TOOL_SIDEBAR_CONTENT_ID}
                className="flex min-h-0 flex-1 flex-col"
              />
            )
          ) : (
            app.pdf && (activeTab === "pages" || activeTab === "outline") ? (
              <PageOutlinePanel
                pdf={app.pdf}
                value={activeTab}
                onChange={(next) => {
                  setPagePanelTab(next);
                  setTab(next);
                }}
              />
            ) : app.pdf &&
              (activeTab === "attachments" || activeTab === "signatures") ? (
              <SidebarTabsPanel
                ariaLabel="Document data"
                value={activeTab}
                onChange={(next) => {
                  setDocumentPanelTab(next);
                  setTab(next);
                }}
                tabs={[
                  {
                    value: "attachments",
                    label: "Attachments",
                    content: <AttachmentsPanel />,
                  },
                  {
                    value: "signatures",
                    label: "Signatures",
                    content: <SignaturesPanel />,
                  },
                ]}
              />
            ) : app.pdf && (activeTab === "layers" || activeTab === "objects") ? (
              <SidebarTabsPanel
                ariaLabel="Document content"
                value={activeTab}
                onChange={(next) => {
                  setContentPanelTab(next);
                  setTab(next);
                }}
                tabs={[
                  {
                    value: "objects",
                    label: "Objects",
                    content: <ObjectsPanel />,
                  },
                  {
                    value: "layers",
                    label: "Layers",
                    content: <LayersPanel />,
                  },
                ]}
              />
            ) : (
              <>
                <SidebarPanelHeader>{activeLabel}</SidebarPanelHeader>
                {activeTab === "tools" ? (
                  <ToolsPanel onSelectScreen={openTool} />
                ) : app.pdf && activeTab === "comments" ? (
                  <CommentsPanel />
                ) : app.pdf && activeTab === "form" ? (
                  <FormBuilderSidebar />
                ) : (
                  <RecentList />
                )}
              </>
            )
          )}
        </div>
      </div>
    </aside>
  );
}

function SidebarPanelHeader({ children }: { children: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-sidebar-border px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function PageOutlinePanel({
  onChange,
  pdf,
  value,
}: {
  onChange: (value: "pages" | "outline") => void;
  pdf: PdfDoc;
  value: "pages" | "outline";
}) {
  return (
    <SidebarTabsPanel
      ariaLabel="Document navigation"
      value={value}
      onChange={onChange}
      tabs={[
        { value: "pages", label: "Pages", content: <ThumbnailList /> },
        { value: "outline", label: "Outline", content: <OutlinePanel pdf={pdf} /> },
      ]}
    />
  );
}

function SidebarTabsPanel<Value extends string>({
  ariaLabel,
  onChange,
  tabs,
  value,
}: {
  ariaLabel: string;
  onChange: (value: Value) => void;
  tabs: ReadonlyArray<{
    content: React.ReactNode;
    label: string;
    value: Value;
  }>;
  value: Value;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const selected = tabs.find((tab) => tab.value === next);
        if (selected) onChange(selected.value);
      }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <TabsList
        aria-label={ariaLabel}
        className="mx-2 mt-1 h-8 w-fit shrink-0 justify-start bg-sidebar-foreground/[0.055]"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="h-6 min-w-0 flex-none px-2.5 py-0 text-[11px] focus-visible:ring-[#ff5a52]/35 data-[active]:bg-sidebar data-[active]:text-[#df4942] dark:data-[active]:text-[#ff746d]"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function ToolsPanel({
  onSelectScreen,
}: {
  onSelectScreen: (screen: ToolScreen) => void;
}) {
  const app = useAppSelector(
    (s) => ({
      applyBytesOp: s.applyBytesOp,
      isMobile: s.isMobile,
      ocrBusy: s.ocrBusy,
      pdf: s.pdf,
      requestConfirm: s.requestConfirm,
      runOcrText: s.runOcrText,
      setSidebarOpen: s.setSidebarOpen,
    }),
    shallowEqual,
  );

  const flattenDocument = async () => {
    if (!app.pdf) return;
    const ok = await app.requestConfirm({
      title: "Flatten the document?",
      message:
        "All annotations and form fields are baked permanently into the page content and stop being editable or fillable. This cannot be undone after saving.",
      confirmLabel: "Flatten",
    });
    if (!ok) return;
    await app.applyBytesOp(async (bytes) => {
      const { flattenPdf } = await import("../../lib/pdfium");
      return flattenPdf(bytes);
    }, "Document flattened");
  };

  const selectScreen = (screen: ToolScreen) => {
    onSelectScreen(screen);
    if (app.isMobile) app.setSidebarOpen(false);
  };

  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto p-2">
      <ToolTileGroup label="Current PDF">
        {CURRENT_PDF_TOOLS.map((tool) => (
          <ToolTile
            key={tool.screen}
            icon={tool.icon}
            title={tool.title}
            description={tool.description}
            onClick={() => selectScreen(tool.screen)}
          />
        ))}
        <ToolTile
          icon={ScanText}
          title="Make searchable"
          description="Add a searchable text layer to scanned pages."
          disabled={!app.pdf || app.ocrBusy}
          onClick={() => void app.runOcrText()}
        />
        <ToolTile
          icon={Layers2}
          title="Flatten document"
          description="Bake annotations and form fields into page content."
          disabled={!app.pdf}
          onClick={() => void flattenDocument()}
        />
      </ToolTileGroup>

      <ToolTileGroup label="General tools">
        {GENERAL_TOOLS.map((tool) => (
          <ToolTile
            key={tool.screen}
            icon={tool.icon}
            title={tool.title}
            description={tool.description}
            onClick={() => selectScreen(tool.screen)}
          />
        ))}
      </ToolTileGroup>
    </div>
  );
}

function ToolTileGroup({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="pb-3 last:pb-0">
      <h3 className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function ToolTile({
  description,
  disabled = false,
  icon: Icon,
  onClick,
  title,
}: {
  description: string;
  disabled?: boolean;
  icon: LucideIcon;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg border border-sidebar-border bg-background p-2.5 text-left shadow-sm transition-colors hover:border-foreground/30 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-sidebar-border disabled:hover:bg-background"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium leading-tight text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

/** All note annotations across pages, with click-to-jump. */
function CommentsPanel() {
  const app = useAppSelector(
    (s) => ({ annotations: s.annotations, scrollToPage: s.scrollToPage, setSelected: s.setSelected, isMobile: s.isMobile, setSidebarOpen: s.setSidebarOpen }),
    shallowEqual,
  );
  const notes: Array<{ page: number; ann: NoteAnnotation }> = [];
  for (const [p, list] of Object.entries(app.annotations)) {
    for (const a of list) {
      if (a.kind === "note") notes.push({ page: Number(p), ann: a });
    }
  }
  notes.sort((a, b) => a.page - b.page || a.ann.y - b.ann.y);

  if (!notes.length) {
    return (
      <EmptyStateMessage
        icon={MessageSquare}
        title="No comments yet"
        description="Use the Comment tool in Edit mode to add notes to this document."
      />
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

const OBJECT_KIND_LABEL: Record<Annotation["kind"], string> = {
  text: "Text",
  highlight: "Highlight",
  markup: "Text markup",
  note: "Comment",
  whiteout: "Whiteout",
  redact: "Redaction",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  polygon: "Polygon",
  polyline: "Polyline",
  measure: "Measurement",
  ink: "Drawing",
  image: "Image",
  mark: "Mark",
  link: "Link",
  formfield: "Form field",
};

export function annotationObjectLabel(ann: Annotation): string {
  const detail =
    ann.kind === "text" || ann.kind === "note"
      ? ann.text.trim()
      : ann.kind === "formfield"
        ? ann.fieldName
        : ann.kind === "link"
          ? ann.value
          : ann.kind === "mark"
            ? ann.symbol === "check"
              ? "Check mark"
              : "Cross mark"
            : "";
  return detail || OBJECT_KIND_LABEL[ann.kind];
}

export function annotationObjectSecondaryLabel(
  label: string,
  kind: string,
  locked = false,
): string | null {
  if (label.trim().toLocaleLowerCase() === kind.trim().toLocaleLowerCase()) {
    return null;
  }
  return `${kind}${locked ? " · Locked" : ""}`;
}

export function collectAnnotationObjects(
  annotations: Record<number, Annotation[]> | Record<string, Annotation[]>,
): Array<{ page: number; ann: Annotation }> {
  return Object.entries(annotations)
    .flatMap(([page, list]) =>
      list.map((ann) => ({ page: Number(page), ann })),
    )
    .sort(
      (a, b) =>
        a.page - b.page ||
        a.ann.y - b.ann.y ||
        a.ann.x - b.ann.x ||
        a.ann.id.localeCompare(b.ann.id),
    );
}

export function groupAnnotationObjectsByPage(
  objects: Array<{ page: number; ann: Annotation }>,
): Array<{ page: number; objects: Annotation[] }> {
  const groups: Array<{ page: number; objects: Annotation[] }> = [];
  for (const { page, ann } of objects) {
    const current = groups[groups.length - 1];
    if (!current || current.page !== page) {
      groups.push({ page, objects: [ann] });
    } else {
      current.objects.push(ann);
    }
  }
  return groups;
}

/** User-added page elements. Locked rows remain selectable here so they can
 * be inspected or unlocked even though canvas clicks intentionally pass through. */
function ObjectsPanel() {
  const app = useAppSelector(
    (s) => ({
      annotations: s.annotations,
      selected: s.selected,
      currentPage: s.currentPage,
      scrollToPage: s.scrollToPage,
      setSelected: s.setSelected,
      setMultiSelected: s.setMultiSelected,
      updateAnnotation: s.updateAnnotation,
      isMobile: s.isMobile,
      setSidebarOpen: s.setSidebarOpen,
    }),
    shallowEqual,
  );
  const objects = collectAnnotationObjects(app.annotations);
  const pageGroups = groupAnnotationObjectsByPage(objects);
  const [collapsedPages, setCollapsedPages] = useState<Set<number>>(
    () => new Set(),
  );

  if (!objects.length) {
    return (
      <EmptyStateMessage
        icon={Layers2}
        title="No objects yet"
        description="Text, images, shapes, and other added elements will appear here."
      />
    );
  }

  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{objects.length} object{objects.length === 1 ? "" : "s"}</span>
        <span>Lock to protect</span>
      </div>
      <div className="flex flex-col gap-1">
        {pageGroups.map(({ page, objects: pageObjects }) => {
          const collapsed = collapsedPages.has(page);
          const contentId = `objects-page-${page + 1}`;
          return (
            <section key={page} className="first:[&>button]:mt-0">
              <button
                type="button"
                aria-controls={contentId}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} page ${page + 1} objects`}
                className="mt-1 flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                onClick={() => {
                  setCollapsedPages((current) => {
                    const next = new Set(current);
                    if (next.has(page)) next.delete(page);
                    else next.add(page);
                    return next;
                  });
                }}
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  Page {page + 1}
                  {page === app.currentPage ? " · Current" : ""}
                </span>
                <span className="shrink-0 font-normal normal-case">
                  {pageObjects.length}
                </span>
              </button>
              {!collapsed && (
                <div id={contentId} className="flex flex-col gap-1">
                  {pageObjects.map((ann) => {
                    const selected =
                      app.selected?.page === page && app.selected.id === ann.id;
                    const label = annotationObjectLabel(ann);
                    const kind = OBJECT_KIND_LABEL[ann.kind];
                    const secondaryLabel = annotationObjectSecondaryLabel(
                      label,
                      kind,
                      ann.locked,
                    );
                    return (
                      <div
                        key={`${page}:${ann.id}`}
                        className={cn(
                          "group flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
                          selected
                            ? "border-primary/50 bg-primary/10"
                            : "border-transparent hover:border-sidebar-border hover:bg-accent/60",
                          ann.locked && "bg-muted/40",
                        )}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          aria-label={`Select ${kind}: ${label}`}
                          onClick={() => {
                            app.scrollToPage(page);
                            app.setMultiSelected(null);
                            app.setSelected({ page, id: ann.id });
                            if (app.isMobile) app.setSidebarOpen(false);
                          }}
                        >
                          <span className="block truncate text-xs font-medium">
                            {label}
                          </span>
                          {secondaryLabel && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {secondaryLabel}
                            </span>
                          )}
                        </button>
                        <Tip label={ann.locked ? "Unlock object" : "Lock object"}>
                          <button
                            type="button"
                            aria-label={`${ann.locked ? "Unlock" : "Lock"} ${label}`}
                            aria-pressed={!!ann.locked}
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                              ann.locked
                                ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
                                : "text-muted-foreground opacity-70 hover:bg-background hover:text-foreground group-hover:opacity-100",
                            )}
                            onClick={() => {
                              app.updateAnnotation(page, {
                                ...ann,
                                locked: ann.locked ? undefined : true,
                              });
                              app.setMultiSelected(null);
                              app.setSelected({ page, id: ann.id });
                            }}
                          >
                            {ann.locked ? (
                              <Lock className="h-3.5 w-3.5" />
                            ) : (
                              <LockOpen className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </Tip>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
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
  const app = useAppSelector(
    (s) => ({ folderRoot: s.folderRoot, recentFiles: s.recentFiles, requestOpen: s.requestOpen, openFolder: s.openFolder, folderBusy: s.folderBusy, recentLoading: s.recentLoading, clearRecent: s.clearRecent, closeAllTabs: s.closeAllTabs }),
    shallowEqual,
  );
  // Files that live in the opened folder tree are shown there, not in the
  // flat Open/Recently-closed lists.
  const folderNames = collectFileNames(app.folderRoot);
  const openDocs = app.recentFiles.filter(
    (r) => r.open && !folderNames.has(r.name),
  );
  const closedDocs = app.recentFiles.filter(
    (r) => !r.open && !folderNames.has(r.name),
  );
  const [openExpanded, setOpenExpanded] = useState(true);
  const [closedExpanded, setClosedExpanded] = useState(true);
  const hasOpenDocs = app.recentFiles.some((r) => r.open);

  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <div className="flex items-center justify-between pb-0.5 pr-0.5">
        <SectionToggle
          expanded={openExpanded}
          count={app.recentFiles.filter((r) => r.open).length}
          onToggle={() => setOpenExpanded((expanded) => !expanded)}
        >
          Open
        </SectionToggle>
        <div className="flex items-center gap-0.5">
          <Tip label="Open a PDF">
            <button
              aria-label="Open a PDF"
              onClick={() => void app.requestOpen()}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Tip>
          <Tip label="Open a folder of PDFs">
            <button
              aria-label="Open a folder of PDFs"
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
          </Tip>
          {hasOpenDocs && (
            <Menu>
              <Tip label="More open document actions">
                <MenuTrigger
                  aria-label="More open document actions"
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </MenuTrigger>
              </Tip>
              <MenuContent align="end" className="min-w-40">
                <MenuItem onClick={() => app.closeAllTabs()}>
                  <X className="h-4 w-4" />
                  Close all
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>

      {openExpanded && (
        <>
          {app.folderRoot && <FolderSection root={app.folderRoot} />}
          {app.recentLoading ? (
            <RecentListSkeleton />
          ) : (
            <>
              {openDocs.length > 0 && (
                <div className="flex flex-col gap-0.5 pb-1">
                  {openDocs.map((r) => (
                    <RecentRow key={r.id} r={r} />
                  ))}
                </div>
              )}

              {!openDocs.length && !app.folderRoot && (
                <p className="px-2 pb-2 text-[11px] text-muted-foreground">
                  No document open. Use + to open a file or the folder icon to browse
                  a folder.
                </p>
              )}
            </>
          )}
        </>
      )}

      {!app.recentLoading && closedDocs.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center justify-between pr-1">
            <SectionToggle
              expanded={closedExpanded}
              count={closedDocs.length}
              onToggle={() => setClosedExpanded((expanded) => !expanded)}
            >
              Recently closed
            </SectionToggle>
            <Tip label="Clear all" side="top">
              <button
                type="button"
                aria-label="Clear all recently closed items"
                onClick={() => void app.clearRecent()}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Tip>
          </div>
          {closedExpanded && (
            <div className="flex flex-col gap-0.5">
              {closedDocs.map((r) => (
                <RecentRow key={r.id} r={r} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Placeholder rows shown while the recent-files list loads on startup. */
function RecentListSkeleton() {
  return (
    <div className="flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${70 - i * 8}%` }} />
        </div>
      ))}
    </div>
  );
}

function FolderSection({ root }: { root: FolderNode }) {
  const app = useAppSelector(
    (s) => ({ openFolder: s.openFolder, closeFolder: s.closeFolder }),
    shallowEqual,
  );
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
          <Tip label={root.name}>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{root.name}</span>
          </Tip>
        </button>
        <Tip label="Open another folder">
          <button
            onClick={() => void app.openFolder()}
            aria-label="Open another folder"
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100"
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        </Tip>
        <Tip label="Close folder">
          <button
            onClick={() => app.closeFolder()}
            aria-label="Close folder"
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </Tip>
      </div>
      {open &&
        (root.children ?? []).map((n) => (
          <FolderTreeNode key={n.path} node={n} depth={1} />
        ))}
    </div>
  );
}

function RecentRow({ r }: { r: RecentFile }) {
  const app = useAppSelector(
    (s) => ({ activeTabId: s.activeTabId, tabs: s.tabs, openRecent: s.openRecent, removeRecent: s.removeRecent, isMobile: s.isMobile, setSidebarOpen: s.setSidebarOpen, openInPane: s.openInPane, closeTab: s.closeTab }),
    shallowEqual,
  );
  const isActive = r.id === app.activeTabId;
  // "Loaded" = actually in memory (a live tab). An open doc that isn't loaded
  // is one restored from last session but not yet activated — it loads on click.
  const isLoaded = app.tabs.some((t) => t.id === r.id);
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
      <Tip label={r.name}>
        <span className="min-w-0 flex-1 truncate">{r.name}</span>
      </Tip>
      {r.open ? (
        <>
          <Tip
            label={
              !isLoaded
                ? "Open — click to load"
                : hasEdits
                  ? "Unsaved edits"
                  : "Currently open"
            }
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full group-hover:hidden",
                !isLoaded
                  ? "border border-muted-foreground/50"
                  : hasEdits
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
            />
          </Tip>
          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            {isLoaded && (
              <Tip label="Open in a split pane">
                <button
                  className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Open in a split pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    app.openInPane(r.id);
                  }}
                >
                  <Columns2 className="h-3 w-3" />
                </button>
              </Tip>
            )}
            <Tip label="Close document">
              <button
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close document"
                onClick={(e) => {
                  e.stopPropagation();
                  app.closeTab(r.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Tip>
          </div>
        </>
      ) : (
        <>
          <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden group-focus-within:hidden">
            {timeAgo(r.lastOpened)}
          </span>
          <Tip label="Remove from recents">
            <button
              type="button"
              aria-label={`Remove ${r.name} from recents`}
              className="hidden shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-hover:block group-focus-within:block"
              onClick={(e) => {
                e.stopPropagation();
                void app.removeRecent(r.id);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </Tip>
        </>
      )}
    </div>
  );
}

function SectionToggle({
  children,
  expanded,
  count,
  onToggle,
}: {
  children: React.ReactNode;
  expanded: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex min-w-0 items-center gap-1 rounded px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">{children}</span>
      <span className="font-normal tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ThumbnailList() {
  const app = useAppSelector(
    (s) => ({ pdf: s.pdf, numPages: s.numPages, docVersion: s.docVersion, currentPage: s.currentPage, setScreen: s.setScreen, scrollToPage: s.scrollToPage, isMobile: s.isMobile, setSidebarOpen: s.setSidebarOpen, applyBytesOp: s.applyBytesOp }),
    shallowEqual,
  );
  if (!app.pdf) return null;

  const insertBlankPageAt = (atIndex: number) => {
    const label =
      atIndex === 0
        ? "Inserted blank page at beginning"
        : atIndex >= app.numPages
          ? "Inserted blank page at end"
          : `Inserted blank page between pages ${atIndex} and ${atIndex + 1}`;
    void app.applyBytesOp(async (bytes) => {
      const { insertBlankPage } = await import("../../lib/pdftools");
      return insertBlankPage(bytes, atIndex);
    }, label);
  };

  return (
    <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div className="flex flex-col gap-2">
        <PageInsertSlot
          label="Insert blank page at beginning"
          onClick={() => insertBlankPageAt(0)}
        />
        {Array.from({ length: app.numPages }, (_, i) => (
          <Fragment key={`${app.docVersion}-${i}`}>
            <Thumbnail
              pdf={app.pdf!}
              pageIndex={i}
              active={app.currentPage === i}
              onClick={() => {
                app.setScreen("viewer");
                app.scrollToPage(i);
                if (app.isMobile) app.setSidebarOpen(false);
              }}
            />
            <PageInsertSlot
              label={
                i === app.numPages - 1
                  ? "Insert blank page at end"
                  : `Insert blank page between pages ${i + 1} and ${i + 2}`
              }
              onClick={() => insertBlankPageAt(i + 1)}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PageInsertSlot({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="group mx-auto flex w-[150px] items-center gap-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="h-px flex-1 bg-sidebar-border transition-colors group-hover:bg-primary/50" />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar shadow-sm transition-colors group-hover:border-primary/60 group-hover:bg-background">
          <Plus className="h-3 w-3" />
        </span>
        <span className="h-px flex-1 bg-sidebar-border transition-colors group-hover:bg-primary/50" />
      </button>
    </Tip>
  );
}

type ThumbnailVisibilityCallback = () => void;
const thumbnailVisibilityCallbacks = new WeakMap<Element, ThumbnailVisibilityCallback>();
let sharedThumbnailObserver: IntersectionObserver | null = null;

function observeThumbnail(element: Element, callback: ThumbnailVisibilityCallback) {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => {};
  }
  if (!sharedThumbnailObserver) {
    sharedThumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const visible = thumbnailVisibilityCallbacks.get(entry.target);
          sharedThumbnailObserver?.unobserve(entry.target);
          thumbnailVisibilityCallbacks.delete(entry.target);
          visible?.();
        }
      },
      { rootMargin: "300px" },
    );
  }
  thumbnailVisibilityCallbacks.set(element, callback);
  sharedThumbnailObserver.observe(element);
  return () => {
    sharedThumbnailObserver?.unobserve(element);
    thumbnailVisibilityCallbacks.delete(element);
  };
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
    let cancelled = false;
    const unobserve = observeThumbnail(el, () => {
      if (rendered.current) return;
      rendered.current = true;
      void (async () => {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        const scale = width / vp.width;
        if (canvasRef.current) {
          await renderPageToCanvas(pdf, pageIndex, canvasRef.current, scale);
        }
      })();
    });
    return () => {
      cancelled = true;
      unobserve();
    };
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
  const app = useAppSelector(
    (s) => ({ recentFiles: s.recentFiles, activeTabId: s.activeTabId, openRecent: s.openRecent, openTreeFile: s.openTreeFile, isMobile: s.isMobile, setSidebarOpen: s.setSidebarOpen }),
    shallowEqual,
  );
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
    <Tip label={node.name} side="right">
      <button
        onClick={() => {
          if (openDoc) app.openRecent(openDoc.id);
          else void app.openTreeFile(node);
          if (app.isMobile) app.setSidebarOpen(false);
        }}
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
        {openDoc && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
      </button>
    </Tip>
  );
}

function OutlinePanel({ pdf }: { pdf: PdfDoc }) {
  const app = useAppSelector(
    (s) => ({ currentPage: s.currentPage, scrollToPage: s.scrollToPage, isMobile: s.isMobile, setSidebarOpen: s.setSidebarOpen, applyBytesOp: s.applyBytesOp }),
    shallowEqual,
  );
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
          <Tip label="Add an entry for the current page">
            <button
              onClick={() =>
                setDraft((d) => [
                  ...(d ?? []),
                  { title: `Page ${app.currentPage + 1}`, pageIndex: app.currentPage, children: [] },
                ])
              }
              aria-label="Add an entry for the current page"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Tip>
        </div>
        <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {draft.length === 0 ? (
            <EmptyStateMessage
              className="h-full min-h-32"
              icon={FileText}
              title="No outline entries"
              description="Use + above to add an entry for the current page."
            />
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
        <Tip label="Edit outline" desc="Add, rename, or remove entries">
          <button
            onClick={startEdit}
            aria-label="Edit outline"
            className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </Tip>
      </div>
      {!outline.length ? (
        <EmptyStateMessage
          icon={FileText}
          title="No outline yet"
          description="Use Edit to add navigation entries for this document."
        />
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
          <Tip label={n.title} side="right">
            <button
              disabled={n.pageIndex === null}
              onClick={() => n.pageIndex !== null && onGoto(n.pageIndex)}
              className="w-full truncate rounded px-2 py-1 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-60"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {n.title}
            </button>
          </Tip>
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
  const app = useAppSelector(
    (s) => ({ currentPage: s.currentPage }),
    shallowEqual,
  );
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
            <Tip label="Retarget to the current page">
              <button
                className={cn(btn, "text-[9px] font-semibold tabular-nums")}
                aria-label="Retarget to the current page"
                onClick={() => patch(i, { ...n, pageIndex: app.currentPage })}
              >
                {n.pageIndex === null ? "—" : `p${n.pageIndex + 1}`}
              </button>
            </Tip>
            <div className="hidden shrink-0 items-center group-hover:flex">
              <Tip label="Move up">
                <button className={btn} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></button>
              </Tip>
              <Tip label="Move down">
                <button className={btn} aria-label="Move down" disabled={i === nodes.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></button>
              </Tip>
              <Tip label="Add sub-entry" desc="Targets the current page">
                <button
                  className={btn}
                  aria-label="Add sub-entry"
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
              </Tip>
              <Tip label="Remove" desc="Also removes child entries">
                <button className={btn} aria-label="Remove outline entry" onClick={() => patch(i, null)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </Tip>
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
  const app = useAppSelector(
    (s) => ({ docBytes: s.docBytes, docVersion: s.docVersion, applyBytesOp: s.applyBytesOp }),
    shallowEqual,
  );
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
        <Tip label="Attach a file to this document">
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a file to this document"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tip>
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
          <EmptyStateMessage
            className="h-full"
            icon={Paperclip}
            title="No attachments"
            description="Use + above to embed a file in the saved PDF."
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {list.map((att) => (
              <div
                key={att.index}
                className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-sidebar-accent"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Tip label={att.name || "(unnamed)"}>
                  <span className="min-w-0 flex-1 truncate">{att.name || "(unnamed)"}</span>
                </Tip>
                <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
                  {formatBytes(att.size)}
                </span>
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <Tip label="Save file">
                    <button
                      className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Save file"
                      onClick={() => void download(att)}
                    >
                      <Download className="h-3 w-3" />
                    </button>
                  </Tip>
                  <Tip label="Remove attachment">
                    <button
                      className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                      aria-label="Remove attachment"
                      onClick={() => remove(att)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Tip>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Optional-content groups (OCG layers): list with /Order indentation and
 *  per-layer visibility toggles. Toggling rewrites the catalog's
 *  /OCProperties and reloads the bytes via applyBytesOp — layer visibility
 *  is document state that persists in the saved file (Acrobat does the
 *  same on save), so it participates in undo/edited tracking. */
function LayersPanel() {
  const app = useAppSelector(
    (s) => ({ docBytes: s.docBytes, docVersion: s.docVersion, applyBytesOp: s.applyBytesOp }),
    shallowEqual,
  );
  const [layers, setLayers] = useState<LayerInfo[] | null>(null);
  const bytes = app.docBytes;

  useEffect(() => {
    let alive = true;
    setLayers(null);
    if (!bytes) return;
    void import("../../lib/ocg")
      .then((m) => m.listLayers(bytes))
      .then((l) => {
        if (alive) setLayers(l);
      })
      .catch(() => {
        if (alive) setLayers([]);
      });
    return () => {
      alive = false;
    };
  }, [bytes, app.docVersion]);

  const setVisibility = (ids: string[], visible: boolean, label: string) => {
    void app.applyBytesOp(async (b) => {
      const { setLayerVisibility } = await import("../../lib/ocg");
      return setLayerVisibility(b, ids, visible);
    }, label);
  };

  const allVisible = !!layers?.length && layers.every((l) => l.visible);
  const allHidden = !!layers?.length && layers.every((l) => !l.visible);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Layers
        </span>
        {!!layers?.length && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent"
              disabled={allVisible}
              onClick={() =>
                setVisibility(layers.map((l) => l.id), true, "All layers shown")
              }
            >
              Show all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent"
              disabled={allHidden}
              onClick={() =>
                setVisibility(layers.map((l) => l.id), false, "All layers hidden")
              }
            >
              Hide all
            </Button>
          </>
        )}
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {layers === null ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Loading…</p>
        ) : layers.length === 0 ? (
          <EmptyStateMessage
            className="h-full"
            icon={Layers}
            title="No document layers"
            description="Layers are usually found in CAD exports and print-production PDFs."
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {layers.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-1.5 rounded-md py-0.5 pr-1 text-xs hover:bg-sidebar-accent"
                style={{ paddingLeft: 4 + l.depth * 14 }}
              >
                <Tip label={l.visible ? "Hide layer" : "Show layer"}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`}
                    aria-pressed={l.visible}
                    onClick={() => setVisibility([l.id], !l.visible, "Layer visibility changed")}
                  >
                    {l.visible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </Tip>
                <Tip label={l.name}>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !l.visible && "text-muted-foreground",
                    )}
                  >
                    {l.name}
                  </span>
                </Tip>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Digital (certificate) signatures: per-signature validity, signer and
 *  whether the file changed since signing. Verification runs entirely
 *  locally against the in-memory bytes. */
function SignaturesPanel() {
  const app = useAppSelector(
    (s) => ({
      docBytes: s.docBytes,
      docVersion: s.docVersion,
      setSignModalOpen: s.setSignModalOpen,
    }),
    shallowEqual,
  );
  const [list, setList] = useState<SignatureInfo[] | null>(null);
  const bytes = app.docBytes;

  useEffect(() => {
    let alive = true;
    setList(null);
    if (!bytes) return;
    void import("../../lib/signatures")
      .then((m) => m.verifySignatures(bytes))
      .then((l) => {
        if (alive) setList(l);
      })
      .catch(() => {
        if (alive) setList([]);
      });
    return () => {
      alive = false;
    };
  }, [bytes, app.docVersion]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Digital signatures
        </span>
        <Tip label="Sign with a certificate (.p12/.pfx)">
          <button
            onClick={() => app.setSignModalOpen(true)}
            aria-label="Sign with a certificate (.p12/.pfx)"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {list === null ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Verifying…</p>
        ) : list.length === 0 ? (
          <EmptyStateMessage
            className="h-full"
            icon={ShieldCheck}
            title="No digital signatures"
            description="Use + above to sign with a .p12 or .pfx certificate."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {list.map((sig, i) => (
              <SignatureRow key={`${sig.fieldName}-${i}`} sig={sig} />
            ))}
            <p className="px-2 pt-1 text-[10px] leading-snug text-muted-foreground">
              Verified locally. Signer identity is not checked against a
              trusted-authority store, so treat "who signed" as claimed, not
              proven.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SignatureRow({ sig }: { sig: SignatureInfo }) {
  const revisionNote = sig.status === "valid" && !sig.coversWholeDocument;
  const [Icon, tone, headline] =
    sig.status === "valid"
      ? revisionNote
        ? ([ShieldCheck, "text-amber-500", "Valid — earlier revision"] as const)
        : ([ShieldCheck, "text-green-600", "Valid"] as const)
      : sig.status === "modified"
        ? ([ShieldAlert, "text-destructive", "Document modified"] as const)
        : sig.status === "invalid"
          ? ([ShieldAlert, "text-destructive", "Invalid"] as const)
          : ([ShieldQuestion, "text-amber-500", "Not verifiable"] as const);

  const when = sig.signingTime ? new Date(sig.signingTime).toLocaleString() : null;

  return (
    <div className="rounded-md border border-sidebar-border/60 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", tone)} />
        <Tip label={sig.fieldName}>
          <span className="min-w-0 flex-1 truncate font-medium">
            {sig.signerName ?? "(unknown signer)"}
          </span>
        </Tip>
        <span className={cn("shrink-0 text-[10px] font-medium", tone)}>{headline}</span>
      </div>
      <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
        {sig.statusDetail}
      </p>
      <div className="flex flex-col gap-0.5 pt-1 text-[10px] leading-snug text-muted-foreground">
        {sig.signerOrg && <span>Organization: {sig.signerOrg}</span>}
        {when && <span>Signed: {when}</span>}
        {sig.reason && <span>Reason: {sig.reason}</span>}
        {sig.location && <span>Location: {sig.location}</span>}
        {sig.selfSigned ? (
          <span>Self-signed certificate</span>
        ) : (
          sig.certIssuer && <span>Issued by: {sig.certIssuer}</span>
        )}
        {sig.certOutsideValidity && (
          <span className="text-destructive">
            Certificate was outside its validity period at signing time
          </span>
        )}
        {sig.digestAlgorithm && (
          <span>
            Field: {sig.fieldName} · {sig.digestAlgorithm}
          </span>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FormInput,
  Image as ImageIcon,
  Search,
  Signature,
  Stamp,
  type LucideIcon,
} from "lucide-react";
import { makeStamp, STAMPS } from "../../lib/stamps";
import { cn } from "../../lib/utils";
import { shallowEqual, useAppSelector } from "../../store";
import type { ToolKind } from "../../types";
import { Input } from "../ui/input";
import {
  EDITOR_TOOL_GROUPS,
  EDITOR_TOOLS,
  findEditorTool,
  selectEditorTool,
  type EditorToolDefinition,
  type EditorToolGroupId,
} from "./editorToolRegistry";

type InsertAction = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  aliases?: string[];
  active?: boolean;
  shortcut?: string;
  onSelect: () => void;
};

const DEFAULT_OPEN_GROUPS: Record<EditorToolGroupId | "insert", boolean> = {
  basic: true,
  text: true,
  markup: true,
  shapes: true,
  measure: false,
  cleanup: false,
  insert: true,
};

function matchesSearch(
  item: Pick<EditorToolDefinition, "name" | "description" | "aliases">,
  query: string,
): boolean {
  if (!query) return true;
  return [item.name, item.description, ...(item.aliases ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function ToolRow({
  active,
  description,
  icon: Icon,
  name,
  onSelect,
  shortcut,
}: {
  active?: boolean;
  description: string;
  icon: LucideIcon;
  name: string;
  onSelect: () => void;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={description}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-colors",
          active && "text-[#df4942] dark:text-[#ff746d]",
        )}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {shortcut && (
        <kbd className="rounded border border-sidebar-border bg-background/60 px-1 py-0.5 text-[9px] leading-none text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function ToolGroup({
  count,
  label,
  onToggle,
  open,
  children,
}: {
  count: number;
  label: string;
  onToggle: () => void;
  open: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="px-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-7 w-full items-center gap-1 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")}
        />
        <span>{label}</span>
        <span className="ml-auto font-normal tabular-nums">{count}</span>
      </button>
      {open && <div className="space-y-0.5 pb-1">{children}</div>}
    </section>
  );
}

export function EditorToolsPanel() {
  const imageRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState(DEFAULT_OPEN_GROUPS);
  const app = useAppSelector(
    (state) => ({
      formBuilder: state.formBuilder,
      isMobile: state.isMobile,
      pendingStamp: state.pendingStamp,
      setFormBuilder: state.setFormBuilder,
      setPendingStamp: state.setPendingStamp,
      setScreen: state.setScreen,
      setSelected: state.setSelected,
      setSidebarOpen: state.setSidebarOpen,
      setSignatureModalOpen: state.setSignatureModalOpen,
      setTool: state.setTool,
      tool: state.tool,
    }),
    shallowEqual,
  );

  const normalizedQuery = query.trim().toLowerCase();
  useEffect(() => {
    const activeTool = findEditorTool(app.tool);
    if (!activeTool) return;
    setOpenGroups((current) =>
      current[activeTool.group]
        ? current
        : { ...current, [activeTool.group]: true },
    );
  }, [app.tool]);

  const closeOnMobile = () => {
    if (app.isMobile) app.setSidebarOpen(false);
  };
  const chooseTool = (tool: ToolKind) => {
    app.setScreen("viewer");
    selectEditorTool(app, tool);
    closeOnMobile();
  };

  const insertActions = useMemo<InsertAction[]>(
    () => [
      {
        id: "image",
        name: "Image",
        description: "Place a PNG or JPEG on the page",
        icon: ImageIcon,
        aliases: ["photo", "picture"],
        onSelect: () => imageRef.current?.click(),
      },
      {
        id: "form",
        name: "Form builder",
        description: "Design fillable fields and tab order",
        icon: FormInput,
        aliases: ["fields"],
        active: app.formBuilder,
        onSelect: () => {
          app.setScreen("viewer");
          app.setFormBuilder(!app.formBuilder);
          closeOnMobile();
        },
      },
      {
        id: "signature",
        name: "Signature",
        description: "Draw, type, upload, or reuse a signature",
        icon: Signature,
        aliases: ["sign"],
        onSelect: () => {
          app.setSignatureModalOpen(true);
          closeOnMobile();
        },
      },
      ...STAMPS.map((stamp) => ({
        id: `stamp-${stamp.label}`,
        name: `${stamp.label} stamp`,
        description: stamp.withDate
          ? "Place this stamp with today's date"
          : "Place this stamp on the page",
        icon: Stamp,
        aliases: ["rubber stamp"],
        active: false,
        onSelect: () => {
          const { dataUrl, aspect } = makeStamp(stamp);
          app.setScreen("viewer");
          app.setSelected(null);
          app.setPendingStamp({ dataUrl, aspect });
          closeOnMobile();
        },
      })),
    ],
    [app.formBuilder, app.isMobile],
  );

  const visibleGroups = EDITOR_TOOL_GROUPS.map((group) => ({
    ...group,
    tools: EDITOR_TOOLS.filter(
      (tool) => tool.group === group.id && matchesSearch(tool, normalizedQuery),
    ),
  }));
  const visibleInsertActions = insertActions.filter((action) =>
    matchesSearch(action, normalizedQuery),
  );
  const resultCount =
    visibleGroups.reduce((total, group) => total + group.tools.length, 0) +
    visibleInsertActions.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search editor tools"
            aria-label="Search editor tools"
            className="h-8 bg-background pl-8 text-xs"
          />
        </div>
      </div>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto pb-3">
        {resultCount === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No editor tools match “{query.trim()}”.
          </p>
        ) : (
          <>
            {visibleGroups.map((group) => {
              const open = normalizedQuery ? group.tools.length > 0 : openGroups[group.id];
              return (
                <ToolGroup
                  key={group.id}
                  label={group.label}
                  count={group.tools.length}
                  open={open}
                  onToggle={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.id]: !current[group.id],
                    }))
                  }
                >
                  {group.tools.map((tool) => (
                    <ToolRow
                      key={tool.key}
                      icon={tool.icon}
                      name={tool.name}
                      description={tool.description}
                      shortcut={tool.shortcut}
                      active={!app.pendingStamp && app.tool === tool.key}
                      onSelect={() => chooseTool(tool.key)}
                    />
                  ))}
                </ToolGroup>
              );
            })}
            <ToolGroup
              label="Insert"
              count={visibleInsertActions.length}
              open={normalizedQuery ? visibleInsertActions.length > 0 : openGroups.insert}
              onToggle={() =>
                setOpenGroups((current) => ({
                  ...current,
                  insert: !current.insert,
                }))
              }
            >
              {visibleInsertActions.map((action) => (
                <ToolRow
                  key={action.id}
                  {...action}
                  active={action.active}
                />
              ))}
            </ToolGroup>
          </>
        )}
      </div>

      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const image = new Image();
            image.onload = () => {
              app.setScreen("viewer");
              app.setSelected(null);
              app.setPendingStamp({
                dataUrl,
                aspect: image.height / image.width || 1,
              });
              closeOnMobile();
            };
            image.src = dataUrl;
          };
          reader.readAsDataURL(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

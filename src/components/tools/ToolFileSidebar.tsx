import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileText,
  GripVertical,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { Tip } from "../ui/tooltip";

export const TOOL_SIDEBAR_CONTENT_ID = "tool-sidebar-content";

export function ToolSidebarPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const connect = () => {
      const nextHost = document.getElementById(TOOL_SIDEBAR_CONTENT_ID);
      if (!nextHost) return false;
      setHost(nextHost);
      return true;
    };

    if (connect()) return;

    const observer = new MutationObserver(() => {
      if (connect()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return host ? createPortal(children, host) : null;
}

interface ToolFileSidebarProps<T> {
  items: T[];
  getKey: (item: T) => string;
  getName: (item: T) => string;
  getMeta: (item: T) => ReactNode;
  emptyText: string;
  addLabel: string;
  onAdd: () => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  selectedKey?: string | null;
  onSelect?: (item: T) => void;
}

/** Compact Recent-style queue for file-heavy tools. */
export function ToolFileSidebar<T>({
  items,
  getKey,
  getName,
  getMeta,
  emptyText,
  addLabel,
  onAdd,
  onReorder,
  onDuplicate,
  onRemove,
  selectedKey,
  onSelect,
}: ToolFileSidebarProps<T>) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <div data-testid="tool-file-sidebar" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 pb-0.5 pt-2 pr-2.5">
        <span className="flex min-w-0 items-center gap-1 px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Files
          <span className="font-normal tabular-nums opacity-70">{items.length}</span>
        </span>
        <Tip label={addLabel}>
          <button
            type="button"
            aria-label={addLabel}
            onClick={onAdd}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            className="w-full rounded-md px-2 py-2 text-left text-[11px] leading-relaxed text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            {emptyText}
          </button>
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item, index) => {
              const name = getName(item);
              const key = getKey(item);
              const selected = selectedKey === key;
              return (
                <div
                  key={key}
                  data-testid="tool-sidebar-file"
                  data-selected={selected || undefined}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  draggable
                  onClick={() => onSelect?.(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect?.(item);
                    }
                  }}
                  onDragStart={(event) => {
                    setDragFrom(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-pickpdf-tool-file-order", String(index));
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDragOver={(event) => {
                    if (dragFrom === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    setDragOver(index);
                  }}
                  onDrop={(event) => {
                    if (dragFrom === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (dragFrom !== index) onReorder(dragFrom, index);
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className={cn(
                    "group flex cursor-grab items-center gap-1.5 rounded-md border-l-2 border-transparent px-1.5 py-1.5 text-left text-xs outline-none transition-colors hover:bg-sidebar-accent active:cursor-grabbing",
                    selected &&
                      "border-primary bg-background font-medium text-foreground shadow-sm",
                    dragOver === index && dragFrom !== index &&
                      "border-primary bg-sidebar-accent",
                  )}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-background px-1 text-[9px] font-medium tabular-nums text-muted-foreground shadow-sm">
                    {index + 1}
                  </span>
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Tip label={name} side="right">
                      <p className="truncate text-xs text-sidebar-foreground">{name}</p>
                    </Tip>
                    <p className="truncate text-[10px] text-muted-foreground">{getMeta(item)}</p>
                  </div>
                  <Menu>
                    <Tip label={`File actions for ${name}`}>
                      <MenuTrigger
                        aria-label={`File actions for ${name}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[popup-open]:bg-accent data-[popup-open]:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </MenuTrigger>
                    </Tip>
                    <MenuContent align="end" className="min-w-44">
                      <MenuItem disabled={index === 0} onClick={() => onReorder(index, index - 1)}>
                        <ArrowUp className="h-4 w-4 text-muted-foreground" />
                        Move earlier
                      </MenuItem>
                      <MenuItem
                        disabled={index === items.length - 1}
                        onClick={() => onReorder(index, index + 1)}
                      >
                        <ArrowDown className="h-4 w-4 text-muted-foreground" />
                        Move later
                      </MenuItem>
                      <MenuItem onClick={() => onDuplicate(index)}>
                        <Copy className="h-4 w-4 text-muted-foreground" />
                        Duplicate
                      </MenuItem>
                      <MenuItem
                        onClick={() => onRemove(index)}
                        className="text-destructive data-[highlighted]:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

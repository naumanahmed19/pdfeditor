import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FilePlus2,
  RotateCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Tip } from "../ui/tooltip";

export interface FileCollectionViewProps<T> {
  items: T[];
  getKey: (item: T) => string;
  getName: (item: T) => string;
  getMeta?: (item: T) => ReactNode;
  renderPreview?: (item: T) => ReactNode;
  emptyTitle: string;
  emptyDescription: ReactNode;
  emptyActionLabel: string;
  addMoreLabel: string;
  onEmptyAction: () => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onRotate?: (index: number) => void;
  onRemove: (index: number) => void;
  selectedKey?: string | null;
  selectedKeys?: ReadonlySet<string>;
  onSelect?: (item: T) => void;
  onToggleSelect?: (item: T, selected: boolean) => void;
}

/** Shared ordered-file layout for tools such as Merge and Images-to-PDF. */
export function FileCollectionView<T>({
  items,
  getKey,
  getName,
  getMeta,
  renderPreview,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  addMoreLabel,
  onEmptyAction,
  onReorder,
  onDuplicate,
  onRotate,
  onRemove,
  selectedKey,
  selectedKeys,
  onSelect,
  onToggleSelect,
}: FileCollectionViewProps<T>) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (!items.length) {
    return (
      <button
        type="button"
        data-testid="file-collection-empty"
        onClick={onEmptyAction}
        className="group mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center transition-all hover:border-primary/45 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-96"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-primary">
          <UploadCloud className="h-5 w-5" />
        </span>
        <span className="pt-4 text-sm font-semibold text-foreground">{emptyTitle}</span>
        <span className="max-w-md pt-1 text-xs leading-relaxed text-muted-foreground">
          {emptyDescription}
        </span>
        <span className="mt-4 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors group-hover:border-primary/30">
          {emptyActionLabel}
        </span>
      </button>
    );
  }

  const controls = (item: T, index: number) => {
    const name = getName(item);
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <CollectionButton
          label={`Move ${name} earlier`}
          disabled={index === 0}
          onClick={() => onReorder(index, index - 1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </CollectionButton>
        <CollectionButton
          label={`Move ${name} later`}
          disabled={index === items.length - 1}
          onClick={() => onReorder(index, index + 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </CollectionButton>
        <CollectionButton label={`Duplicate ${name}`} onClick={() => onDuplicate(index)}>
          <Copy className="h-3.5 w-3.5" />
        </CollectionButton>
        {onRotate && (
          <CollectionButton
            label={`Rotate ${name} clockwise`}
            onClick={() => onRotate(index)}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </CollectionButton>
        )}
        <CollectionButton label={`Remove ${name}`} onClick={() => onRemove(index)} destructive>
          <Trash2 className="h-3.5 w-3.5" />
        </CollectionButton>
      </div>
    );
  };

  const dragProps = (index: number) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setDragFrom(index);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-pickpdf-file-order", String(index));
    },
    onDragEnd: () => {
      setDragFrom(null);
      setDragOver(null);
    },
    onDragOver: (event: React.DragEvent) => {
      if (dragFrom === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDragOver(index);
    },
    onDrop: (event: React.DragEvent) => {
      if (dragFrom === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (dragFrom !== index) onReorder(dragFrom, index);
      setDragFrom(null);
      setDragOver(null);
    },
  });

  return (
    <div className="flex flex-col gap-2 pb-3">
      <span className="text-xs font-medium text-muted-foreground">
        {items.length} file{items.length === 1 ? "" : "s"} · drag to reorder
      </span>

      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
      >
        {items.map((item, index) => {
          const name = getName(item);
          const key = getKey(item);
          const selected = selectedKeys ? selectedKeys.has(key) : selectedKey === key;
          const preview = renderPreview?.(item);
          return (
            <div
              key={key}
              {...dragProps(index)}
              data-testid="file-collection-item"
              data-selected={selected || undefined}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect?.(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.(item);
                }
              }}
              className={cn(
                "group/card flex cursor-grab flex-col rounded-xl border bg-card p-2 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md active:cursor-grabbing",
                selected && "border-primary bg-primary/[0.025] ring-1 ring-primary/35",
                dragOver === index && dragFrom !== index && "border-blue-500 ring-1 ring-blue-500/50",
              )}
            >
              <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-muted/30 p-3 ring-1 ring-inset ring-border/40">
                {preview ?? <span className="text-xs text-muted-foreground">No preview</span>}
                <span className="absolute left-2 top-2 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold shadow-sm ring-1 ring-border">
                  {index + 1}
                </span>
                {onToggleSelect && (
                  <span
                    className="absolute right-2 top-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected}
                      aria-label={`Select ${name}`}
                      className="bg-background/90 shadow-sm"
                      onCheckedChange={(checked: boolean) => onToggleSelect(item, checked)}
                    />
                  </span>
                )}
              </div>
              <div className="min-w-0 px-1 pt-2">
                <p className="truncate text-sm font-medium" title={name}>{name}</p>
                <p className="truncate pt-0.5 text-xs text-muted-foreground">{getMeta?.(item)}</p>
              </div>
              <div className="mt-2 flex min-h-9 items-center justify-end border-t px-0.5 pt-1.5">
                {controls(item, index)}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          data-testid="file-collection-add"
          onClick={onEmptyAction}
          className="group flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/15 p-5 text-center text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/[0.03] hover:text-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border bg-background shadow-sm transition-colors group-hover:text-primary">
            <FilePlus2 className="h-5 w-5" />
          </span>
          <span className="pt-3 text-sm font-medium">{addMoreLabel}</span>
          <span className="pt-1 text-xs text-muted-foreground">Drop or browse</span>
        </button>
      </div>
    </div>
  );
}

function CollectionButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className={cn(
          "h-7 w-7 rounded text-muted-foreground hover:text-foreground disabled:opacity-40",
          destructive && "hover:text-destructive",
        )}
      >
        {children}
      </Button>
    </Tip>
  );
}

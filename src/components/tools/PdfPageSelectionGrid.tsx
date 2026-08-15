import { type KeyboardEvent, type MouseEvent } from "react";
import { type PdfDoc } from "../../lib/pdf";
import { cn } from "../../lib/utils";
import { Thumbnail } from "../layout/Sidebar";
import { Checkbox } from "../ui/checkbox";

interface PdfPageSelectionGridProps {
  pdf: PdfDoc;
  pageCount: number;
  selectedPages: ReadonlySet<number>;
  onSelect: (
    pageIndex: number,
    modifiers: { toggle: boolean; range: boolean },
  ) => void;
  onToggle: (pageIndex: number, selected: boolean) => void;
}

export function PdfPageSelectionGrid({
  pdf,
  pageCount,
  selectedPages,
  onSelect,
  onToggle,
}: PdfPageSelectionGridProps) {
  const selectPage = (
    pageIndex: number,
    event: Pick<MouseEvent | KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey">,
  ) =>
    onSelect(pageIndex, {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });

  return (
    <div
      data-testid="split-page-grid"
      className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3"
    >
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const selected = selectedPages.has(pageIndex);
        return (
          <div
            key={pageIndex}
            data-testid="split-page-card"
            data-selected={selected || undefined}
            role="button"
            tabIndex={0}
            aria-label={`Page ${pageIndex + 1}`}
            aria-pressed={selected}
            style={{ contentVisibility: "auto", containIntrinsicSize: "270px 220px" }}
            onClick={(event) => selectPage(pageIndex, event)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectPage(pageIndex, event);
              }
            }}
            className={cn(
              "group relative flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-xl border bg-card p-3 shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-primary bg-primary/[0.025] ring-1 ring-primary/35",
            )}
          >
            <span
              className="absolute right-3 top-3 z-10 cursor-pointer"
              onClick={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={selected}
                aria-label={`Select page ${pageIndex + 1}`}
                className="cursor-pointer bg-background/90 shadow-sm"
                onCheckedChange={(checked: boolean) => onToggle(pageIndex, checked)}
              />
            </span>
            <Thumbnail pdf={pdf} pageIndex={pageIndex} width={170} active={selected} />
          </div>
        );
      })}
    </div>
  );
}

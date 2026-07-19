import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
} from "lucide-react";
import { useApp } from "../../store";
import { type AlignMode, alignRects, distributeRects } from "../../lib/snap";
import type { Annotation } from "../../types";
import { Tip } from "../ui/tooltip";

const btn =
  "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/**
 * Align / distribute icon row for the current multi-selection on `page`.
 * Every position change goes through updateAnnotations, so each click is a
 * single undo step. Shared by the form-builder popover and the floating
 * annotation selection bar.
 */
export function AlignmentButtons({ page }: { page: number }) {
  const app = useApp();
  const ms = app.multiSelected;
  const anns = (app.annotations[page] ?? []).filter((a) =>
    ms?.ids.includes(a.id),
  );
  if (!ms || anns.length < 2) return null;

  const applyPositions = (positions: Array<{ x?: number; y?: number }>) =>
    app.updateAnnotations(
      page,
      anns.map((a, i) => ({ ...a, ...positions[i] }) as Annotation),
    );
  const align = (mode: AlignMode) => applyPositions(alignRects(anns, mode));
  const distribute = (axis: "x" | "y") =>
    applyPositions(distributeRects(anns, axis));

  return (
    <div className="flex flex-wrap gap-0.5">
      <AlignAction label="Align left edges" onClick={() => align("left")}><AlignStartVertical className="h-4 w-4" /></AlignAction>
      <AlignAction label="Align horizontal centers" onClick={() => align("center-h")}><AlignCenterVertical className="h-4 w-4" /></AlignAction>
      <AlignAction label="Align right edges" onClick={() => align("right")}><AlignEndVertical className="h-4 w-4" /></AlignAction>
      <AlignAction label="Align top edges" onClick={() => align("top")}><AlignStartHorizontal className="h-4 w-4" /></AlignAction>
      <AlignAction label="Align vertical centers" onClick={() => align("center-v")}><AlignCenterHorizontal className="h-4 w-4" /></AlignAction>
      <AlignAction label="Align bottom edges" onClick={() => align("bottom")}><AlignEndHorizontal className="h-4 w-4" /></AlignAction>
      {anns.length > 2 && (
        <>
          <AlignAction label="Distribute horizontally" onClick={() => distribute("x")}><AlignHorizontalSpaceAround className="h-4 w-4" /></AlignAction>
          <AlignAction label="Distribute vertically" onClick={() => distribute("y")}><AlignVerticalSpaceAround className="h-4 w-4" /></AlignAction>
        </>
      )}
    </div>
  );
}

function AlignAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <Tip label={label}><button className={btn} aria-label={label} onClick={onClick}>{children}</button></Tip>;
}

/** Compact floating bar shown near a multi-selected (non-form) annotation. */
export function SelectionAlignBar({ page }: { page: number }) {
  const app = useApp();
  const count = app.multiSelected?.ids.length ?? 0;
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="whitespace-nowrap pl-1 text-[11px] font-semibold">
        {count} selected
      </span>
      <AlignmentButtons page={page} />
    </div>
  );
}

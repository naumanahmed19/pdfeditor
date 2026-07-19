import { useEffect, useMemo, useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PdfDoc } from "../../lib/pdf";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import { objectsAtPoint, pickSmallestObjectAt } from "../../lib/objectHitTest";
import { Button } from "../ui/button";
import { Popover, PopoverContent } from "../ui/popover";
import { Select } from "../ui/select";
import { Tip } from "../ui/tooltip";

interface ScreenObj {
  index: number;
  kind: "text" | "image" | "path";
  pdf: { left: number; bottom: number; right: number; top: number };
  rect: { left: number; top: number; width: number; height: number };
  fill: [number, number, number, number] | null;
  stroke: [number, number, number, number] | null;
  strokeWidth: number;
}

/**
 * A small color swatch that opens the native picker and commits the chosen
 * color once — on the input's native `change` event (fired when the picker
 * closes), not on blur or React's continuous onChange. The swatch previews the
 * live value while the picker is open.
 */
function ColorChip({
  label,
  hex,
  disabled,
  onPreview,
  onPick,
}: {
  label: string;
  hex: string;
  disabled: boolean;
  onPreview: (hex: string) => void;
  onPick: (hex: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(hex);
  useEffect(() => setPreview(hex), [hex]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => onPick(el.value);
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [onPick]);
  return (
    <div
      className="z-10 flex w-max items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <Tip label="Change color">
        <label
          className="relative block h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-black/15 shadow-sm dark:border-white/20"
          style={{ backgroundColor: preview }}
        >
          <input
            ref={ref}
            type="color"
            defaultValue={hex}
            disabled={disabled}
            aria-label="Change color"
            className="absolute -inset-2 cursor-pointer opacity-0"
            onInput={(e) => {
              setPreview(e.currentTarget.value);
              onPreview(e.currentTarget.value);
            }}
          />
        </label>
      </Tip>
    </div>
  );
}

const toHex = (c: [number, number, number, number]) =>
  "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
const rgbaOf = (h: string): [number, number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];

/**
 * Contextual properties panel shown above a selected page object: the relevant
 * fields for that object (fill/stroke color, stroke width), its size, and a
 * delete action. Anchored to the selection like a shadcn popover.
 */
function ObjectProperties({
  obj,
  busy,
  onFillPreview,
  onStyle,
  onDelete,
  onReplaceImage,
}: {
  obj: ScreenObj;
  busy: boolean;
  onFillPreview: (hex: string | null) => void;
  onStyle: (patch: {
    fill?: [number, number, number, number];
    stroke?: [number, number, number, number];
    strokeWidth?: number;
  }) => void;
  onDelete: () => void;
  /** Swap the bitmap of an existing image object (same box, new pixels). */
  onReplaceImage: (data: Uint8Array, png: boolean) => void;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const wPt = Math.round(obj.pdf.right - obj.pdf.left);
  const hPt = Math.round(obj.pdf.top - obj.pdf.bottom);
  const kindLabel = obj.kind === "text" ? "Text" : obj.kind === "image" ? "Image" : "Shape";
  const hasStroke = obj.kind === "path" && !!obj.stroke && obj.strokeWidth > 0;
  const widths = [...new Set([0.5, 1, 1.5, 2, 3, 4, 6, obj.strokeWidth].filter((w) => w > 0))].sort(
    (a, b) => a - b,
  );

  return (
    <>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {kindLabel}
      </span>
      {obj.fill && (
        <ColorChip
          label={obj.kind === "text" ? "Text" : "Fill"}
          hex={toHex(obj.fill)}
          disabled={busy}
          onPreview={(h) => {
            if (obj.kind === "path") onFillPreview(h);
          }}
          onPick={(h) => {
            onFillPreview(null);
            onStyle({ fill: rgbaOf(h) });
          }}
        />
      )}
      {hasStroke && (
        <ColorChip
          label="Stroke"
          hex={toHex(obj.stroke!)}
          disabled={busy}
          onPreview={() => {}}
          onPick={(h) => onStyle({ stroke: rgbaOf(h) })}
        />
      )}
      {hasStroke && (
        <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          Width
          <Select
            className="h-6 w-14 px-1.5 text-xs"
            value={String(obj.strokeWidth || 1)}
            disabled={busy}
            onChange={(e) => onStyle({ strokeWidth: Number(e.target.value) })}
          >
            {widths.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </label>
      )}
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
        {wPt}×{hPt} pt
      </span>
      <div className="h-4 w-px bg-border" />
      {obj.kind === "image" && (
        <>
          <Tip label="Replace image" desc="Keeps its position and size">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" aria-label="Replace image" disabled={busy} onClick={() => replaceRef.current?.click()}>
              <ImageUp className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <input
            ref={replaceRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.arrayBuffer().then((buf) => {
                onReplaceImage(new Uint8Array(buf), file.type.includes("png"));
              });
            }}
          />
        </>
      )}
      <Tip label="Delete object">
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Delete object" disabled={busy} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </Tip>
    </>
  );
}

type Corner = "nw" | "ne" | "sw" | "se";
const HANDLE = 9; // px hit radius for resize handles
const DRAG_START_PX = 4;

/**
 * Native-object branch of the unified Move/select tool: click any existing
 * text run, image or vector shape (rectangles, lines, fills) to select it;
 * double-click text to edit; drag to move; drag a corner (images/shapes) to
 * resize; recolor via the color chip,
 * or press Delete to remove it. Everything commits through PDFium — true
 * content-stream edits, unified undo.
 */
export function ObjectLayer({
  pdf,
  pageIndex,
  scale,
  canvasRef,
  onEditText,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onEditText: (objectIndex: number, clientX: number, clientY: number) => void;
}) {
  const app = useApp();
  const layerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<any>(null);
  const [objects, setObjects] = useState<ScreenObj[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pressing, setPressing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lasso, setLasso] = useState<ScreenObj["rect"] | null>(null);
  // Live color while the picker is open (overlay only — the real recolor is
  // committed once on picker close to avoid a PDFium reload per input event).
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  // Live drag state: the moving/resizing box + a ghost image of the content.
  const [drag, setDrag] = useState<null | {
    orig: ScreenObj["rect"];
    box: ScreenObj["rect"];
    ghost?: string;
    group?: boolean;
  }>(null);
  const dragRef = useRef<null | {
    mode: "move" | "resize";
    corner?: Corner;
    startX: number;
    startY: number;
    obj: ScreenObj;
    members: ScreenObj[];
    box: ScreenObj["rect"];
    started: boolean;
  }>(null);
  const cycleRef = useRef<{
    x: number;
    y: number;
    indexes: number[];
    position: number;
  } | null>(null);
  const lassoRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    additive: boolean;
    box?: ScreenObj["rect"];
  } | null>(null);

  // (Re)load object rects whenever the page bytes change (pdf proxy swaps).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale });
        viewportRef.current = viewport;
        const objs = await app.getPageObjects(pageIndex);
        const mapped: ScreenObj[] = objs.map((o) => {
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
            o.left,
            o.bottom,
            o.right,
            o.top,
          ]);
          return {
            index: o.index,
            kind: o.kind,
            pdf: { left: o.left, bottom: o.bottom, right: o.right, top: o.top },
            rect: {
              left: Math.min(x1, x2),
              top: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            },
            fill: o.fill,
            stroke: o.stroke,
            strokeWidth: o.strokeWidth,
          };
        });
        if (alive) setObjects(mapped);
      } catch {
        if (alive) setObjects([]);
      }
    })();
    return () => {
      alive = false;
    };
    // app.contentRev: reload object rects after an in-place edit repaints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageIndex, scale, app.contentRev]);

  const selObj = objects.find((o) => o.index === sel) ?? null;
  const selectedIndexSet = useMemo(
    () => new Set(selectedIndexes),
    [selectedIndexes],
  );
  const selectedObjects = useMemo(
    () => objects.filter((o) => selectedIndexSet.has(o.index)),
    [objects, selectedIndexSet],
  );
  const hoveredObj = objects.find((o) => o.index === hovered) ?? null;

  const clearSelection = () => {
    setSel(null);
    setSelectedIndexes([]);
  };

  // Only one native object, annotation, or form field may own the selection.
  // Object layers exist per page, so a lightweight event clears selections on
  // other pages without moving this PDFium-specific state into the app store.
  useEffect(() => {
    const onObjectSelection = (event: Event) => {
      const detail = (
        event as CustomEvent<{ pageIndex: number; objectIndex: number } | null>
      ).detail;
      if (!detail || detail.pageIndex !== pageIndex) clearSelection();
    };
    window.addEventListener("pdfwb:object-selection", onObjectSelection);
    return () =>
      window.removeEventListener("pdfwb:object-selection", onObjectSelection);
  }, [pageIndex]);
  useEffect(() => {
    if (app.selected || app.selectedField) clearSelection();
  }, [app.selected, app.selectedField]);

  // Keyboard parity with annotations: delete, dismiss, nudge, or edit text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIndexes.length &&
        !busy
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setBusy(true);
        const indexes = [...selectedIndexes].sort((a, b) => b - a);
        clearSelection();
        Promise.all(indexes.map((idx) => app.removeObjectAt(pageIndex, idx)))
          .catch(() => toast.error("Couldn't delete that object."))
          .finally(() => setBusy(false));
        return;
      }
      if (e.key === "Escape" && selectedIndexes.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearSelection();
        return;
      }
      if (
        (e.key === "Enter" || e.key === "F2") &&
        selObj?.kind === "text" &&
        layerRef.current
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const lr = layerRef.current.getBoundingClientRect();
        onEditText(
          selObj.index,
          lr.left + selObj.rect.left + selObj.rect.width / 2,
          lr.top + selObj.rect.top + selObj.rect.height / 2,
        );
        return;
      }
      if (
        selectedObjects.length &&
        !busy &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        const vp = viewportRef.current;
        if (!vp) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        const [ax, ay] = vp.convertToPdfPoint(0, 0);
        const [bx, by] = vp.convertToPdfPoint(dx, dy);
        setBusy(true);
        Promise.all(
          selectedObjects.map((object) =>
            app.applyObjectTransform(pageIndex, object.index, {
              a: 1,
              b: 0,
              c: 0,
              d: 1,
              e: bx - ax,
              f: by - ay,
            }),
          ),
        )
          .catch(() => toast.error("Couldn't move that object."))
          .finally(() => setBusy(false));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIndexes, selectedObjects, selObj, busy, app, pageIndex, onEditText]);

  const cornerAt = (o: ScreenObj, px: number, py: number): Corner | null => {
    const { left, top, width, height } = o.rect;
    const pts: Record<Corner, [number, number]> = {
      nw: [left, top],
      ne: [left + width, top],
      sw: [left, top + height],
      se: [left + width, top + height],
    };
    for (const c of Object.keys(pts) as Corner[]) {
      const [hx, hy] = pts[c];
      if (Math.abs(px - hx) <= HANDLE && Math.abs(py - hy) <= HANDLE) return c;
    }
    return null;
  };

  // Grab a bitmap of the object's content from the rendered page canvas.
  const cropGhost = (rect: ScreenObj["rect"]): string | undefined => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return undefined;
    const s = canvas.width / (layerRef.current?.clientWidth || canvas.width);
    const sw = Math.max(1, Math.round(rect.width * s));
    const sh = Math.max(1, Math.round(rect.height * s));
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const ctx = tmp.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(
      canvas,
      Math.round(rect.left * s),
      Math.round(rect.top * s),
      sw,
      sh,
      0,
      0,
      sw,
      sh,
    );
    return tmp.toDataURL();
  };

  const objectAt = (px: number, py: number) =>
    pickSmallestObjectAt(objects, px, py);

  const groupBounds = (members: readonly ScreenObj[]) => {
    const left = Math.min(...members.map((object) => object.rect.left));
    const top = Math.min(...members.map((object) => object.rect.top));
    const right = Math.max(...members.map((object) => object.rect.left + object.rect.width));
    const bottom = Math.max(...members.map((object) => object.rect.top + object.rect.height));
    return { left, top, width: right - left, height: bottom - top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    const lr = layerRef.current!.getBoundingClientRect();
    const px = e.clientX - lr.left;
    const py = e.clientY - lr.top;

    // Resize handle of the current selection (images and shapes)?
    if (
      selectedIndexes.length === 1 &&
      selObj &&
      (selObj.kind === "image" || selObj.kind === "path")
    ) {
      const c = cornerAt(selObj, px, py);
      if (c) {
        e.stopPropagation();
        e.preventDefault();
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
        dragRef.current = {
          mode: "resize",
          corner: c,
          startX: e.clientX,
          startY: e.clientY,
          obj: selObj,
          members: [selObj],
          box: selObj.rect,
          started: false,
        };
        setPressing(true);
        return;
      }
    }

    // Otherwise pick the smallest object under the point → select + move.
    const candidates = objectsAtPoint(objects, px, py);
    let hit = candidates[0];
    if (e.altKey && candidates.length > 1) {
      const indexes = candidates.map((object) => object.index);
      const previous = cycleRef.current;
      const samePoint =
        previous &&
        Math.hypot(previous.x - px, previous.y - py) <= 5 &&
        previous.indexes.join(",") === indexes.join(",");
      const position = samePoint ? (previous.position + 1) % candidates.length : 0;
      cycleRef.current = { x: px, y: py, indexes, position };
      hit = candidates[position];
    } else {
      cycleRef.current = null;
    }
    if (!hit) {
      if (e.button === 0) {
        e.preventDefault();
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
        if (!e.shiftKey) clearSelection();
        lassoRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          originX: px,
          originY: py,
          additive: e.shiftKey,
        };
      }
      setPressing(false);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    app.setSelected(null);
    app.setSelectedField(null);
    window.dispatchEvent(
      new CustomEvent("pdfwb:object-selection", {
        detail: { pageIndex, objectIndex: hit.index },
      }),
    );
    if (e.shiftKey) {
      const next = selectedIndexSet.has(hit.index)
        ? selectedIndexes.filter((index) => index !== hit.index)
        : [...selectedIndexes, hit.index];
      setSelectedIndexes(next);
      setSel(next.includes(hit.index) ? hit.index : (next[next.length - 1] ?? null));
      setPressing(false);
      return;
    }
    const members = selectedIndexSet.has(hit.index)
      ? selectedObjects
      : [hit];
    setSelectedIndexes(members.map((object) => object.index));
    setSel(hit.index);
    const dragRect = members.length > 1 ? groupBounds(members) : hit.rect;
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      obj: hit,
      members,
      box: dragRect,
      started: false,
    };
    setPressing(true);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (busy || !layerRef.current) return;
    const lr = layerRef.current.getBoundingClientRect();
    const hit = objectAt(e.clientX - lr.left, e.clientY - lr.top);
    if (!hit || hit.kind !== "text") return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = null;
    setPressing(false);
    setDrag(null);
    onEditText(hit.index, e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const l = lassoRef.current;
    if (l) {
      const dx = e.clientX - l.startX;
      const dy = e.clientY - l.startY;
      if (!lasso && Math.hypot(dx, dy) < DRAG_START_PX) return;
      const box = {
        left: Math.min(l.originX, l.originX + dx),
        top: Math.min(l.originY, l.originY + dy),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      l.box = box;
      setLasso(box);
      return;
    }
    const d = dragRef.current;
    if (!d) {
      if (!layerRef.current) return;
      const lr = layerRef.current.getBoundingClientRect();
      setHovered(
        objectAt(e.clientX - lr.left, e.clientY - lr.top)?.index ?? null,
      );
      return;
    }
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.started && Math.hypot(dx, dy) < DRAG_START_PX) return;
    const justStarted = !d.started;
    d.started = true;
    setHovered(null);
    if (d.mode === "move") {
      const origin = d.members.length > 1 ? groupBounds(d.members) : d.obj.rect;
      const box = { ...origin, left: origin.left + dx, top: origin.top + dy };
      d.box = box;
      if (justStarted) {
        const group = d.members.length > 1;
        setDrag({
          orig: origin,
          box,
          group,
          ghost: group ? undefined : cropGhost(origin),
        });
      } else {
        setDrag((p) => (p ? { ...p, box } : p));
      }
    } else {
      // Aspect-locked resize about the opposite corner.
      const r = d.obj.rect;
      const anchor = {
        x: d.corner === "nw" || d.corner === "sw" ? r.left + r.width : r.left,
        y: d.corner === "nw" || d.corner === "ne" ? r.top + r.height : r.top,
      };
      const ox = (d.corner === "ne" || d.corner === "se" ? r.left + r.width : r.left) - anchor.x;
      const oy = (d.corner === "sw" || d.corner === "se" ? r.top + r.height : r.top) - anchor.y;
      const nx = e.clientX - (layerRef.current!.getBoundingClientRect().left + anchor.x);
      const ny = e.clientY - (layerRef.current!.getBoundingClientRect().top + anchor.y);
      const denom = ox * ox + oy * oy;
      let s = denom ? (nx * ox + ny * oy) / denom : 1;
      s = Math.max(0.05, s);
      const nw = r.width * s;
      const nh = r.height * s;
      const box = {
        left: Math.min(anchor.x, anchor.x + Math.sign(ox || 1) * nw),
        top: Math.min(anchor.y, anchor.y + Math.sign(oy || 1) * nh),
        width: nw,
        height: nh,
      };
      d.box = box;
      if (justStarted) {
        setDrag({ orig: d.obj.rect, box, ghost: cropGhost(d.obj.rect) });
      } else {
        setDrag((p) => (p ? { ...p, box } : p));
      }
    }
  };

  const onPointerUp = () => {
    const l = lassoRef.current;
    if (l) {
      lassoRef.current = null;
      if (l.box) {
        const box = l.box;
        const hits = objects
          .filter(
            (object) =>
              object.rect.left <= box.left + box.width &&
              object.rect.left + object.rect.width >= box.left &&
              object.rect.top <= box.top + box.height &&
              object.rect.top + object.rect.height >= box.top,
          )
          .map((object) => object.index);
        const next = l.additive
          ? [...new Set([...selectedIndexes, ...hits])]
          : hits;
        setSelectedIndexes(next);
        setSel(next[next.length - 1] ?? null);
        if (next.length) {
          app.setSelected(null);
          app.setSelectedField(null);
          window.dispatchEvent(
            new CustomEvent("pdfwb:object-selection", {
              detail: { pageIndex, objectIndex: next[next.length - 1] },
            }),
          );
        }
      }
      setLasso(null);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    setPressing(false);
    if (!d) {
      setDrag(null);
      return;
    }
    if (!d.started) {
      setDrag(null);
      return;
    }
    const vp = viewportRef.current;
    const box = d.box; // live box from the ref (not stale React state)
    if (!vp || !box) {
      setDrag(null);
      return;
    }
    const moved =
      Math.abs(box.left - (d.members.length > 1 ? groupBounds(d.members).left : d.obj.rect.left)) > 1 ||
      Math.abs(box.top - (d.members.length > 1 ? groupBounds(d.members).top : d.obj.rect.top)) > 1 ||
      Math.abs(box.width - d.obj.rect.width) > 1;
    if (!moved) {
      setDrag(null);
      return;
    }

    setBusy(true);
    (async () => {
      try {
        if (d.mode === "move") {
          // Screen delta → page-space translation (rotation-correct).
          const [ax, ay] = vp.convertToPdfPoint(0, 0);
          const origin = d.members.length > 1 ? groupBounds(d.members) : d.obj.rect;
          const [bx, by] = vp.convertToPdfPoint(box.left - origin.left, box.top - origin.top);
          await Promise.all(
            d.members.map((object) =>
              app.applyObjectTransform(pageIndex, object.index, {
                a: 1,
                b: 0,
                c: 0,
                d: 1,
                e: bx - ax,
                f: by - ay,
              }),
            ),
          );
        } else {
          const s = box.width / d.obj.rect.width;
          // Anchor = the screen-opposite corner, in PDF page space. Corners are
          // named in SCREEN space, so the Y axis is flipped: a screen-bottom
          // (s*) handle drags the PDF bottom, anchoring the PDF top, etc.
          const p = d.obj.pdf;
          const ax = d.corner === "nw" || d.corner === "sw" ? p.right : p.left;
          const ay = d.corner === "nw" || d.corner === "ne" ? p.bottom : p.top;
          await app.applyObjectTransform(pageIndex, d.obj.index, {
            a: s,
            b: 0,
            c: 0,
            d: s,
            e: ax * (1 - s),
            f: ay * (1 - s),
          });
        }
      } catch {
        toast.error("Couldn't edit that object.");
      } finally {
        // Keep the optimistic ghost visible while the worker regenerates a
        // complex page; the real canvas replaces it when the commit resolves.
        setDrag(null);
        setBusy(false);
      }
    })();
  };

  const onPointerCancel = () => {
    lassoRef.current = null;
    setLasso(null);
    dragRef.current = null;
    setPressing(false);
    setDrag(null);
  };

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{
        cursor: busy ? "wait" : hoveredObj ? "move" : "default",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => !dragRef.current && setHovered(null)}
      onDoubleClick={onDoubleClick}
    >
      {/* Only hovered and selected outlines are mounted, even on dense pages. */}
      {objects
        .filter((o) => selectedIndexSet.has(o.index) || o.index === hovered)
        .map((o) => (
          <div
            key={o.index}
            data-native-object-outline={selectedIndexSet.has(o.index) ? "selected" : "hovered"}
            onPointerDown={onPointerDown}
            className={cn(
              "absolute rounded-[1px]",
              selectedIndexSet.has(o.index)
                ? "outline outline-2 outline-primary"
                : "outline outline-1 outline-primary/50",
            )}
            style={{
              left: o.rect.left,
              top: o.rect.top,
              width: o.rect.width,
              height: o.rect.height,
              cursor: "move",
              transform:
                drag?.group && selectedIndexSet.has(o.index)
                  ? `translate(${drag.box.left - drag.orig.left}px, ${drag.box.top - drag.orig.top}px)`
                  : undefined,
            }}
          />
        ))}

      {lasso && (
        <div
          className="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
          style={lasso}
        />
      )}

      {/* Live color preview while the picker is open (shape fills only). */}
      {previewHex && selObj && selObj.kind === "path" && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: selObj.rect.left,
            top: selObj.rect.top,
            width: selObj.rect.width,
            height: selObj.rect.height,
            backgroundColor: previewHex,
          }}
        />
      )}

      {/* Resize handles for a selected image or shape. */}
      {selObj &&
        selectedIndexes.length === 1 &&
        (selObj.kind === "image" || selObj.kind === "path") &&
        !drag &&
        (["nw", "ne", "sw", "se"] as Corner[]).map((c) => {
          const r = selObj.rect;
          const x = c === "ne" || c === "se" ? r.left + r.width : r.left;
          const y = c === "sw" || c === "se" ? r.top + r.height : r.top;
          const cur = c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize";
          return (
            <div
              key={c}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white bg-primary shadow"
              style={{ left: x, top: y, cursor: cur }}
            />
          );
        })}

      {/* Contextual properties popover for the selected object. */}
      {selObj && selectedIndexes.length === 1 && !drag && !pressing && (
        <Popover open onOpenChange={(o: boolean) => !o && clearSelection()}>
          <PopoverContent
            anchor={{
              getBoundingClientRect: () => {
                const lr = layerRef.current?.getBoundingClientRect();
                const l = lr?.left ?? 0;
                const t = lr?.top ?? 0;
                return new DOMRect(
                  l + selObj.rect.left,
                  t + selObj.rect.top,
                  selObj.rect.width,
                  selObj.rect.height,
                );
              },
            }}
            side="top"
            align="start"
            sideOffset={8}
            className="flex items-center gap-2 px-2 py-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ObjectProperties
              obj={selObj}
              busy={busy}
              onFillPreview={setPreviewHex}
              onStyle={(patch) => {
                setBusy(true);
                app
                  .applyObjectStyle(pageIndex, selObj.index, patch)
                  .catch(() => toast.error("Couldn't restyle that object."))
                  .finally(() => setBusy(false));
              }}
              onDelete={() => {
                const idx = selObj.index;
                clearSelection();
                setBusy(true);
                app
                  .removeObjectAt(pageIndex, idx)
                  .catch(() => toast.error("Couldn't delete that object."))
                  .finally(() => setBusy(false));
              }}
              onReplaceImage={(data, png) => {
                const idx = selObj.index;
                clearSelection();
                setBusy(true);
                app
                  .applyBytesOp(async (bytes) => {
                    const { replaceImageObject } = await import("../../lib/pdfium");
                    return replaceImageObject(bytes, pageIndex, idx, data, png);
                  }, "Image replaced")
                  .finally(() => setBusy(false));
              }}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Drag preview: dim the original, float a ghost of the content. */}
      {drag && (
        <>
          {!drag.group && (
            <div
              className="absolute bg-white/60"
              style={{
                left: drag.orig.left,
                top: drag.orig.top,
                width: drag.orig.width,
                height: drag.orig.height,
              }}
            />
          )}
          {drag.ghost && (
            <img
              src={drag.ghost}
              alt=""
              className="absolute opacity-90 outline-dashed outline-1 outline-primary"
              style={{
                left: drag.box.left,
                top: drag.box.top,
                width: drag.box.width,
                height: drag.box.height,
              }}
            />
          )}
          {drag.group && (
            <div
              className="pointer-events-none absolute border border-dashed border-primary/70"
              style={drag.box}
            />
          )}
        </>
      )}
    </div>
  );
}


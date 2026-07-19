import { useEffect, useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PdfDoc } from "../../lib/pdf";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverContent } from "../ui/popover";
import { Select } from "../ui/select";

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
      <label
        className="relative block h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-black/15 shadow-sm dark:border-white/20"
        style={{ backgroundColor: preview }}
        title="Change color"
      >
        <input
          ref={ref}
          type="color"
          defaultValue={hex}
          disabled={disabled}
          className="absolute -inset-2 cursor-pointer opacity-0"
          onInput={(e) => {
            setPreview(e.currentTarget.value);
            onPreview(e.currentTarget.value);
          }}
        />
      </label>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Replace image (keeps position and size)"
            disabled={busy}
            onClick={() => replaceRef.current?.click()}
          >
            <ImageUp className="h-3.5 w-3.5" />
          </Button>
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
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title="Delete object"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

type Corner = "nw" | "ne" | "sw" | "se";
const HANDLE = 9; // px hit radius for resize handles

/**
 * Object editor (active on the "Move objects" tool, app.tool === "editobject"):
 * click any existing text run, image or vector shape (rectangles, lines, fills)
 * to select it, drag
 * to move, drag a corner (images/shapes) to resize, recolor via the color chip,
 * or press Delete to remove it. Everything commits through PDFium — true
 * content-stream edits, unified undo.
 */
export function ObjectLayer({
  pdf,
  pageIndex,
  scale,
  canvasRef,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const app = useApp();
  const layerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<any>(null);
  const [objects, setObjects] = useState<ScreenObj[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Live color while the picker is open (overlay only — the real recolor is
  // committed once on picker close to avoid a PDFium reload per input event).
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  // Live drag state: the moving/resizing box + a ghost image of the content.
  const [drag, setDrag] = useState<null | {
    orig: ScreenObj["rect"];
    box: ScreenObj["rect"];
    ghost?: string;
  }>(null);
  const dragRef = useRef<null | {
    mode: "move" | "resize";
    corner?: Corner;
    startX: number;
    startY: number;
    obj: ScreenObj;
    box: ScreenObj["rect"];
  }>(null);

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

  // Delete removes the selected object.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel != null && !busy) {
        e.preventDefault();
        setBusy(true);
        const idx = sel;
        setSel(null);
        app
          .removeObjectAt(pageIndex, idx)
          .catch(() => toast.error("Couldn't delete that object."))
          .finally(() => setBusy(false));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, busy, app, pageIndex]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    const lr = layerRef.current!.getBoundingClientRect();
    const px = e.clientX - lr.left;
    const py = e.clientY - lr.top;

    // Resize handle of the current selection (images and shapes)?
    if (selObj && (selObj.kind === "image" || selObj.kind === "path")) {
      const c = cornerAt(selObj, px, py);
      if (c) {
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
          box: selObj.rect,
        };
        setDrag({ orig: selObj.rect, box: selObj.rect, ghost: cropGhost(selObj.rect) });
        return;
      }
    }

    // Otherwise pick the smallest object under the point → select + move.
    const hit = objects
      .filter(
        (o) =>
          px >= o.rect.left &&
          px <= o.rect.left + o.rect.width &&
          py >= o.rect.top &&
          py <= o.rect.top + o.rect.height,
      )
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!hit) {
      setSel(null);
      return;
    }
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    setSel(hit.index);
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      obj: hit,
      box: hit.rect,
    };
    setDrag({ orig: hit.rect, box: hit.rect, ghost: cropGhost(hit.rect) });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      const box = { ...d.obj.rect, left: d.obj.rect.left + dx, top: d.obj.rect.top + dy };
      d.box = box;
      setDrag((p) => (p ? { ...p, box } : p));
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
      setDrag((p) => (p ? { ...p, box } : p));
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) {
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
      Math.abs(box.left - d.obj.rect.left) > 1 ||
      Math.abs(box.top - d.obj.rect.top) > 1 ||
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
          const [bx, by] = vp.convertToPdfPoint(
            box.left - d.obj.rect.left,
            box.top - d.obj.rect.top,
          );
          await app.applyObjectTransform(pageIndex, d.obj.index, {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            e: bx - ax,
            f: by - ay,
          });
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

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{ cursor: busy ? "wait" : "default", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Hover/selectable outlines for each object. */}
      {objects.map((o) => (
        <div
          key={o.index}
          className={cn(
            "absolute rounded-[1px]",
            o.index === sel
              ? "outline outline-2 outline-primary"
              : "hover:outline hover:outline-1 hover:outline-primary/50",
          )}
          style={{
            left: o.rect.left,
            top: o.rect.top,
            width: o.rect.width,
            height: o.rect.height,
            cursor: "move",
          }}
        />
      ))}

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
      {selObj && !drag && (
        <Popover open onOpenChange={(o: boolean) => !o && setSel(null)}>
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
                setSel(null);
                setBusy(true);
                app
                  .removeObjectAt(pageIndex, idx)
                  .catch(() => toast.error("Couldn't delete that object."))
                  .finally(() => setBusy(false));
              }}
              onReplaceImage={(data, png) => {
                const idx = selObj.index;
                setSel(null);
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
          <div
            className="absolute bg-white/60"
            style={{
              left: drag.orig.left,
              top: drag.orig.top,
              width: drag.orig.width,
              height: drag.orig.height,
            }}
          />
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
        </>
      )}
    </div>
  );
}


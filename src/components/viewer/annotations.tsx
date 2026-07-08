import { useEffect, useRef, useState } from "react";
import { Calendar, MessageSquare, PenLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { cn, uid, ROTATABLE_KINDS } from "../../lib/utils";
import { MARKUP_COLORS, squigglyPath } from "../../lib/markup";
import {
  FIELD_FOR_TOOL,
  FIELD_META,
  buildFormField,
  snapMovingRect,
  snapResizingRect,
} from "../../lib/formbuilder";
import { BlockTextEditor } from "./BlockTextEditor";
import {
  DEFAULT_LINE_HEIGHT,
  blocksHaveText,
  blocksPlainText,
  blocksToSemanticHtml,
  getBlocks,
  measureBlocks,
} from "../../lib/richtext";
import type { PageDims } from "./types";
import { FONT_CSS } from "./textedit";
import {
  FieldPreviewInput,
  MultiFieldTools,
  FieldProperties,
  fieldWidgetCss,
} from "./form";
import type {
  Annotation,
  NoteAnnotation,
  ShapeAnnotation,
  TextAnnotation,
} from "../../types";
import { Button } from "../ui/button";
import { ColorSwatch } from "../ui/color-swatch";
import { Popover, PopoverContent } from "../ui/popover";
import { Textarea } from "../ui/textarea";

let warnedWhiteout = false;
function warnWhiteoutOnce() {
  if (warnedWhiteout) return;
  warnedWhiteout = true;
  toast.warning("Whiteout hides text, it doesn't remove it", {
    description:
      "The covered text still exists inside the saved PDF and can be selected or extracted. Don't use whiteout to redact confidential information.",
    duration: 9000,
  });
}

/** CSS style for a text box's line spacing / tracking, shared by the editor,
 *  the on-screen display and the empty-box placeholder. `scale` converts the
 *  point-based letter-spacing to on-screen pixels. */
function textSpacingStyle(ann: TextAnnotation, scale: number): React.CSSProperties {
  return {
    lineHeight: ann.lineHeight ?? DEFAULT_LINE_HEIGHT,
    letterSpacing: (ann.letterSpacing ?? 0) * scale,
  };
}

/** Pencil cursor for the freehand tool (lucide pencil with a white halo so it
 *  reads on any page color); hotspot at the pencil tip, crosshair fallback. */
const PENCIL_PATH =
  "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z";
const PENCIL_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='${PENCIL_PATH}' stroke='white' stroke-width='4.5' stroke-linejoin='round'/><path d='${PENCIL_PATH}' fill='%23111827' stroke='%23111827' stroke-width='1' stroke-linejoin='round'/></svg>") 2 22, crosshair`;

interface DraftShape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function AnnotationLayer({
  pageIndex,
  scale,
  baseDims,
}: {
  pageIndex: number;
  scale: number;
  baseDims: PageDims;
}) {
  const app = useApp();
  const layerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [inkPoints, setInkPoints] = useState<Array<{ x: number; y: number }>>([]);
  const drawing = useRef(false);
  const notePending = useRef<{ x: number; y: number } | null>(null);

  const anns = app.annotations[pageIndex] ?? [];
  // Note: underline / strikeout / squiggly mark existing text via selection
  // (handled on the text layer + mark-on-mouseup effect), not by dragging a box
  // here. Highlight free-draws a box only in "area" mode; in "text" mode it
  // marks selected text like the others.
  const drawingTool =
    [
      "rect",
      "ellipse",
      "line",
      "arrow",
      "callout",
      "whiteout",
      "redact",
      "ink",
      "formtext",
      "formcheckbox",
      "formdropdown",
      "formradio",
      "formdate",
      "formsignature",
      "formbutton",
    ].includes(app.tool) ||
    (app.tool === "highlight" && app.highlightMode === "area");

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = layerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(baseDims.width, (e.clientX - rect.left) / scale)),
      y: Math.max(0, Math.min(baseDims.height, (e.clientY - rect.top) / scale)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    // Stamp placement (signature / image)
    if (app.pendingStamp) {
      // Cancel the native mousedown so focus isn't stolen from the page.
      e.preventDefault();
      const p = toLocal(e);
      const wPts = Math.min(200, baseDims.width * 0.4);
      const hPts = wPts * app.pendingStamp.aspect;
      app.addAnnotation(pageIndex, {
        id: uid(),
        kind: "image",
        x: p.x - wPts / 2,
        y: p.y - hPts / 2,
        w: wPts,
        h: hPts,
        dataUrl: app.pendingStamp.dataUrl,
      });
      app.setPendingStamp(null);
      app.setTool("select");
      return;
    }

    if (app.tool === "text") {
      // Cancel the native mousedown default action — otherwise the browser
      // moves focus after the textarea mounts, blurring it immediately and
      // the empty annotation gets cleaned up before the user can type.
      e.preventDefault();
      const p = toLocal(e);
      const ann: TextAnnotation = {
        id: uid(),
        kind: "text",
        x: p.x,
        y: p.y,
        w: 220,
        h: app.fontSize * 2,
        text: "",
        fontSize: app.fontSize,
        color: app.fontColor,
        fontFamily: app.fontFamily,
        bold: app.fontBold,
        italic: app.fontItalic,
        underline: app.fontUnderline,
        strike: app.fontStrike,
        align: app.textAlign,
        lineHeight: app.lineHeight,
        letterSpacing: app.letterSpacing,
      };
      app.addAnnotation(pageIndex, ann);
      app.setSelected({ page: pageIndex, id: ann.id });
      app.setTool("select");
      return;
    }

    if (app.tool === "note") {
      // Only remember the spot — the note is created on pointerUP. Creating
      // it here would mount the popover mid-gesture, and the finishing
      // pointerup/click lands outside the popup and dismisses it instantly.
      e.preventDefault();
      notePending.current = toLocal(e);
      return;
    }

    if (!drawingTool) {
      app.setSelected(null);
      return;
    }

    drawing.current = true;
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointers */
    }
    const p = toLocal(e);
    if (app.tool === "ink") {
      setInkPoints([p]);
    } else {
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toLocal(e);
    if (app.tool === "ink") {
      setInkPoints((pts) => {
        const last = pts[pts.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return pts;
        return [...pts, p];
      });
    } else {
      setDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
    }
  };

  const onPointerUp = () => {
    if (notePending.current && app.tool === "note") {
      const p = notePending.current;
      notePending.current = null;
      const ann: NoteAnnotation = {
        id: uid(),
        kind: "note",
        x: p.x,
        y: p.y,
        w: 22,
        h: 22,
        text: "",
        color: "#facc15",
      };
      app.addAnnotation(pageIndex, ann);
      app.setSelected({ page: pageIndex, id: ann.id });
      app.setTool("select");
      return;
    }

    if (!drawing.current) return;
    drawing.current = false;

    if (app.tool === "ink" && inkPoints.length > 1) {
      const xs = inkPoints.map((p) => p.x);
      const ys = inkPoints.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      app.addAnnotation(pageIndex, {
        id: uid(),
        kind: "ink",
        x: minX,
        y: minY,
        w: Math.max(...xs) - minX,
        h: Math.max(...ys) - minY,
        points: inkPoints.map((p) => ({ x: p.x - minX, y: p.y - minY })),
        color: app.toolColor,
        strokeWidth: app.strokeWidth,
      });
    } else if (draft) {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);

      // Form-field tools: click places a default-sized field, drag sizes it.
      if (app.tool.startsWith("form")) {
        const fieldType = FIELD_FOR_TOOL[app.tool]!;
        const meta = FIELD_META[fieldType];
        let fx = draft.x0;
        let fy = draft.y0;
        if (app.formBuilder && app.gridEnabled) {
          fx = Math.round(fx / app.gridSize) * app.gridSize;
          fy = Math.round(fy / app.gridSize) * app.gridSize;
        }
        const ann = buildFormField(app.annotations, fieldType, {
          x: fx,
          y: fy,
          w,
          h,
        });
        app.addAnnotation(pageIndex, ann);
        app.setSelected({ page: pageIndex, id: ann.id });
        // Radio/checkbox stay armed for placing several in a row.
        if (!meta.small) app.setTool("select");
        setDraft(null);
        setInkPoints([]);
        return;
      }

      // Arrows and callouts accept any drag direction (including pure
      // horizontal / vertical), unlike box tools which need a real area.
      if ((app.tool === "arrow" || app.tool === "callout") && (w > 3 || h > 3)) {
        const bw = Math.max(1, w);
        const bh = Math.max(1, h);
        const frac = (v: number, min: number, span: number) =>
          Math.max(0, Math.min(1, (v - min) / span));
        const arrow: ShapeAnnotation = {
          id: uid(),
          kind: "arrow",
          x,
          y,
          w: bw,
          h: bh,
          color: app.toolColor,
          strokeWidth: app.strokeWidth,
          // Tail at the drag start, head at the drag end…
          ax: frac(draft.x0, x, bw),
          ay: frac(draft.y0, y, bh),
          bx: frac(draft.x1, x, bw),
          by: frac(draft.y1, y, bh),
        };
        if (app.tool === "callout") {
          // …except for callouts, where the drag STARTS on the target: the
          // head points there and the text box sits at the drag end.
          [arrow.ax, arrow.ay, arrow.bx, arrow.by] = [arrow.bx, arrow.by, arrow.ax, arrow.ay];
          const groupId = uid();
          arrow.groupId = groupId;
          const text: TextAnnotation = {
            id: uid(),
            kind: "text",
            groupId,
            x: draft.x1,
            y: draft.y1 - app.fontSize,
            w: 180,
            h: app.fontSize * 2,
            text: "",
            fontSize: app.fontSize,
            color: app.fontColor,
            fontFamily: app.fontFamily,
            align: app.textAlign,
            lineHeight: app.lineHeight,
            letterSpacing: app.letterSpacing,
          };
          app.addAnnotations(pageIndex, [arrow, text]);
          app.setSelected({ page: pageIndex, id: text.id });
        } else {
          app.addAnnotation(pageIndex, arrow);
          app.setSelected({ page: pageIndex, id: arrow.id });
        }
        app.setTool("select");
        setDraft(null);
        setInkPoints([]);
        return;
      }

      // A line accepts any drag direction (including pure horizontal /
      // vertical), like arrows. The box branch below needs BOTH dimensions,
      // so a straight line — where one dimension is ~0 — would be dropped.
      // Clamp the box to a minimum of 1 so the on-screen SVG stroke keeps a
      // real thickness (a 0-height box collapses the stroke to nothing).
      if (app.tool === "line" && (w > 3 || h > 3)) {
        app.addAnnotation(pageIndex, {
          id: uid(),
          kind: "line",
          x,
          y,
          w: Math.max(1, w),
          h: Math.max(1, h),
          color: app.toolColor,
          strokeWidth: app.strokeWidth,
          // Keep the drag's diagonal direction — the box alone can't tell
          // "\" from "/" (both normalize to the same rect).
          down: (draft.x1 - draft.x0) * (draft.y1 - draft.y0) > 0,
        });
        setDraft(null);
        setInkPoints([]);
        return;
      }

      if (w > 3 && h > 3) {
        const base = { id: uid(), x, y, w, h };
        if (app.tool === "highlight") {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: "highlight",
            color: app.highlightColor,
          });
        } else if (
          app.tool === "underline" ||
          app.tool === "strikeout" ||
          app.tool === "squiggly"
        ) {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: "markup",
            style: app.tool,
            color: MARKUP_COLORS[app.tool],
          });
        } else if (app.tool === "whiteout") {
          app.addAnnotation(pageIndex, { ...base, kind: "whiteout" });
          warnWhiteoutOnce();
        } else if (app.tool === "redact") {
          app.addAnnotation(pageIndex, { ...base, kind: "redact" });
        } else if (app.tool === "rect" || app.tool === "ellipse") {
          app.addAnnotation(pageIndex, {
            ...base,
            kind: app.tool,
            color: app.toolColor,
            strokeWidth: app.strokeWidth,
            ...(app.toolFill ? { fill: app.toolFill } : {}),
          });
        }
      }
    }
    setDraft(null);
    setInkPoints([]);
  };

  const interactive =
    drawingTool ||
    app.tool === "text" ||
    app.tool === "note" ||
    !!app.pendingStamp ||
    app.tool === "select";

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{
        pointerEvents: interactive && (drawingTool || app.tool === "text" || app.tool === "note" || app.pendingStamp) ? "auto" : "none",
        // Prevent the page from scrolling under a drawing/placement gesture.
        touchAction: drawingTool || app.pendingStamp ? "none" : "auto",
        cursor: app.pendingStamp
          ? "copy"
          : app.tool === "text"
            ? "text"
            : app.tool === "note"
              ? "copy"
              : app.tool === "ink"
                ? PENCIL_CURSOR
                : drawingTool
                  ? "crosshair"
                  : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* form-builder grid (design aid only — never printed or saved) */}
      {app.formBuilder && app.gridEnabled && !app.formPreview && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(99,102,241,0.13) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.13) 1px, transparent 1px)",
            backgroundSize: `${app.gridSize * scale}px ${app.gridSize * scale}px`,
          }}
        />
      )}

      {anns.map((ann) => (
        <AnnotationItem
          key={ann.id}
          ann={ann}
          pageIndex={pageIndex}
          scale={scale}
          baseDims={baseDims}
        />
      ))}

      {/* alignment guides while a field snaps to its neighbors */}
      {app.snapGuides?.page === pageIndex && (
        <>
          {app.snapGuides.v.map((x, i) => (
            <div
              key={`v${i}`}
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-pink-500/80"
              style={{ left: x * scale }}
            />
          ))}
          {app.snapGuides.h.map((y, i) => (
            <div
              key={`h${i}`}
              className="pointer-events-none absolute left-0 right-0 h-px bg-pink-500/80"
              style={{ top: y * scale }}
            />
          ))}
        </>
      )}

      {/* live draft shape — matches the tool being drawn */}
      {draft && (app.tool === "line" || app.tool === "arrow" || app.tool === "callout") && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <line
            x1={draft.x0 * scale}
            y1={draft.y0 * scale}
            x2={draft.x1 * scale}
            y2={draft.y1 * scale}
            stroke={app.toolColor}
            strokeWidth={app.strokeWidth * scale}
            strokeLinecap="round"
            strokeDasharray="5 4"
          />
        </svg>
      )}
      {draft && app.tool !== "line" && app.tool !== "arrow" && app.tool !== "callout" && (
        <div
          className={cn(
            "absolute border-2 border-dashed",
            app.tool === "ellipse" && "rounded-[50%]",
          )}
          style={{
            left: Math.min(draft.x0, draft.x1) * scale,
            top: Math.min(draft.y0, draft.y1) * scale,
            width: Math.abs(draft.x1 - draft.x0) * scale,
            height: Math.abs(draft.y1 - draft.y0) * scale,
            borderColor:
              app.tool === "highlight"
                ? app.highlightColor
                : app.tool === "underline" || app.tool === "strikeout" || app.tool === "squiggly"
                  ? MARKUP_COLORS[app.tool]
                  : app.tool === "whiteout"
                    ? "#94a3b8"
                    : app.tool === "redact"
                      ? "#dc2626"
                      : app.toolColor,
            background:
              app.tool === "highlight"
                ? `${app.highlightColor}4d`
                : app.tool === "whiteout"
                  ? "rgba(255,255,255,0.8)"
                  : app.tool === "redact"
                    ? "rgba(0,0,0,0.85)"
                    : "transparent",
          }}
        />
      )}
      {inkPoints.length > 1 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${baseDims.width} ${baseDims.height}`}
        >
          <polyline
            points={inkPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={app.toolColor}
            strokeWidth={app.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NoteEditor({
  ann,
  draftRef,
  onPatch,
  onDelete,
}: {
  ann: NoteAnnotation;
  /** Live draft, readable by AnnotationItem when the popover is dismissed
   *  before blur can commit (outside-press closes on pointerdown). */
  draftRef: React.MutableRefObject<string | null>;
  onPatch: (p: Partial<Annotation>) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(ann.text);

  return (
    <div className="flex w-60 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Comment
        </span>
        <div className="flex items-center gap-1">
          <ColorSwatch
            value={ann.color}
            onChange={(v) => onPatch({ color: v } as Partial<Annotation>)}
            title="Marker color"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Delete comment"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        autoFocus={!ann.text}
        rows={3}
        value={text}
        placeholder="Write a comment…"
        className="min-h-16 text-xs"
        onChange={(e) => {
          setText(e.target.value);
          draftRef.current = e.target.value;
        }}
        onBlur={() => {
          if (!text.trim()) {
            if (ann.text) onDelete();
          } else if (text !== ann.text) {
            onPatch({ text } as Partial<Annotation>);
          }
        }}
      />
    </div>
  );
}

function AnnotationItem({
  ann,
  pageIndex,
  scale,
  baseDims,
}: {
  ann: Annotation;
  pageIndex: number;
  scale: number;
  baseDims: PageDims;
}) {
  const app = useApp();
  const isSelected =
    app.selected?.page === pageIndex && app.selected?.id === ann.id;
  // Form-builder state for this annotation: live-preview inputs and
  // multi-selection membership.
  const previewing =
    ann.kind === "formfield" && app.formBuilder && app.formPreview;
  const isMulti =
    ann.kind === "formfield" &&
    app.multiSelected?.page === pageIndex &&
    app.multiSelected.ids.includes(ann.id) &&
    app.multiSelected.ids.length > 1;
  const [editing, setEditing] = useState(
    ann.kind === "text" && ann.text === "",
  );
  // Tracks whether the box has any typed content, updated live from the
  // editor's onChange (ann.text itself only updates on commit) —
  // drives the "empty placeholder" look (dashed border, hint text, handles).
  const [hasContent, setHasContent] = useState(
    ann.kind !== "text" || !!ann.text.trim(),
  );

  // Commit the comment draft when the note is deselected — the popover can
  // be dismissed on pointerDOWN, before the textarea's blur ever fires, so
  // blur alone loses text typed right before clicking away. An empty note
  // is dropped instead. (Transition-based, not unmount-based: StrictMode
  // remounts must not delete a note the user is about to type into.)
  const wasSelected = useRef(isSelected);
  const selectedAt = useRef(0);
  const noteDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSelected) selectedAt.current = performance.now();
    if (wasSelected.current && !isSelected && ann.kind === "note") {
      const draft = noteDraftRef.current;
      noteDraftRef.current = null;
      const finalText = draft ?? ann.text;
      if (!finalText.trim()) {
        app.removeAnnotation(pageIndex, ann.id);
      } else if (finalText !== ann.text) {
        app.updateAnnotation(pageIndex, { ...ann, text: finalText });
      }
    }
    wasSelected.current = isSelected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected]);

  // Open the editor when requested externally (e.g. "edit existing text").
  useEffect(() => {
    if (app.editRequestId === ann.id && ann.kind === "text") {
      setEditing(true);
      app.setEditRequestId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.editRequestId, ann.id, ann.kind]);

  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Rotation while the rotate handle is being dragged (committed on release).
  const [liveRot, setLiveRot] = useState<number | null>(null);
  // While editing, the box auto-grows to fit the typed text (RichTextEditor
  // reports run changes via onRunsChange → measureRichText).
  const [editSize, setEditSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const lastDownAt = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const maxTextWidth = Math.max(40, baseDims.width - ann.x - 2);

  // Seed / clear the auto-grow size as editing toggles.
  useEffect(() => {
    if (editing && ann.kind === "text") {
      setEditSize(measureBlocks(ann, getBlocks(ann), maxTextWidth));
    } else {
      setEditSize(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const box =
    live ??
    (editing && editSize ? { ...ann, w: editSize.w, h: editSize.h } : ann);

  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    // While reading, clicking a comment marker just opens its popup.
    if (ann.kind === "note" && app.tool === "read") {
      e.stopPropagation();
      e.preventDefault();
      app.setSelected({ page: pageIndex, id: ann.id });
      return;
    }
    // Clicking an existing highlight / markup with its own tool armed SELECTS
    // it (the contextual row then shows a color swatch + delete), so the mark
    // can be recolored or removed deliberately — not deleted on a stray click.
    // (Quick removal still lives on the eraser and the Delete key.)
    if (
      (ann.kind === "highlight" && app.tool === "highlight") ||
      (ann.kind === "markup" &&
        ["underline", "strikeout", "squiggly"].includes(app.tool))
    ) {
      e.stopPropagation();
      e.preventDefault();
      app.setSelected({ page: pageIndex, id: ann.id });
      return;
    }
    // Eraser removes whatever element is clicked, regardless of kind.
    if (app.tool === "eraser") {
      e.stopPropagation();
      e.preventDefault();
      app.removeAnnotation(pageIndex, ann.id);
      return;
    }
    // Live preview: fields act as real inputs, not draggable designer boxes.
    if (previewing) return;
    if (app.tool !== "select") return;
    // Shift-click builds a multi-selection of form fields.
    if (ann.kind === "formfield" && e.shiftKey) {
      e.stopPropagation();
      e.preventDefault();
      app.toggleMultiSelected(pageIndex, ann.id);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    app.setSelected({ page: pageIndex, id: ann.id });

    // Canceling pointerdown suppresses the browser's dblclick, so detect
    // double-press by timing to open the text editor.
    const now = performance.now();
    const isDouble = mode === "move" && now - lastDownAt.current < 400;
    lastDownAt.current = now;
    if (isDouble && ann.kind === "text") {
      setEditing(true);
      return;
    }
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: ann.x, y: ann.y, w: ann.w, h: ann.h },
    };
    // Form-builder aids: snap candidates on this page, and (when the pressed
    // field is part of a multi-selection) the ids that drag along with it.
    const isField = ann.kind === "formfield";
    const groupIds =
      isField &&
      mode === "move" &&
      app.multiSelected &&
      app.multiSelected.page === pageIndex &&
      app.multiSelected.ids.includes(ann.id) &&
      app.multiSelected.ids.length > 1
        ? app.multiSelected.ids
        : null;
    // Text blocks snap to other annotations (their edges/centres and the page
    // centre) so they line up easily; form fields keep their existing
    // form-builder-gated snapping. Alt suspends snapping for fine positioning.
    const snapText = ann.kind === "text";
    const snapField = isField && app.formBuilder;
    const canSnap = snapText || snapField;
    const snapOthers = !canSnap
      ? []
      : (app.annotations[pageIndex] ?? []).filter(
          (a) =>
            a.id !== ann.id &&
            !groupIds?.includes(a.id) &&
            a.kind !== "note" && // point markers, not alignable blocks
            (snapField ? a.kind === "formfield" : true),
        );
    const snapOpts = {
      snap: snapText || (snapField && app.snapEnabled),
      grid: snapField && app.gridEnabled,
      gridSize: app.gridSize,
      threshold: 6 / scale,
    };
    const pageBox = { w: baseDims.width, h: baseDims.height };
    let finalBox: { x: number; y: number; w: number; h: number } | null = null;
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / scale;
      const dy = (ev.clientY - d.startY) / scale;
      if (d.mode === "move") {
        let next = { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy };
        // Alt suspends snapping for fine positioning.
        if (canSnap && !ev.altKey) {
          const s = snapMovingRect(next, snapOthers, pageBox, snapOpts);
          next = { ...next, x: s.x, y: s.y };
          app.setSnapGuides(
            s.v.length || s.h.length ? { page: pageIndex, v: s.v, h: s.h } : null,
          );
        }
        finalBox = next;
        if (groupIds) {
          app.setGroupDrag({
            page: pageIndex,
            ids: groupIds,
            dx: next.x - d.orig.x,
            dy: next.y - d.orig.y,
          });
        }
      } else if (ann.kind === "image") {
        // Images keep their aspect ratio while resizing.
        const w = Math.max(8, d.orig.w + dx);
        finalBox = { ...d.orig, w, h: Math.max(8, w * (d.orig.h / d.orig.w)) };
      } else {
        let next = {
          ...d.orig,
          w: Math.max(8, d.orig.w + dx),
          h: Math.max(8, d.orig.h + dy),
        };
        if (canSnap && !ev.altKey) {
          const s = snapResizingRect(next, snapOthers, pageBox, snapOpts);
          next = { ...next, w: s.w, h: s.h };
          app.setSnapGuides(
            s.v.length || s.h2.length
              ? { page: pageIndex, v: s.v, h: s.h2 }
              : null,
          );
        }
        finalBox = next;
      }
      setLive(finalBox);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Commit outside the state updater — updating the store from within
      // one triggers React's setState-during-render warning.
      if (finalBox) {
        if (groupIds) {
          // The whole selection moves in one undo step.
          app.translateAnnotations(
            pageIndex,
            groupIds,
            finalBox.x - ann.x,
            finalBox.y - ann.y,
          );
        } else {
          app.updateAnnotation(pageIndex, { ...ann, ...finalBox });
        }
      }
      if (isField) app.setGroupDrag(null);
      if (canSnap) app.setSnapGuides(null);
      setLive(null);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Drag the rotate handle: angle from the box center to the pointer, with
  // soft snapping to 15° steps (Shift forces the snap).
  const beginRotate = (e: React.PointerEvent) => {
    if (app.tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    // getBoundingClientRect of a rotated element is its AABB — the center is
    // still the true rotation center.
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let current: number | null = null;
    const onMove = (ev: PointerEvent) => {
      // Handle sits above the top edge, so straight up = 0°.
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      const snapped = Math.round(a / 15) * 15;
      if (ev.shiftKey || Math.abs(a - snapped) < 4) a = snapped;
      current = ((a % 360) + 360) % 360;
      setLiveRot(current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Commit outside the state updater — updating the store from within
      // one triggers React's setState-during-render warning.
      if (current !== null) {
        app.updateAnnotation(pageIndex, {
          ...ann,
          rotation: current === 0 ? undefined : current,
        });
      }
      setLiveRot(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Comment markers stay clickable while reading (comments are for readers
  // too); with a highlight/markup tool armed, clicking an existing mark of
  // that kind selects it so it can be recolored or deleted; the eraser removes
  // any element it touches; everything else needs the Select tool.
  const selectable = app.tool === "select" && !ann.locked;
  const noteInRead = ann.kind === "note" && app.tool === "read" && !ann.locked;
  const editMarkArmed =
    ((ann.kind === "highlight" && app.tool === "highlight") ||
      (ann.kind === "markup" &&
        ["underline", "strikeout", "squiggly"].includes(app.tool))) &&
    !ann.locked;
  const erasable = app.tool === "eraser" && !ann.locked;
  // While a multi-selection drags, the other members preview the same offset.
  const gd = app.groupDrag;
  const groupOffset =
    gd && gd.page === pageIndex && gd.ids.includes(ann.id) && !live
      ? { x: gd.dx, y: gd.dy }
      : { x: 0, y: 0 };
  const rotationDeg = liveRot ?? ann.rotation ?? 0;
  const style: React.CSSProperties = {
    position: "absolute",
    left: (box.x + groupOffset.x) * scale,
    top: (box.y + groupOffset.y) * scale,
    width: box.w * scale,
    height: box.h * scale,
    transform: rotationDeg ? `rotate(${rotationDeg}deg)` : undefined,
    transformOrigin: "center",
    pointerEvents: selectable || noteInRead || editMarkArmed || erasable ? "auto" : "none",
    cursor: selectable
      ? "move"
      : noteInRead || editMarkArmed || erasable
        ? "pointer"
        : "default",
    touchAction: selectable || erasable ? "none" : "auto",
  };

  let body: React.ReactNode = null;
  switch (ann.kind) {
    case "note":
      body = (
        <div
          className="flex h-full w-full items-center justify-center"
          title={ann.text || "Comment"}
        >
          <MessageSquare
            className="h-full w-full drop-shadow-sm"
            style={{ color: ann.color }}
            fill="currentColor"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
        </div>
      );
      break;
    case "highlight":
      body = (
        <div
          className="h-full w-full"
          style={{ background: ann.color, opacity: 0.35 }}
        />
      );
      break;
    case "markup": {
      const mw = Math.max(1, box.w);
      const mh = Math.max(1, box.h);
      const t = Math.max(0.75, mh * 0.06);
      body = (
        <svg
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox={`0 0 ${mw} ${mh}`}
        >
          {ann.style === "squiggly" ? (
            <path
              d={squigglyPath(mw, mh * 0.95, Math.max(1.2, mh * 0.14), Math.max(2.4, mh * 0.22))}
              fill="none"
              stroke={ann.color}
              strokeWidth={t}
              strokeLinejoin="round"
            />
          ) : (
            <line
              x1={0}
              x2={mw}
              y1={ann.style === "underline" ? mh * 0.92 : mh * 0.55}
              y2={ann.style === "underline" ? mh * 0.92 : mh * 0.55}
              stroke={ann.color}
              strokeWidth={ann.style === "underline" ? t : Math.max(1, mh * 0.08)}
            />
          )}
        </svg>
      );
      break;
    }
    case "whiteout":
      body = (
        <div
          className="h-full w-full"
          style={{ background: ann.color ?? "#ffffff" }}
        />
      );
      break;
    case "redact":
      // Pending redaction: solid black fill (previews the result) with a red
      // dashed outline so it reads as "marked, not yet applied".
      body = (
        <div
          className="h-full w-full bg-black"
          style={{ outline: `${Math.max(1, scale)}px dashed #dc2626`, outlineOffset: "-1px" }}
        />
      );
      break;
    case "rect":
      body = (
        <div
          className="h-full w-full"
          style={{
            border: ann.strokeWidth > 0 ? `${ann.strokeWidth * scale}px solid ${ann.color}` : undefined,
            backgroundColor: ann.fill,
          }}
        />
      );
      break;
    case "ellipse":
      body = (
        <div
          className="h-full w-full rounded-[50%]"
          style={{
            border: ann.strokeWidth > 0 ? `${ann.strokeWidth * scale}px solid ${ann.color}` : undefined,
            backgroundColor: ann.fill,
          }}
        />
      );
      break;
    case "line":
      body = (
        <svg className="h-full w-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${Math.max(1, box.w)} ${Math.max(1, box.h)}`}>
          <line
            x1={0}
            y1={ann.down ? 0 : box.h}
            x2={box.w}
            y2={ann.down ? box.h : 0}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
        </svg>
      );
      break;
    case "arrow": {
      const aw = Math.max(1, box.w);
      const ah = Math.max(1, box.h);
      const x1 = (ann.ax ?? 0) * aw;
      const y1 = (ann.ay ?? 0) * ah;
      const x2 = (ann.bx ?? 1) * aw;
      const y2 = (ann.by ?? 1) * ah;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(6, ann.strokeWidth * 3.5);
      const spread = Math.PI / 7;
      const hx1 = x2 - headLen * Math.cos(angle - spread);
      const hy1 = y2 - headLen * Math.sin(angle - spread);
      const hx2 = x2 - headLen * Math.cos(angle + spread);
      const hy2 = y2 - headLen * Math.sin(angle + spread);
      body = (
        <svg
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox={`0 0 ${aw} ${ah}`}
        >
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.color} strokeWidth={ann.strokeWidth} strokeLinecap="round" />
          <polyline
            points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`}
            fill="none"
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
      break;
    }
    case "ink":
      body = (
        <svg
          className="h-full w-full overflow-visible"
          viewBox={`0 0 ${Math.max(1, ann.w)} ${Math.max(1, ann.h)}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={ann.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
      break;
    case "image":
      body = (
        <img
          src={ann.dataUrl}
          alt="stamp"
          className="h-full w-full select-none object-contain"
          draggable={false}
        />
      );
      break;
    case "formfield": {
      if (previewing) {
        // Live preview (form builder): a real, fillable input.
        body = <FieldPreviewInput ann={ann} scale={scale} />;
      } else if (app.editMode) {
        // Designer look while editing: dashed outline + field name.
        const label =
          ann.fieldType === "radio"
            ? `${ann.fieldName} · ${ann.optionValue}`
            : ann.fieldName;
        body = (
          <div
            className="relative h-full w-full rounded-[3px]"
            style={{
              // Dashed violet = "designer object" marker; the box itself
              // shows the real border/background it will have when saved.
              outline: "2px dashed rgba(139, 92, 246, 0.7)",
              outlineOffset: 1.5,
              ...fieldWidgetCss(ann, scale),
              backgroundColor:
                ann.backgroundColor ?? "rgba(139, 92, 246, 0.05)",
            }}
          >
            <span className="absolute -top-[15px] left-0 whitespace-nowrap text-[9px] font-medium leading-none text-violet-600">
              {label}
            </span>
            {ann.fieldType === "dropdown" && (
              <span className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[9px] text-violet-500">
                ▾
              </span>
            )}
            {ann.fieldType === "radio" && (
              <span className="absolute inset-1 rounded-full border border-violet-400/60" />
            )}
            {ann.fieldType === "date" && (
              <Calendar className="absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-violet-500/80" />
            )}
            {ann.fieldType === "signature" && (
              <>
                <PenLine className="absolute left-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-violet-500/70" />
                <span className="absolute bottom-1.5 left-6 right-2 border-b border-violet-400/60" />
              </>
            )}
            {ann.fieldType === "button" && (
              <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] font-medium text-violet-600">
                {ann.buttonCaption ?? ann.fieldName}
              </span>
            )}
          </div>
        );
      } else {
        // View mode: preview exactly like the fillable field it becomes on save.
        body = (
          <div
            className={cn(
              "relative h-full w-full",
              ann.fieldType === "radio" ? "rounded-full" : "rounded-[2px]",
            )}
            style={{
              ...fieldWidgetCss(ann, scale),
              backgroundColor:
                ann.backgroundColor ??
                (ann.fieldType === "button"
                  ? "rgba(203, 213, 225, 0.4)"
                  : "rgba(56, 189, 248, 0.1)"),
            }}
          >
            {ann.fieldType === "dropdown" && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-500">
                ▾
              </span>
            )}
            {ann.fieldType === "date" && (
              <Calendar className="absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
            )}
            {ann.fieldType === "signature" && (
              <span className="absolute bottom-1.5 left-2 right-2 border-b border-slate-400/70" />
            )}
            {ann.fieldType === "button" && (
              <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] font-medium text-slate-600">
                {ann.buttonCaption ?? ann.fieldName}
              </span>
            )}
          </div>
        );
      }
      break;
    }
    case "text": {
      const textAnn = ann;
      body = editing ? (
        <BlockTextEditor
          ann={textAnn}
          scale={scale}
          style={{ ...textSpacingStyle(textAnn, scale), textAlign: textAnn.align ?? "left" }}
          onChange={(blocks) => setHasContent(blocksHaveText(blocks))}
          onSize={(h) => setEditSize({ w: textAnn.w, h })}
          onCommit={(blocks, focusTo) => {
            // Focus moving to a style control (popover or toolbar) means the
            // user is styling, not finishing — commit text, keep editing.
            const toControls =
              focusTo?.closest?.("[data-ann-controls]") ??
              document.activeElement?.closest("[data-ann-controls]");
            if (!blocksHaveText(blocks)) {
              if (!toControls) {
                setEditing(false);
                app.removeAnnotation(pageIndex, ann.id);
              }
              return;
            }
            const size = measureBlocks(textAnn, blocks, maxTextWidth);
            app.updateAnnotation(pageIndex, {
              ...textAnn,
              text: blocksPlainText(blocks),
              blocks,
              runs: undefined,
              w: size.w,
              h: size.h,
            });
            if (!toControls) setEditing(false);
          }}
        />
      ) : (
        <div
          className="richtext-blocks h-full w-full break-words"
          style={{ ...textSpacingStyle(textAnn, scale), textAlign: textAnn.align ?? "left" }}
          dangerouslySetInnerHTML={{
            __html: blocksToSemanticHtml(getBlocks(textAnn), textAnn, scale),
          }}
        />
      );
      break;
    }
  }

  // Text boxes keep one consistent dashed look — hovering, selected, blank,
  // mid-type, or re-selected later all look the same; only the placeholder
  // hint is specific to the still-blank state.
  const isTextSelected = ann.kind === "text" && isSelected;
  const isEmptyText = ann.kind === "text" && editing && !hasContent;

  return (
    <div
      ref={wrapRef}
      style={style}
      className={cn(
        isTextSelected
          ? "rounded-md border-2 border-dashed border-blue-400"
          : (isSelected || isMulti) &&
              !previewing &&
              "ring-2 ring-blue-500 ring-offset-1",
        isEmptyText && "bg-blue-50/40",
        erasable && "hover:ring-2 hover:ring-red-400/80",
        !isSelected &&
          !erasable &&
          (ann.kind === "text"
            ? selectable && "hover:rounded-md hover:border-2 hover:border-dashed hover:border-blue-400/60"
            : (selectable || noteInRead) && "hover:ring-1 hover:ring-blue-400/60"),
      )}
      onPointerDown={(e) => beginDrag(e, "move")}
      onPointerEnter={(e) => {
        // Drag-erase: sweeping across elements with the button held removes
        // each one entered (the pointerdown already removed the first).
        if (erasable && e.buttons & 1) app.removeAnnotation(pageIndex, ann.id);
      }}
      onDoubleClick={(e) => {
        if (ann.kind === "text") {
          e.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {isEmptyText && ann.kind === "text" && (
        // Previews the picked color/font/weight so it's obvious *before*
        // typing, not just once the first character lands.
        <div
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2 opacity-45"
          style={{
            color: ann.color,
            fontSize: ann.fontSize * scale,
            fontFamily: ann.displayFontCss || FONT_CSS[ann.fontFamily ?? "helvetica"],
            fontWeight: ann.bold ? 700 : 400,
            fontStyle: ann.italic ? "italic" : "normal",
            letterSpacing: (ann.letterSpacing ?? 0) * scale,
            textDecoration:
              [ann.underline && "underline", ann.strike && "line-through"]
                .filter(Boolean)
                .join(" ") || "none",
          }}
        >
          Start typing here…
        </div>
      )}
      {body}
      {isSelected && !previewing && ann.kind !== "note" && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          onPointerDown={(e) => beginDrag(e, "resize")}
        />
      )}
      {isSelected && ROTATABLE_KINDS.has(ann.kind) && (
        <>
          {/* stem + grab-knob above the top edge; rotates with the element */}
          <div className="pointer-events-none absolute -top-5 left-1/2 h-5 w-px -translate-x-1/2 bg-blue-400/80" />
          <div
            title="Drag to rotate (Shift snaps to 15°)"
            className="absolute -top-6 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-white bg-blue-500 active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={beginRotate}
          />
        </>
      )}
      {ann.kind === "formfield" && !previewing && (
        <Popover
          open={isSelected}
          onOpenChange={(o: boolean) => {
            if (!o) app.setSelected(null);
          }}
        >
          <PopoverContent
            anchor={wrapRef}
            side="right"
            align="start"
            sideOffset={12}
            className="scrollbar-soft max-h-[72vh] w-64 space-y-2 overflow-y-auto p-2.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isMulti ? (
              <MultiFieldTools page={pageIndex} />
            ) : (
              <FieldProperties
                ann={ann}
                onPatch={(p) =>
                  app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
                }
              />
            )}
          </PopoverContent>
        </Popover>
      )}
      {ann.kind === "note" && !ann.locked && (
        <Popover
          // Comments keep their own popup (you type the note text in it). Every
          // other annotation's style controls now live in the toolbar's second
          // row, so no floating properties popover for them.
          open={isSelected}
          onOpenChange={(o: boolean, details?: { reason?: string; event?: Event }) => {
            if (o) return;
            const age = performance.now() - selectedAt.current;
            if (import.meta.env.DEV) {
              // Debug trace for popover dismissal issues.
              console.debug(
                `[${ann.kind}] popover close — reason: ${details?.reason ?? "?"}, ${Math.round(age)}ms after open`,
              );
            }
            const pressLike =
              details?.reason === "outside-press" || details?.reason === "focus-out";
            if (pressLike) {
              const target = details?.event?.target as HTMLElement | null;
              // Interacting with the annotation itself (caret moves in the
              // text editor, dragging the box) or with any style-controls
              // surface (top toolbar) must not dismiss the popover.
              if (
                target &&
                (wrapRef.current?.contains(target) || target.closest?.("[data-ann-controls]"))
              ) {
                return;
              }
              // The trusted click that finishes placing/selecting lands
              // outside the freshly-mounted popup — ignore that tail.
              if (age < 500) return;
            }
            app.setSelected(null);
          }}
        >
          <PopoverContent
            data-ann-controls
            anchor={wrapRef}
            side="top"
            align="start"
            sideOffset={10}
            className="flex flex-wrap items-center gap-2 px-2 py-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <NoteEditor
              ann={ann}
              draftRef={noteDraftRef}
              onPatch={(p) =>
                app.updateAnnotation(pageIndex, { ...ann, ...p } as Annotation)
              }
              onDelete={() => app.removeAnnotation(pageIndex, ann.id)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

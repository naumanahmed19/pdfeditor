import {
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  Bold,
  ChevronDown,
  Circle,
  Copy,
  Eraser,
  FormInput,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Lock,
  MessageSquare,
  MessageSquareQuote,
  Minus,
  MousePointer2,
  Move,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Redo2,
  RotateCw,
  Signature,
  SquareSlash,
  Square,
  Stamp,
  Strikethrough,
  TextCursorInput,
  Trash2,
  Type,
  Underline,
  Undo2,
  Waves,
} from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { ColorSwatch } from "../ui/color-swatch";
import {
  ColorPresets,
  FillControl,
  FONT_OPTIONS,
  FONT_SIZES,
  HIGHLIGHT_PRESETS,
  INK_PRESETS,
  SizePresets,
  StrokeWidthSelect,
  StyleToggle,
  TextStyleControls,
} from "./StyleControls";
import { activeTextEditor } from "../../lib/activeTextEditor";
import { activeInlineEdit } from "../../lib/activeInlineEdit";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { Separator } from "../ui/separator";
import { Tip, TooltipProvider } from "../ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { cn, ROTATABLE_KINDS } from "../../lib/utils";
import { STAMPS, makeStamp } from "../../lib/stamps";
import type {
  Annotation,
  FontFamilyKind,
  FormFieldAnnotation,
  ShapeAnnotation,
  TextAnnotation,
  ToolKind,
} from "../../types";

/** Tools in display order; `group` boundaries render as thin separators. */
const TOOLS: Array<{
  key: ToolKind;
  icon: typeof Type;
  name: string;
  desc: string;
  group: number;
  shortcut?: string;
}> = [
  { key: "read", icon: MousePointer2, name: "Read", desc: "Select & copy text, follow links", group: 0, shortcut: "V" },
  { key: "pan", icon: Hand, name: "Pan", desc: "Drag to scroll the page", group: 0 },
  { key: "select", icon: Move, name: "Move / edit objects", desc: "Drag existing text & images; Delete to remove", group: 0, shortcut: "M" },
  { key: "text", icon: Type, name: "Add text", desc: "Click the page to place a text box", group: 1, shortcut: "T" },
  { key: "edittext", icon: TextCursorInput, name: "Edit existing text", desc: "Click a line of the document to retype it", group: 1, shortcut: "E" },
  { key: "highlight", icon: Highlighter, name: "Highlight", desc: "Text mode: drag over text. Area mode: drag a box over any region. Click a highlight to recolor or delete it", group: 2, shortcut: "H" },
  { key: "underline", icon: Underline, name: "Underline text", desc: "Drag over text to mark it; click a mark to recolor or delete it", group: 2, shortcut: "U" },
  { key: "strikeout", icon: Strikethrough, name: "Strike through text", desc: "Drag over text to mark it; click a mark to recolor or delete it", group: 2, shortcut: "S" },
  { key: "squiggly", icon: Waves, name: "Squiggly underline", desc: "Drag over text to mark it; click a mark to recolor or delete it", group: 2 },
  { key: "note", icon: MessageSquare, name: "Comment", desc: "Click the page to add a sticky note", group: 2, shortcut: "C" },
  { key: "ink", icon: Pencil, name: "Draw freehand", desc: "Pen strokes in the chosen color & size", group: 2, shortcut: "D" },
  { key: "rect", icon: Square, name: "Rectangle", desc: "Drag to draw; fill optional", group: 3, shortcut: "R" },
  { key: "ellipse", icon: Circle, name: "Ellipse", desc: "Drag to draw; fill optional", group: 3, shortcut: "O" },
  { key: "line", icon: Minus, name: "Line", desc: "Drag from start to end", group: 3, shortcut: "L" },
  { key: "arrow", icon: MoveUpRight, name: "Arrow", desc: "Drag from tail to head", group: 3, shortcut: "A" },
  { key: "callout", icon: MessageSquareQuote, name: "Callout", desc: "Drag from the target to where the note should sit", group: 3, shortcut: "K" },
  { key: "whiteout", icon: PaintBucket, name: "Whiteout", desc: "Cover page content with a filled box (hides, does not remove)", group: 4, shortcut: "W" },
  { key: "eraser", icon: Eraser, name: "Eraser", desc: "Click or drag across an annotation you added to delete it" , group: 4 },
  { key: "redact", icon: SquareSlash, name: "Redact", desc: "Permanently removes covered content — draw boxes, then Apply", group: 4, shortcut: "X" },
];

/**
 * Horizontally scrollable row: instead of wrapping onto a second line when it
 * overflows (narrow screens), the content stays on one line and can be
 * scrolled by wheel, touch, or click-and-drag ("slide"). A drag past a small
 * threshold scrolls and swallows the trailing click so buttons aren't
 * accidentally toggled mid-slide.
 */
function DragScroll({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useRef({ down: false, moved: false, startX: 0, startLeft: 0 });

  return (
    <div
      ref={ref}
      // scrollbar-none: no visible bar, but wheel/touch/drag still scroll.
      // [&>*]:shrink-0 keeps every item at its natural width so the row
      // overflows (and scrolls) instead of squishing controls.
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-x-auto [&>*]:shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      onWheel={(e) => {
        const el = ref.current;
        if (el && el.scrollWidth > el.clientWidth && e.deltaY !== 0) {
          el.scrollLeft += e.deltaY;
        }
      }}
      onPointerDown={(e) => {
        const el = ref.current;
        if (!el || e.button !== 0) return;
        st.current = { down: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft };
      }}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || !st.current.down) return;
        // Self-heal if the button was released off-element (no pointerup fired):
        // a plain hover carries no buttons, so it must never scroll.
        if (e.buttons === 0) {
          st.current.down = false;
          return;
        }
        const dx = e.clientX - st.current.startX;
        if (!st.current.moved && Math.abs(dx) > 5) {
          st.current.moved = true;
          el.setPointerCapture?.(e.pointerId);
          el.style.cursor = "grabbing";
        }
        if (st.current.moved) el.scrollLeft = st.current.startLeft - dx;
      }}
      onPointerUp={(e) => {
        const el = ref.current;
        if (el && st.current.moved) {
          el.releasePointerCapture?.(e.pointerId);
          el.style.cursor = "";
          // Cancel the click that would otherwise toggle a button under the pointer.
          const block = (ev: Event) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          el.addEventListener("click", block, { capture: true, once: true });
          setTimeout(
            () => el.removeEventListener("click", block, { capture: true } as EventListenerOptions),
            0,
          );
        }
        st.current.down = false;
      }}
      onPointerCancel={() => {
        st.current.down = false;
        st.current.moved = false;
        if (ref.current) ref.current.style.cursor = "";
      }}
    >
      {children}
    </div>
  );
}

/**
 * Native <select> dressed exactly like the shadcn Select trigger (ui/select).
 * The inline text editor needs NATIVE semantics: the shared Select renders its
 * listbox in a portal, which moves focus out of [data-inline-edit-controls]
 * and would commit the in-place edit prematurely.
 */
function NativeSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        {...props}
        className="h-8 w-full appearance-none truncate rounded-md border border-input bg-background pl-2 pr-7 text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export function EditorToolbar() {
  const app = useApp();
  const imageRef = useRef<HTMLInputElement>(null);

  // Live handle to an in-place "edit existing text" session, so its font /
  // size / color controls render in this toolbar's contextual row.
  useSyncExternalStore(activeInlineEdit.subscribe, activeInlineEdit.getVersion);
  const inlineEdit = activeInlineEdit.current;

  // Re-render as the caret/selection moves inside a rich-text box, so the
  // B/I/U/S/font/size/color controls track the selection's style. Only active
  // while a text box is being edited (activeTextEditor is set).
  const [, bumpSel] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onSel = () => {
      if (activeTextEditor.current) bumpSel();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // Single-key tool shortcuts (V/M/T/E/H/C/D/R/O/L/W/X) — ignored while
  // typing anywhere (inputs, selects, the rich text editor).
  const setToolRef = useRef(app.setTool);
  setToolRef.current = app.setTool;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (activeTextEditor.current) return;
      const tool = TOOLS.find((x) => x.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (tool) {
        e.preventDefault();
        setToolRef.current(tool.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!app.pdf) return null;

  // The tool cluster is a single-select toggle group driven by app.tool
  // (empty while a stamp is pending or a form tool is active).
  const toolValue =
    !app.pendingStamp && TOOLS.some((t) => t.key === app.tool) ? [app.tool] : [];

  const handleToolChange = (values: string[]) => {
    const key = values[0] as ToolKind | undefined;
    if (!key) return; // ignore toggling the active tool off
    if (
      key === "highlight" ||
      key === "underline" ||
      key === "strikeout" ||
      key === "squiggly"
    ) {
      const sel = window.getSelection();
      if (
        sel &&
        !sel.isCollapsed &&
        sel.anchorNode?.parentElement?.closest(".textLayer")
      ) {
        window.dispatchEvent(
          new CustomEvent("pdfwb:highlight-selection", { detail: { style: key } }),
        );
        return;
      }
    }
    app.setTool(key);
    app.setPendingStamp(null);
    if (key !== "select") app.setSelected(null);
  };

  // When a text box is selected, style controls edit it directly.
  const selectedText = (() => {
    if (!app.selected) return null;
    const ann = (app.annotations[app.selected.page] ?? []).find(
      (a) => a.id === app.selected!.id,
    );
    return ann && ann.kind === "text" ? ann : null;
  })();

  const patchSelectedText = (patch: Partial<TextAnnotation>) => {
    if (selectedText && app.selected) {
      app.updateAnnotation(app.selected.page, {
        ...selectedText,
        ...patch,
      } as TextAnnotation);
    }
  };

  const selectedFormField = (() => {
    if (!app.selected) return null;
    const ann = (app.annotations[app.selected.page] ?? []).find(
      (a) => a.id === app.selected!.id,
    );
    return ann && ann.kind === "formfield" ? ann : null;
  })();

  const patchSelectedFormField = (patch: Partial<FormFieldAnnotation>) => {
    if (selectedFormField && app.selected) {
      app.updateAnnotation(app.selected.page, {
        ...selectedFormField,
        ...patch,
      } as FormFieldAnnotation);
    }
  };

  // Any selected annotation (for the selection chip + duplicate/delete).
  const selectedAnn = app.selected
    ? ((app.annotations[app.selected.page] ?? []).find((a) => a.id === app.selected!.id) ?? null)
    : null;

  const KIND_CHIP: Partial<Record<string, { icon: typeof Type; label: string }>> = {
    text: { icon: Type, label: "Text" },
    rect: { icon: Square, label: "Rectangle" },
    ellipse: { icon: Circle, label: "Ellipse" },
    line: { icon: Minus, label: "Line" },
    arrow: { icon: MoveUpRight, label: "Arrow" },
    ink: { icon: Pencil, label: "Drawing" },
    highlight: { icon: Highlighter, label: "Highlight" },
    markup: { icon: Underline, label: "Text markup" },
    note: { icon: MessageSquare, label: "Comment" },
    image: { icon: ImageIcon, label: "Image" },
    whiteout: { icon: Eraser, label: "Whiteout" },
    redact: { icon: SquareSlash, label: "Redaction" },
    formfield: { icon: FormInput, label: "Field" },
  };
  const selectedKind = selectedAnn ? KIND_CHIP[selectedAnn.kind] : undefined;

  // Group-aware (copies a callout's arrow + text together) — lives in the store.
  const duplicateSelected = () => app.duplicateSelectedAnnotation();

  const rotateSelected = () => {
    if (!selectedAnn || !app.selected) return;
    const next = ((selectedAnn.rotation ?? 0) + 90) % 360;
    app.updateAnnotation(app.selected.page, {
      ...selectedAnn,
      rotation: next === 0 ? undefined : next,
    });
  };

  const deleteSelected = () => {
    if (!selectedAnn || !app.selected) return;
    app.removeAnnotation(app.selected.page, selectedAnn.id);
    app.setSelected(null);
  };

  // When a box is being edited, the B/I/U/S/font/size/color controls reflect
  // the CURRENT SELECTION's resolved style (via the active editor), not the
  // box-level style — otherwise a toggle over a run-styled selection would show
  // the wrong state and invert (e.g. can't un-bold a bolded word). `selTick`
  // re-runs this on caret/selection changes. Mixed selections → undefined,
  // shown as "off" so a click sets the whole selection.
  const liveEditor =
    selectedText && activeTextEditor.current?.annId === selectedText.id
      ? activeTextEditor.current
      : null;
  const sel = <K extends "bold" | "italic" | "underline" | "strike">(
    key: K,
    boxVal: boolean,
  ): boolean => (liveEditor ? liveEditor.styleValue(key) ?? false : boxVal);

  const fontFamily =
    (liveEditor?.styleValue("fontFamily")) ??
    selectedText?.fontFamily ??
    app.fontFamily;
  const isBold = sel("bold", selectedText ? !!selectedText.bold : app.fontBold);
  const isItalic = sel("italic", selectedText ? !!selectedText.italic : app.fontItalic);
  const isUnderline = sel("underline", selectedText ? !!selectedText.underline : app.fontUnderline);
  const isStrike = sel("strike", selectedText ? !!selectedText.strike : app.fontStrike);
  const alignValue = selectedText?.align ?? app.textAlign;

  // A selected annotation whose color / stroke / fill the contextual row
  // edits directly (text & notes have their own handling; image/redact have
  // no style). This replaces the old floating properties popover.
  const styleAnn =
    selectedAnn &&
    ["rect", "ellipse", "line", "arrow", "ink", "highlight", "markup", "whiteout"].includes(selectedAnn.kind)
      ? selectedAnn
      : null;
  const styleA = styleAnn as unknown as {
    color?: string;
    strokeWidth?: number;
    fill?: string;
  } | null;
  const styleHasStroke =
    styleAnn?.kind === "rect" ||
    styleAnn?.kind === "ellipse" ||
    styleAnn?.kind === "line" ||
    styleAnn?.kind === "arrow" ||
    styleAnn?.kind === "ink";
  const styleIsFillable = styleAnn?.kind === "rect" || styleAnn?.kind === "ellipse";
  const styleColorLabel =
    styleAnn?.kind === "whiteout" ? "Patch" : styleHasStroke ? "Stroke" : "Color";
  const patchStyleAnn = (p: Partial<ShapeAnnotation>) => {
    if (styleAnn && app.selected) {
      app.updateAnnotation(app.selected.page, { ...styleAnn, ...p } as Annotation);
    }
  };

  // Contextual style controls: font options only while working with text,
  // stroke width only for drawing tools (armed-tool defaults; a *selected*
  // annotation is handled by the styleAnn branch instead).
  const showFontControls = app.tool === "text" || !!selectedText;
  const showStroke = ["ink", "rect", "ellipse", "line", "arrow", "callout"].includes(app.tool);
  const isMarkupTool =
    app.tool === "underline" || app.tool === "strikeout" || app.tool === "squiggly";
  const showColor =
    showFontControls || showStroke || app.tool === "highlight" || isMarkupTool;
  const showFill = app.tool === "rect" || app.tool === "ellipse";
  const fillValue = app.toolFill;
  const setFill = (v: string | null) => app.setToolFill(v);

  // The second toolbar row appears whenever the armed tool or the current
  // selection has sub-options to show.
  const hasContextual =
    showColor ||
    showFill ||
    app.tool === "edittext" ||
    !!selectedFormField ||
    !!app.selectedField ||
    !!selectedAnn;

  return (
    // data-ann-controls: pressing toolbar controls must not deselect the
    // annotation or dismiss its popover (see AnnotationItem's onOpenChange).
    <TooltipProvider delay={350}>
    {/* relative + z-40: the contextual row below is an absolute overlay that
        drops over the document (viewer internals go up to z-30) instead of
        taking layout height — so arming/disarming a tool never shifts the page. */}
    <div data-ann-controls className="relative z-40 border-b bg-background/95 backdrop-blur">
    <div
      role="toolbar"
      aria-label="PDF editing tools"
      className="flex items-center gap-1 px-3 py-1.5"
    >
      {/* tools (scroll/slide horizontally instead of wrapping) */}
      <DragScroll className="flex-1">
        <ToggleGroup
          value={toolValue}
          onValueChange={handleToolChange}
          className="flex items-center gap-1 bg-transparent p-0"
          aria-label="Annotation tools"
        >
          {TOOLS.map((t, i) => (
            <div key={t.key} className="flex shrink-0 items-center gap-1">
              {i > 0 && t.group !== TOOLS[i - 1].group && (
                <Separator orientation="vertical" className="mx-1 h-6" />
              )}
              <Tip label={t.name} desc={t.desc} shortcut={t.shortcut}>
                <ToggleGroupItem
                  value={t.key}
                  aria-label={t.name}
                  className="h-8 w-8 rounded-md data-[pressed]:!bg-primary data-[pressed]:!text-primary-foreground"
                >
                  <t.icon className="h-4 w-4" />
                </ToggleGroupItem>
              </Tip>
            </div>
          ))}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />
        <Tip label="Insert image" desc="PNG or JPEG, placed as a stamp">
          <button
            onClick={() => imageRef.current?.click()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
        </Tip>
        <Tip
          label="Form builder"
          desc="Design fillable forms: palette, tab order, validation"
        >
          <button
            onClick={() => app.setFormBuilder(!app.formBuilder)}
            className={cn(
              "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              app.formBuilder || app.tool.startsWith("form")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <FormInput className="h-4 w-4" />
            Form
          </button>
        </Tip>
        <Menu>
          <Tip label="Stamp" desc="Place a predefined stamp (APPROVED, DRAFT, …)">
            <MenuTrigger className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Stamp className="h-4 w-4" />
              Stamp
            </MenuTrigger>
          </Tip>
          <MenuContent className="min-w-48">
            {STAMPS.map((s) => (
              <MenuItem
                key={s.label}
                onClick={() => {
                  const { dataUrl, aspect } = makeStamp(s);
                  app.setPendingStamp({ dataUrl, aspect });
                }}
              >
                <span
                  className="rounded border-2 px-1.5 py-0.5 text-[10px] font-bold italic"
                  style={{ borderColor: s.color, color: s.color }}
                >
                  {s.label}
                </span>
                {s.withDate && (
                  <span className="text-[10px] text-muted-foreground">+ date</span>
                )}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Tip label="Insert signature" desc="Draw, type or upload; saved for reuse">
          <button
            onClick={() => app.setSignatureModalOpen(true)}
            className={cn(
              "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              app.pendingStamp
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Signature className="h-4 w-4" />
            Sign
          </button>
        </Tip>
      </DragScroll>
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onload = () => {
              app.setPendingStamp({
                dataUrl,
                aspect: img.height / img.width || 1,
              });
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(f);
          e.target.value = "";
        }}
      />

      {/* pinned right — always reachable, never scrolls off */}
      <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />

      <Tip label="Undo" shortcut="Ctrl+Z">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          disabled={!app.canUndo}
          onClick={app.undo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
      </Tip>
      <Tip label="Redo" shortcut="Ctrl+Shift+Z">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          disabled={!app.canRedo}
          onClick={app.redo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
      </Tip>

      <div className="flex shrink-0 items-center gap-1">
        {app.activeProtected && (
          <button
            onClick={() => app.setSecurityModalOpen(true)}
            title={
              app.docPermissions.restricted
                ? "Restricted document — click to view permissions or unlock"
                : app.activeWrapped
                  ? "Locked to PickPDF — other viewers see a notice page. Click for options"
                  : "Encrypted document — click for security options"
            }
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              app.docPermissions.restricted
                ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400",
            )}
          >
            <Lock className="h-3.5 w-3.5" />
            {app.docPermissions.restricted
              ? "Restricted"
              : app.activeWrapped
                ? "PickPDF-locked"
                : "Protected"}
          </button>
        )}
        {app.tool === "redact" && app.redactCount === 0 && (
          <span className="rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400">
            Draw boxes over content to remove
          </span>
        )}
        {app.redactCount > 0 && (
          <Button
            size="sm"
            className="h-7 gap-1.5 bg-red-600 text-xs text-white hover:bg-red-700"
            onClick={app.applyRedactions}
            title="Permanently remove the content under every redaction box"
          >
            <SquareSlash className="h-3.5 w-3.5" />
            Apply {app.redactCount} redaction{app.redactCount === 1 ? "" : "s"}
          </Button>
        )}
        {app.pendingStamp && (
          <span className="rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            Click on the page to place — Esc to cancel
          </span>
        )}
      </div>
    </div>

    {/* sub-options — contextual to the armed tool / selection. Always mounted
        (its content is empty when hasContextual is false, so nothing stays
        tabbable) and shown as an overlay sliding down over the document. */}
      <div
        aria-hidden={!hasContextual}
        className={cn(
          "absolute inset-x-0 top-full flex items-center gap-1.5 border-b border-t border-t-border/60 bg-background/95 px-3 py-1.5 shadow-sm backdrop-blur transition-all duration-200 ease-out",
          hasContextual
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
      <DragScroll className="flex-1 gap-1.5">
        {selectedKind && (
          <>
            {/* Selection chip — what the following controls apply to. */}
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-medium text-foreground">
              <selectedKind.icon className="h-3.5 w-3.5" />
              {selectedKind.label}
            </div>
            <Separator orientation="vertical" className="mx-0.5 h-6 shrink-0" />
          </>
        )}
        {app.tool === "edittext" ? (
          inlineEdit ? (
            // Editing a real text run: same look as TextStyleControls (family ·
            // size | B I | color), but on NATIVE controls (see NativeSelect) so
            // no portal steals focus. Tagged so the inline editor keeps focus
            // for THESE controls only — clicking Undo/Redo or a tool elsewhere
            // in the toolbar commits the edit first.
            <div data-inline-edit-controls className="flex items-center gap-1.5">
              {/* "Original" keeps the document's embedded face (bold/italic are
                  then synthesized on it); picking a family below is an explicit
                  font replacement — never triggered by accident. */}
              <NativeSelect
                value={inlineEdit.family}
                disabled={inlineEdit.saving}
                onChange={(e) => inlineEdit.setFamily(e.target.value)}
                aria-label="Font family"
                title={
                  inlineEdit.fontName
                    ? `Document font: ${inlineEdit.fontName}`
                    : undefined
                }
                className="w-44"
              >
                <option value="original">
                  {inlineEdit.fontName
                    ? `Original (${inlineEdit.fontName})`
                    : "Original font"}
                </option>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.v} value={f.v}>
                    Replace: {f.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                value={String(inlineEdit.sizePt)}
                disabled={inlineEdit.saving}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  inlineEdit.setSizePt(() => n);
                }}
                aria-label="Font size"
                className="w-[4.75rem]"
              >
                {[...new Set([...FONT_SIZES, inlineEdit.sizePt])]
                  .sort((a, b) => a - b)
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}pt
                    </option>
                  ))}
              </NativeSelect>
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <StyleToggle
                label="Bold"
                icon={Bold}
                pressed={inlineEdit.bold}
                disabled={inlineEdit.saving}
                onPressedChange={() => inlineEdit.toggleBold()}
              />
              <StyleToggle
                label="Italic"
                icon={Italic}
                pressed={inlineEdit.italic}
                disabled={inlineEdit.saving}
                onPressedChange={() => inlineEdit.toggleItalic()}
              />
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <ColorSwatch
                value={inlineEdit.colorHex}
                disabled={inlineEdit.saving}
                onChange={inlineEdit.setColorHex}
                title="Text color"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TextCursorInput className="h-3.5 w-3.5 shrink-0" />
              <span>Click a line of text to edit its content, font, size and color.</span>
            </div>
          )
        ) : showFontControls ? (
          <TextStyleControls
            value={{
              color:
                liveEditor?.styleValue("color") ??
                selectedText?.color ??
                app.toolColor,
              fontFamily,
              fontSize:
                liveEditor?.styleValue("fontSize") ??
                selectedText?.fontSize ??
                app.fontSize,
              bold: isBold,
              italic: isItalic,
              underline: isUnderline,
              strike: isStrike,
              align: alignValue,
            }}
            onPatch={(p) => {
              // Tool defaults follow the last choice so new boxes match.
              if (p.color !== undefined) app.setToolColor(p.color);
              if (p.fontFamily !== undefined) app.setFontFamily(p.fontFamily);
              if (p.fontSize !== undefined) app.setFontSize(p.fontSize);
              if (p.bold !== undefined) app.setFontBold(p.bold);
              if (p.italic !== undefined) app.setFontItalic(p.italic);
              if (p.underline !== undefined) app.setFontUnderline(p.underline);
              if (p.strike !== undefined) app.setFontStrike(p.strike);
              if (p.align !== undefined) app.setTextAlign(p.align);
              // Alignment is a box property — always patch the annotation directly.
              const { align, ...runPatch } = p;
              if (align !== undefined) patchSelectedText({ align });
              if (!Object.keys(runPatch).length) return;
              // Editing a box → style its current selection; an empty box has
              // nothing to style yet (returns false) → patch the box itself.
              const editor = activeTextEditor.current;
              if (
                editor &&
                selectedText &&
                editor.annId === selectedText.id &&
                editor.applyStyle(runPatch)
              ) {
                return;
              }
              patchSelectedText({
                ...runPatch,
                ...(runPatch.fontFamily !== undefined ? { displayFontCss: undefined } : {}),
              });
            }}
          />
        ) : styleAnn ? (
          // A selected shape / drawing / highlight / whiteout — edit it directly.
          <>
            <ColorSwatch
              value={styleA?.color ?? (styleAnn.kind === "whiteout" ? "#ffffff" : "#111111")}
              onChange={(v) => patchStyleAnn({ color: v })}
              title={styleColorLabel}
            />
            {styleHasStroke && (
              <StrokeWidthSelect
                value={styleA?.strokeWidth ?? 2}
                onChange={(w) => patchStyleAnn({ strokeWidth: w })}
              />
            )}
            {styleIsFillable && (
              <FillControl
                value={styleA?.fill ?? null}
                onChange={(c) => patchStyleAnn({ fill: c ?? undefined })}
              />
            )}
          </>
        ) : app.tool === "highlight" ? (
          <div className="flex items-center gap-2">
            <ToggleGroup
              value={[app.highlightMode]}
              onValueChange={(v) =>
                v[0] && app.setHighlightMode(v[0] as "text" | "area")
              }
              aria-label="Highlighter mode"
              className="shrink-0"
            >
              <ToggleGroupItem
                value="text"
                aria-label="Highlight text"
                className="h-7 w-auto px-2.5 text-xs"
              >
                Text
              </ToggleGroupItem>
              <ToggleGroupItem
                value="area"
                aria-label="Highlight area"
                className="h-7 w-auto px-2.5 text-xs"
              >
                Area
              </ToggleGroupItem>
            </ToggleGroup>
            <Separator orientation="vertical" className="h-6 shrink-0" />
            <ColorPresets
              colors={HIGHLIGHT_PRESETS}
              value={app.highlightColor}
              onChange={app.setHighlightColor}
            />
          </div>
        ) : isMarkupTool ? (
          <div className="flex items-center gap-2">
            <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Highlighter className="h-3.5 w-3.5" />
              Drag over text to mark it
            </span>
            <ColorPresets
              colors={INK_PRESETS}
              value={app.markupColor}
              onChange={app.setMarkupColor}
            />
          </div>
        ) : app.tool === "ink" ? (
          <>
            <ColorPresets
              colors={INK_PRESETS}
              value={app.toolColor}
              onChange={app.setToolColor}
            />
            <SizePresets value={app.strokeWidth} onChange={app.setStrokeWidth} />
          </>
        ) : (
          showColor && (
            <ColorSwatch value={app.toolColor} onChange={app.setToolColor} title="Color" />
          )
        )}
        {showStroke && app.tool !== "ink" && (
          <StrokeWidthSelect value={app.strokeWidth} onChange={app.setStrokeWidth} />
        )}
        {showFill && <FillControl value={fillValue} onChange={setFill} />}
        {selectedFormField && (
          <>
            <Input
              key={`name-${selectedFormField.id}`}
              defaultValue={selectedFormField.fieldName}
              aria-label="Field name"
              placeholder="field name"
              className="h-7 w-32 shrink-0 px-2 text-xs"
              onBlur={(e) =>
                patchSelectedFormField({
                  fieldName: e.target.value.trim() || selectedFormField.fieldName,
                })
              }
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {selectedFormField.fieldType === "dropdown" && (
              <Input
                key={`opts-${selectedFormField.id}`}
                defaultValue={(selectedFormField.options ?? []).join(", ")}
                aria-label="Dropdown options"
                placeholder="options, comma-separated"
                className="h-7 w-56 shrink-0 px-2 text-xs"
                onBlur={(e) =>
                  patchSelectedFormField({
                    options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                  })
                }
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            )}
            {selectedFormField.fieldType === "radio" && (
              <Input
                key={`val-${selectedFormField.id}`}
                defaultValue={selectedFormField.optionValue ?? ""}
                aria-label="Radio option value"
                placeholder="option value"
                className="h-7 w-28 shrink-0 px-2 text-xs"
                onBlur={(e) =>
                  patchSelectedFormField({
                    optionValue: e.target.value.trim() || selectedFormField.optionValue,
                  })
                }
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            )}
          </>
        )}
        {app.selectedField && (
          <>
            <Input
              key={`efname-${app.selectedField.key}`}
              defaultValue={
                app.fieldOps[app.selectedField.key]?.newName ??
                app.selectedField.fieldName
              }
              aria-label="Existing field name"
              placeholder="field name"
              className="h-7 w-32 shrink-0 px-2 text-xs"
              onBlur={(e) => {
                const v = e.target.value.trim();
                app.upsertFieldOp(app.selectedField!, {
                  newName:
                    v && v !== app.selectedField!.fieldName ? v : undefined,
                });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-xs text-destructive hover:text-destructive"
              onClick={() => {
                app.upsertFieldOp(app.selectedField!, { deleted: true });
                app.setSelectedField(null);
              }}
            >
              Delete field
            </Button>
          </>
        )}
      </DragScroll>
        {selectedAnn && (
          <div className="flex shrink-0 items-center gap-1">
            {ROTATABLE_KINDS.has(selectedAnn.kind) && (
              <Tip label="Rotate 90°" desc="Or drag the round handle above the selection">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label="Rotate 90 degrees"
                  onClick={rotateSelected}
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </Tip>
            )}
            <Tip label="Duplicate">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="Duplicate"
                onClick={duplicateSelected}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </Tip>
            <Tip label="Delete">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete"
                onClick={deleteSelected}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tip>
          </div>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}

import { useEffect, useReducer, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  Bold,
  Circle,
  CircleDot,
  Copy,
  Eraser,
  FormInput,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  List,
  Lock,
  MessageSquare,
  Minus,
  MousePointer2,
  PaintBucket,
  Pencil,
  Redo2,
  Signature,
  SquareSlash,
  Square,
  SquareCheck,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { ColorSwatch } from "../ui/color-swatch";
import {
  ColorPresets,
  FillControl,
  HIGHLIGHT_PRESETS,
  INK_PRESETS,
  SizePresets,
  StrokeWidthSelect,
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
import { uid } from "../../lib/utils";
import { cn } from "../../lib/utils";
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
  { key: "select", icon: Hand, name: "Move / edit objects", desc: "Drag existing text & images; Delete to remove", group: 0, shortcut: "M" },
  { key: "text", icon: Type, name: "Add text", desc: "Click the page to place a text box", group: 1, shortcut: "T" },
  { key: "edittext", icon: TextCursorInput, name: "Edit existing text", desc: "Click a line of the document to retype it", group: 1, shortcut: "E" },
  { key: "highlight", icon: Highlighter, name: "Highlight", desc: "Drag over text, or click an existing highlight to remove it", group: 2, shortcut: "H" },
  { key: "note", icon: MessageSquare, name: "Comment", desc: "Click the page to add a sticky note", group: 2, shortcut: "C" },
  { key: "ink", icon: Pencil, name: "Draw freehand", desc: "Pen strokes in the chosen color & size", group: 2, shortcut: "D" },
  { key: "rect", icon: Square, name: "Rectangle", desc: "Drag to draw; fill optional", group: 3, shortcut: "R" },
  { key: "ellipse", icon: Circle, name: "Ellipse", desc: "Drag to draw; fill optional", group: 3, shortcut: "O" },
  { key: "line", icon: Minus, name: "Line", desc: "Drag from start to end", group: 3, shortcut: "L" },
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
    if (key === "highlight") {
      const sel = window.getSelection();
      if (
        sel &&
        !sel.isCollapsed &&
        sel.anchorNode?.parentElement?.closest(".textLayer")
      ) {
        window.dispatchEvent(new CustomEvent("pdfwb:highlight-selection"));
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
    ink: { icon: Pencil, label: "Drawing" },
    highlight: { icon: Highlighter, label: "Highlight" },
    note: { icon: MessageSquare, label: "Comment" },
    image: { icon: ImageIcon, label: "Image" },
    whiteout: { icon: Eraser, label: "Whiteout" },
    redact: { icon: SquareSlash, label: "Redaction" },
    formfield: { icon: FormInput, label: "Field" },
  };
  const selectedKind = selectedAnn ? KIND_CHIP[selectedAnn.kind] : undefined;

  const duplicateSelected = () => {
    if (!selectedAnn || !app.selected) return;
    const copy = { ...selectedAnn, id: uid(), x: selectedAnn.x + 12, y: selectedAnn.y + 12 };
    app.addAnnotation(app.selected.page, copy);
    app.setSelected({ page: app.selected.page, id: copy.id });
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
    ["rect", "ellipse", "line", "ink", "highlight", "whiteout"].includes(selectedAnn.kind)
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
  const showStroke = ["ink", "rect", "ellipse", "line"].includes(app.tool);
  const showColor = showFontControls || showStroke || app.tool === "highlight";
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
    <div data-ann-controls className="border-b bg-background/95 backdrop-blur">
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
        <Menu>
          <MenuTrigger
            className={cn(
              "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              app.tool.startsWith("form")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <FormInput className="h-4 w-4" />
            Field
          </MenuTrigger>
          <MenuContent className="min-w-44">
            <MenuItem onClick={() => app.setTool("formtext")}>
              <FormInput className="h-4 w-4 text-muted-foreground" />
              Text field
            </MenuItem>
            <MenuItem onClick={() => app.setTool("formcheckbox")}>
              <SquareCheck className="h-4 w-4 text-muted-foreground" />
              Checkbox
            </MenuItem>
            <MenuItem onClick={() => app.setTool("formradio")}>
              <CircleDot className="h-4 w-4 text-muted-foreground" />
              Radio button
            </MenuItem>
            <MenuItem onClick={() => app.setTool("formdropdown")}>
              <List className="h-4 w-4 text-muted-foreground" />
              Dropdown
            </MenuItem>
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

    {/* sub-options — a second row, contextual to the armed tool / selection */}
    {hasContextual && (
      <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
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
            // Editing a real text run: drive its detected style. Native <select>
            // (not the base-ui one) so the dropdown doesn't portal focus out and
            // commit the edit prematurely. Tagged so the inline editor keeps
            // focus for THESE controls only — clicking Undo/Redo or a tool
            // elsewhere in the toolbar commits the edit first.
            <div data-inline-edit-controls className="flex items-center gap-1.5">
              <select
                value={inlineEdit.family}
                disabled={inlineEdit.saving}
                onChange={(e) => inlineEdit.setFamily(e.target.value)}
                aria-label="Font family"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="helvetica">Helvetica</option>
                <option value="times">Times</option>
                <option value="courier">Courier</option>
                <option value="carlito">Carlito</option>
                <option value="caladea">Caladea</option>
              </select>
              <Tip label="Bold">
                <Button
                  variant={inlineEdit.bold ? "subtle" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  disabled={inlineEdit.saving}
                  onClick={inlineEdit.toggleBold}
                >
                  <Bold className="h-4 w-4" />
                </Button>
              </Tip>
              <Tip label="Italic">
                <Button
                  variant={inlineEdit.italic ? "subtle" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  disabled={inlineEdit.saving}
                  onClick={inlineEdit.toggleItalic}
                >
                  <Italic className="h-4 w-4" />
                </Button>
              </Tip>
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <ColorSwatch
                value={inlineEdit.colorHex}
                disabled={inlineEdit.saving}
                onChange={inlineEdit.setColorHex}
                title="Text color"
              />
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <div className="flex items-center rounded-md border border-input">
                <button
                  type="button"
                  aria-label="Smaller"
                  disabled={inlineEdit.saving}
                  onClick={() => inlineEdit.setSizePt((s) => Math.max(4, s - 1))}
                  className="flex h-8 w-7 items-center justify-center rounded-l-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  −
                </button>
                <span className="w-8 text-center text-xs tabular-nums">
                  {inlineEdit.sizePt}
                </span>
                <button
                  type="button"
                  aria-label="Larger"
                  disabled={inlineEdit.saving}
                  onClick={() => inlineEdit.setSizePt((s) => Math.min(200, s + 1))}
                  className="flex h-8 w-7 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  +
                </button>
              </div>
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
          <ColorPresets
            colors={HIGHLIGHT_PRESETS}
            value={app.highlightColor}
            onChange={app.setHighlightColor}
          />
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
    )}
    </div>
    </TooltipProvider>
  );
}

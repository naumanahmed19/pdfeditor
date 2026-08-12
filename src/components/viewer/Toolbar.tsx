import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  Bold,
  Check,
  ChevronDown,
  Circle,
  Cloud,
  Copy,
  Eraser,
  FormInput,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  LandPlot,
  Link2,
  Lock,
  LockOpen,
  MessageSquare,
  MessageSquareQuote,
  Minus,
  MousePointer2,
  Move,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Pentagon,
  Redo2,
  RotateCw,
  Route,
  Ruler,
  Signature,
  Spline,
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
  X,
} from "lucide-react";
import { useApp, type EditTextScope } from "../../store";
import { Button } from "../ui/button";
import { ColorSwatch } from "../ui/color-swatch";
import {
  BlockFormatControls,
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
import { activeBlockEditor } from "../../lib/activeBlockEditor";
import { activeInlineEdit } from "../../lib/activeInlineEdit";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuTrigger } from "../ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { LinkProperties } from "./LinkProperties";
import { hasLinkTarget } from "../../lib/linktarget";
import { Separator } from "../ui/separator";
import { Tip, TooltipProvider } from "../ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { cn, ROTATABLE_KINDS } from "../../lib/utils";
import { formatScale } from "../../lib/measure";
import { STAMPS, makeStamp } from "../../lib/stamps";
import type {
  Annotation,
  FontFamilyKind,
  FormFieldAnnotation,
  MarkAnnotation,
  MarkSymbol,
  ShapeAnnotation,
  TextAnnotation,
  ToolKind,
} from "../../types";

type ToolbarTool = {
  key: ToolKind;
  icon: typeof Type;
  name: string;
  desc: string;
  shortcut?: string;
};

/** Tools in historical display order; groups below decide top-level placement. */
const TOOLS: Array<ToolbarTool & { group: number }> = [
  { key: "read", icon: MousePointer2, name: "Read", desc: "Select & copy text, follow links", group: 0, shortcut: "V" },
  { key: "pan", icon: Hand, name: "Pan", desc: "Drag to scroll the page", group: 0 },
  { key: "select", icon: Move, name: "Move / select", desc: "Click to select, drag to move, and double-click text or fields to edit. Switch to Read to fill forms", group: 0, shortcut: "M" },
  { key: "text", icon: Type, name: "Add text", desc: "Click the page to place a text box", group: 1, shortcut: "T" },
  { key: "highlight", icon: Highlighter, name: "Highlight", desc: "Text mode: drag over text. Area mode: drag a box over any region. Click a highlight to recolor or delete it", group: 2, shortcut: "H" },
  { key: "underline", icon: Underline, name: "Underline text", desc: "Drag over text to mark it; click a mark to recolor or delete it", group: 2, shortcut: "U" },
  { key: "strikeout", icon: Strikethrough, name: "Strike through text", desc: "Drag over text to mark it; click a mark to recolor or delete it", group: 2, shortcut: "S" },
  { key: "squiggly", icon: Waves, name: "Squiggly underline", desc: "Drag over text to mark it; click a mark to recolor or delete it", group: 2 },
  { key: "note", icon: MessageSquare, name: "Comment", desc: "Click the page to add a sticky note", group: 2, shortcut: "C" },
  { key: "ink", icon: Pencil, name: "Draw freehand", desc: "Pen strokes in the chosen color & size", group: 2, shortcut: "D" },
  { key: "mark", icon: Check, name: "Check / cross", desc: "Stamp a ✓ or ✗ — click to drop one, drag to size it. For ticking printed or scanned forms", group: 2, shortcut: "Y" },
  { key: "link", icon: Link2, name: "Link", desc: "Drag a box to make a clickable link — to a URL, email, phone number or another page", group: 2, shortcut: "N" },
  { key: "rect", icon: Square, name: "Rectangle", desc: "Drag to draw; fill optional", group: 3, shortcut: "R" },
  { key: "ellipse", icon: Circle, name: "Ellipse", desc: "Drag to draw; fill optional", group: 3, shortcut: "O" },
  { key: "line", icon: Minus, name: "Line", desc: "Drag from start to end", group: 3, shortcut: "L" },
  { key: "arrow", icon: MoveUpRight, name: "Arrow", desc: "Drag from tail to head", group: 3, shortcut: "A" },
  { key: "polygon", icon: Pentagon, name: "Polygon", desc: "Click to place corners; click the first corner, double-click or press Enter to close. Esc cancels", group: 3, shortcut: "P" },
  { key: "polyline", icon: Spline, name: "Polyline", desc: "Click to place points; double-click or press Enter to finish. Esc cancels", group: 3 },
  { key: "cloud", icon: Cloud, name: "Cloud", desc: "Review cloud — a polygon with a scalloped border. Click to place corners; double-click or Enter closes", group: 3 },
  { key: "callout", icon: MessageSquareQuote, name: "Callout", desc: "Drag from the target to where the note should sit", group: 3, shortcut: "K" },
  { key: "measuredist", icon: Ruler, name: "Distance", desc: "Measure a straight-line distance: click two points or drag. Calibrate first for real-world units", group: 5 },
  { key: "measureperim", icon: Route, name: "Perimeter", desc: "Measure along a path: click to place points; double-click or Enter finishes. Esc cancels", group: 5 },
  { key: "measurearea", icon: LandPlot, name: "Area", desc: "Measure an enclosed area: click to place corners; click the first corner, double-click or Enter closes. Esc cancels", group: 5 },
  { key: "whiteout", icon: PaintBucket, name: "Whiteout", desc: "Cover page content with a filled box (hides, does not remove)", group: 4, shortcut: "W" },
  { key: "eraser", icon: Eraser, name: "Eraser", desc: "Click or drag across an annotation you added to delete it" , group: 4 },
  { key: "redact", icon: SquareSlash, name: "Redact", desc: "Deletes text and images under the box, then paints it black (annotations and metadata are not removed) — draw boxes, then Apply", group: 4, shortcut: "X" },
];

/**
 * "Edit existing content" sub-tools, surfaced through a single dropdown button
 * (not the toggle row). Both edit the real document — retyping text runs, or
 * moving/resizing existing text & images — so they're grouped apart from the
 * annotation tools. Shortcuts stay live via the same handler as TOOLS.
 */
const EDIT_TOOLS: ToolbarTool[] = [
  { key: "edittext", icon: TextCursorInput, name: "Edit text", desc: "Click a line of the document to retype it, or change its font, size and color", shortcut: "E" },
];

const ALL_TOOLS: ToolbarTool[] = [...TOOLS, ...EDIT_TOOLS];
const BASIC_TOOLS = TOOLS.filter((t) => t.group === 0);

type ToolFlyoutId = "text" | "markup" | "shapes" | "measure" | "cleanup";

const TOOL_FLYOUTS: Array<{
  id: ToolFlyoutId;
  label: string;
  desc: string;
  defaultTool: ToolKind;
  tools: ToolKind[];
}> = [
  {
    id: "text",
    label: "Text",
    desc: "Add text or edit existing page content",
    defaultTool: "text",
    tools: ["text", "edittext"],
  },
  {
    id: "markup",
    label: "Markup",
    desc: "Highlights, comments, ink, marks and links",
    defaultTool: "highlight",
    tools: ["highlight", "underline", "strikeout", "squiggly", "note", "ink", "mark", "link"],
  },
  {
    id: "shapes",
    label: "Shapes",
    desc: "Draw rectangles, ellipses, lines, arrows, polygons, clouds and callouts",
    defaultTool: "rect",
    tools: ["rect", "ellipse", "line", "arrow", "polygon", "polyline", "cloud", "callout"],
  },
  {
    id: "measure",
    label: "Measure",
    desc: "Measure distances, perimeters and areas — calibrate against a known length for real-world units",
    defaultTool: "measuredist",
    tools: ["measuredist", "measureperim", "measurearea"],
  },
  {
    id: "cleanup",
    label: "Cleanup",
    desc: "Hide, erase or permanently redact content",
    defaultTool: "whiteout",
    tools: ["whiteout", "eraser", "redact"],
  },
];

const INITIAL_LAST_TOOL_BY_GROUP: Record<ToolFlyoutId, ToolKind> = {
  text: "text",
  markup: "highlight",
  shapes: "rect",
  measure: "measuredist",
  cleanup: "whiteout",
};

const TOOL_FLYOUT_BY_KEY = new Map<ToolKind, ToolFlyoutId>(
  TOOL_FLYOUTS.flatMap((group) => group.tools.map((key) => [key, group.id] as const)),
);
type ToolFlyoutConfig = (typeof TOOL_FLYOUTS)[number];

function getTool(key: ToolKind): ToolbarTool {
  const tool = ALL_TOOLS.find((t) => t.key === key);
  if (!tool) throw new Error(`Unknown toolbar tool: ${key}`);
  return tool;
}

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

/** Row item used inside grouped toolbar flyout menus. */
function ToolMenuItem({
  tool,
  active,
  onSelect,
}: {
  tool: ToolbarTool;
  active: boolean;
  onSelect: (key: ToolKind) => void;
}) {
  const Icon = tool.icon;
  return (
    <MenuItem onClick={() => onSelect(tool.key)} className="items-start py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 font-medium">
          {tool.name}
          {tool.shortcut && (
            <kbd className="rounded border bg-muted px-1 text-[10px] font-normal text-muted-foreground">
              {tool.shortcut}
            </kbd>
          )}
        </span>
        <span className="text-[11px] leading-snug text-muted-foreground">
          {tool.desc}
        </span>
      </span>
      {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
    </MenuItem>
  );
}

function ActionMenuItem({
  icon: Icon,
  name,
  desc,
  active,
  onClick,
}: {
  icon: typeof Type;
  name: string;
  desc: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <MenuItem onClick={onClick} className="items-start py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{name}</span>
        <span className="text-[11px] leading-snug text-muted-foreground">
          {desc}
        </span>
      </span>
      {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
    </MenuItem>
  );
}

function ToolFlyoutButton({
  group,
  activeTool,
  lastTool,
  onSelect,
}: {
  group: ToolFlyoutConfig;
  activeTool?: ToolKind;
  lastTool: ToolKind;
  onSelect: (key: ToolKind) => void;
}) {
  const active = !!activeTool;
  const displayTool = getTool(activeTool ?? lastTool ?? group.defaultTool);
  const Icon = displayTool.icon;

  return (
    <Menu>
      <Tip
        label={active ? displayTool.name : group.label}
        desc={active ? displayTool.desc : group.desc}
        shortcut={active ? displayTool.shortcut : undefined}
      >
        <MenuTrigger
          data-tour={
            group.id === "markup"
              ? "comment-tools"
              : group.id === "text"
                ? "text-tools"
                : group.id === "cleanup"
                  ? "cleanup-tools"
                  : undefined
          }
          aria-label={group.label}
          aria-pressed={active}
          className={cn(
            "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{group.label}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </MenuTrigger>
      </Tip>
      <MenuContent className="min-w-64">
        <MenuGroup>
          <MenuLabel>{group.label}</MenuLabel>
          {group.tools.map((key) => {
            const tool = getTool(key);
            return (
              <ToolMenuItem
                key={key}
                tool={tool}
                active={activeTool === key}
                onSelect={onSelect}
              />
            );
          })}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

/** Contextual control for turning a selected text box into a clickable link —
 *  a toggle button opening the shared "Link properties" picker. */
function TextLinkControl({
  ann,
  onPatch,
}: {
  ann: TextAnnotation;
  onPatch: (p: Partial<TextAnnotation>) => void;
}) {
  const [open, setOpen] = useState(false);
  const linked = hasLinkTarget(ann.link);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Link" desc="Make this text box a clickable link">
        <PopoverTrigger
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
            linked
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Link2 className="h-4 w-4" />
          {linked ? "Linked" : "Link"}
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        data-ann-controls
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-72 p-3"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <LinkProperties
          target={ann.link ?? { targetType: "url", value: "" }}
          onChange={(t) => onPatch({ link: t })}
          onDelete={
            linked
              ? () => {
                  onPatch({ link: undefined });
                  setOpen(false);
                }
              : undefined
          }
          deleteLabel="Remove link"
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function EditorToolbar() {
  const app = useApp();
  const imageRef = useRef<HTMLInputElement>(null);
  const [lastToolByGroup, setLastToolByGroup] = useState(INITIAL_LAST_TOOL_BY_GROUP);

  useEffect(() => {
    const groupId = TOOL_FLYOUT_BY_KEY.get(app.tool);
    if (!groupId) return;
    setLastToolByGroup((prev) =>
      prev[groupId] === app.tool ? prev : { ...prev, [groupId]: app.tool },
    );
  }, [app.tool]);

  // Leaving the distance tool aborts a pending calibration — otherwise the
  // NEXT distance drawn (much later) would silently become the reference line.
  useEffect(() => {
    if (app.measureCalibrating && app.tool !== "measuredist") {
      app.setMeasureCalibrating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.tool, app.measureCalibrating]);

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

  // Single-key tool shortcuts (V/M/T/E/G/H/C/D/R/O/L/W/X) — ignored while
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
      const tool = [...TOOLS, ...EDIT_TOOLS].find(
        (x) => x.shortcut?.toLowerCase() === e.key.toLowerCase(),
      );
      if (tool) {
        e.preventDefault();
        setToolRef.current(tool.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!app.pdf) return null;

  // The visible basics stay a single-select toggle group. Creation/edit tools
  // live in flyouts below, but still route through the same selection logic.
  const basicToolValue =
    !app.pendingStamp && BASIC_TOOLS.some((t) => t.key === app.tool) ? [app.tool] : [];

  const selectTool = (key: ToolKind) => {
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

  const handleToolChange = (values: string[]) => {
    const key = values[0] as ToolKind | undefined;
    if (!key) return; // ignore toggling the active tool off
    selectTool(key);
  };

  // When a text box is selected, style controls edit it directly.
  const selectedText = (() => {
    if (!app.selected) return null;
    const ann = (app.annotations[app.selected.page] ?? []).find(
      (a) => a.id === app.selected!.id,
    );
    return ann && ann.kind === "text" ? ann : null;
  })();
  const activeBoxDraft =
    selectedText && activeBlockEditor.current?.annId === selectedText.id
      ? activeBlockEditor.current
      : null;

  const patchSelectedText = (patch: Partial<TextAnnotation>) => {
    if (selectedText && app.selected && !selectedText.locked) {
      if (activeBoxDraft) {
        activeBoxDraft.patchBox(patch);
        bumpSel();
        return;
      }
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
    if (selectedFormField && app.selected && !selectedFormField.locked) {
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
    polygon: { icon: Pentagon, label: "Polygon" },
    polyline: { icon: Spline, label: "Polyline" },
    measure: { icon: Ruler, label: "Measurement" },
    ink: { icon: Pencil, label: "Drawing" },
    mark: { icon: Check, label: "Check / cross" },
    link: { icon: Link2, label: "Link" },
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
  const duplicateSelected = () => {
    if (!selectedAnn?.locked) app.duplicateSelectedAnnotation();
  };

  const rotateSelected = () => {
    if (!selectedAnn || !app.selected || selectedAnn.locked) return;
    const next = ((selectedAnn.rotation ?? 0) + 90) % 360;
    app.updateAnnotation(app.selected.page, {
      ...selectedAnn,
      rotation: next === 0 ? undefined : next,
    });
  };

  const deleteSelected = () => {
    if (!selectedAnn || !app.selected || selectedAnn.locked) return;
    app.removeAnnotation(app.selected.page, selectedAnn.id);
    app.setSelected(null);
  };

  const toggleSelectedLock = () => {
    if (!selectedAnn || !app.selected) return;
    app.setMultiSelected(null);
    app.updateAnnotation(app.selected.page, {
      ...selectedAnn,
      locked: selectedAnn.locked ? undefined : true,
    });
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
  // Block-format controls (headings/lists) are live only while editing the box.
  const liveBlockEditor = activeBoxDraft;
  const sel = <K extends "bold" | "italic" | "underline" | "strike">(
    key: K,
    boxVal: boolean,
  ): boolean =>
    liveEditor
      ? liveEditor.styleValue(key) ?? false
      : (activeBoxDraft?.boxValue(key) ?? boxVal);

  const fontFamily =
    (liveEditor?.styleValue("fontFamily")) ??
    activeBoxDraft?.boxValue("fontFamily") ??
    selectedText?.fontFamily ??
    app.fontFamily;
  const isBold = sel("bold", selectedText ? !!selectedText.bold : app.fontBold);
  const isItalic = sel("italic", selectedText ? !!selectedText.italic : app.fontItalic);
  const isUnderline = sel("underline", selectedText ? !!selectedText.underline : app.fontUnderline);
  const isStrike = sel("strike", selectedText ? !!selectedText.strike : app.fontStrike);
  const alignValue = activeBoxDraft?.boxValue("align") ?? selectedText?.align ?? app.textAlign;

  // A selected annotation whose color / stroke / fill the contextual row
  // edits directly (text & notes have their own handling; image/redact have
  // no style). This replaces the old floating properties popover.
  const styleAnn =
    selectedAnn &&
    ["rect", "ellipse", "line", "arrow", "polygon", "polyline", "measure", "ink", "highlight", "markup", "whiteout"].includes(selectedAnn.kind)
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
    styleAnn?.kind === "polygon" ||
    styleAnn?.kind === "polyline" ||
    styleAnn?.kind === "measure" ||
    styleAnn?.kind === "ink";
  const styleIsFillable =
    styleAnn?.kind === "rect" ||
    styleAnn?.kind === "ellipse" ||
    styleAnn?.kind === "polygon";
  const styleColorLabel =
    styleAnn?.kind === "whiteout" ? "Patch" : styleHasStroke ? "Stroke" : "Color";
  const patchStyleAnn = (p: Partial<ShapeAnnotation>) => {
    if (styleAnn && app.selected && !styleAnn.locked) {
      app.updateAnnotation(app.selected.page, { ...styleAnn, ...p } as Annotation);
    }
  };

  // A selected check / cross mark — its symbol & color are edited in the
  // contextual row (same controls as the armed tool).
  const selectedMark = selectedAnn?.kind === "mark" ? selectedAnn : null;
  const patchSelectedMark = (p: Partial<MarkAnnotation>) => {
    if (selectedMark && app.selected && !selectedMark.locked) {
      app.updateAnnotation(app.selected.page, { ...selectedMark, ...p } as Annotation);
    }
  };

  // Contextual style controls: font options only while working with text,
  // stroke width only for drawing tools (armed-tool defaults; a *selected*
  // annotation is handled by the styleAnn branch instead).
  const showFontControls = app.tool === "text" || !!selectedText;
  const showStroke = ["ink", "rect", "ellipse", "line", "arrow", "polygon", "polyline", "cloud", "measuredist", "measureperim", "measurearea", "callout"].includes(app.tool);
  const isPolyTool =
    app.tool === "polygon" || app.tool === "polyline" || app.tool === "cloud";
  const isMeasureTool =
    app.tool === "measuredist" ||
    app.tool === "measureperim" ||
    app.tool === "measurearea";
  const isMarkupTool =
    app.tool === "underline" || app.tool === "strikeout" || app.tool === "squiggly";
  const showColor =
    showFontControls || showStroke || app.tool === "highlight" || isMarkupTool;
  const showFill =
    app.tool === "rect" ||
    app.tool === "ellipse" ||
    app.tool === "polygon" ||
    app.tool === "cloud";
  const fillValue = app.toolFill;
  const setFill = (v: string | null) => app.setToolFill(v);

  // The second toolbar row appears whenever the armed tool or the current
  // selection has sub-options to show.
  const hasContextual =
    showColor ||
    showFill ||
    app.tool === "edittext" ||
    app.tool === "mark" ||
    app.tool === "link" ||
    !!selectedFormField ||
    !!app.selectedField ||
    !!selectedAnn;
  const insertActive = !!app.pendingStamp || app.formBuilder || app.tool.startsWith("form");
  const InsertIcon =
    app.formBuilder || app.tool.startsWith("form")
      ? FormInput
      : app.pendingStamp
        ? Stamp
        : ImageIcon;

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
          value={basicToolValue}
          onValueChange={handleToolChange}
          className="flex items-center gap-1 bg-transparent p-0"
          aria-label="Basic tools"
        >
          {BASIC_TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.key}
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  t.key === "pan" && "hidden sm:flex",
                )}
              >
                <Tip label={t.name} desc={t.desc} shortcut={t.shortcut}>
                  <ToggleGroupItem
                    value={t.key}
                    aria-label={t.name}
                    className="h-8 w-8 rounded-md data-[pressed]:!bg-primary data-[pressed]:!text-primary-foreground"
                  >
                    <Icon className="h-4 w-4" />
                  </ToggleGroupItem>
                </Tip>
              </div>
            );
          })}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />
        {TOOL_FLYOUTS.map((group) => {
          const activeTool =
            app.pendingStamp ? undefined : group.tools.find((key) => key === app.tool);
          return (
            <ToolFlyoutButton
              key={group.id}
              group={group}
              activeTool={activeTool}
              lastTool={lastToolByGroup[group.id]}
              onSelect={selectTool}
            />
          );
        })}
        <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />
        <Menu>
          <Tip label="Insert" desc="Images, fillable forms and stamps">
            <MenuTrigger
              aria-label="Insert"
              aria-pressed={insertActive}
              className={cn(
                "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                insertActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <InsertIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Insert</span>
              <ChevronDown className="h-3 w-3 opacity-70" />
            </MenuTrigger>
          </Tip>
          <MenuContent className="min-w-64">
            <MenuGroup>
              <MenuLabel>Insert</MenuLabel>
              <ActionMenuItem
                icon={ImageIcon}
                name="Image"
                desc="PNG or JPEG, placed as a stamp"
                onClick={() => imageRef.current?.click()}
              />
              <ActionMenuItem
                icon={FormInput}
                name="Form builder"
                desc="Design fillable forms: palette, tab order, validation"
                active={app.formBuilder || app.tool.startsWith("form")}
                onClick={() => app.setFormBuilder(!app.formBuilder)}
              />
            </MenuGroup>
            <MenuGroup className="mt-1 border-t pt-1">
              <MenuLabel>Stamps</MenuLabel>
              {STAMPS.map((s) => (
                <MenuItem
                  key={s.label}
                  onClick={() => {
                    const { dataUrl, aspect } = makeStamp(s);
                    app.setPendingStamp({ dataUrl, aspect });
                  }}
                  className="py-2"
                >
                  <Stamp className="h-4 w-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="rounded border-2 px-1.5 py-0.5 text-[10px] font-bold italic"
                      style={{ borderColor: s.color, color: s.color }}
                    >
                      {s.label}
                    </span>
                    {s.withDate && (
                      <span className="text-[10px] text-muted-foreground">+ date</span>
                    )}
                  </span>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuContent>
        </Menu>
        <Tip label="Insert signature" desc="Draw, type or upload; saved for reuse">
          <button
            data-tour="sign-document"
            onClick={() => app.setSignatureModalOpen(true)}
            className={cn(
              "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              app.pendingStamp
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Signature className="h-4 w-4" />
            <span className="hidden sm:inline">Sign</span>
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
          <Tip
            label={
              app.docPermissions.restricted
                ? "Restricted document"
                : app.activeWrapped
                  ? "PickPDF-locked document"
                  : "Encrypted document"
            }
            desc={
              app.docPermissions.restricted
                ? "View permissions or unlock"
                : app.activeWrapped
                  ? "Other viewers see a notice page. Open security options."
                  : "Open security options"
            }
          >
            <button
              onClick={() => app.setSecurityModalOpen(true)}
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
          </Tip>
        )}
        {app.tool === "redact" && app.redactCount === 0 && (
          <span className="rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400">
            Draw boxes over content to remove
          </span>
        )}
        {app.redactCount > 0 && (
          <Tip
            label="Apply redactions"
            desc="Permanently deletes text and images under every redaction box; annotations and metadata are not removed."
          >
            <Button
              size="sm"
              className="h-7 gap-1.5 bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={app.applyRedactions}
            >
              <SquareSlash className="h-3.5 w-3.5" />
              Apply {app.redactCount} redaction{app.redactCount === 1 ? "" : "s"}
            </Button>
          </Tip>
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
        {selectedAnn?.locked ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 text-amber-600" />
            Locked · unlock to edit this object
          </span>
        ) : app.tool === "edittext" ? (
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
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                {inlineEdit.commitHint}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* Edit scope: what a click opens — one line (styles stay
                  line-local, the old behavior), the detected paragraph, or
                  the whole contiguous text block. */}
              <ToggleGroup
                value={[app.editTextScope]}
                onValueChange={(v) =>
                  v[0] && app.setEditTextScope(v[0] as EditTextScope)
                }
                aria-label="Edit scope"
                className="shrink-0"
              >
                <Tip label="Line" desc="Edit a single line at a time">
                  <ToggleGroupItem
                    value="line"
                    aria-label="Edit one line"
                    className="h-7 w-auto px-2.5 text-xs"
                  >
                    Line
                  </ToggleGroupItem>
                </Tip>
                <Tip label="Paragraph" desc="Edit the whole paragraph around the clicked line">
                  <ToggleGroupItem
                    value="paragraph"
                    aria-label="Edit the paragraph"
                    className="h-7 w-auto px-2.5 text-xs"
                  >
                    Paragraph
                  </ToggleGroupItem>
                </Tip>
                <Tip
                  label="Block"
                  desc="Edit the whole contiguous text block, across paragraph breaks"
                >
                  <ToggleGroupItem
                    value="block"
                    aria-label="Edit the text block"
                    className="h-7 w-auto px-2.5 text-xs"
                  >
                    Block
                  </ToggleGroupItem>
                </Tip>
              </ToggleGroup>
              <Separator orientation="vertical" className="h-6 shrink-0" />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TextCursorInput className="h-3.5 w-3.5 shrink-0" />
                <span>Click text to edit it. Font, size and color apply to the whole scope.</span>
              </div>
            </div>
          )
        ) : showFontControls ? (
          <>
          <TextStyleControls
            value={{
              color:
                liveEditor?.styleValue("color") ??
                activeBoxDraft?.boxValue("color") ??
                selectedText?.color ??
                app.fontColor,
              fontFamily,
              fontSize:
                liveEditor?.styleValue("fontSize") ??
                activeBoxDraft?.boxValue("fontSize") ??
                selectedText?.fontSize ??
                app.fontSize,
              bold: isBold,
              italic: isItalic,
              underline: isUnderline,
              strike: isStrike,
              align: alignValue,
              lineHeight: selectedText?.lineHeight ?? app.lineHeight,
              letterSpacing: selectedText?.letterSpacing ?? app.letterSpacing,
            }}
            onPatch={(p) => {
              // Tool defaults follow the last choice so new boxes match.
              if (p.color !== undefined) app.setFontColor(p.color);
              if (p.fontFamily !== undefined) app.setFontFamily(p.fontFamily);
              if (p.fontSize !== undefined) app.setFontSize(p.fontSize);
              if (p.bold !== undefined) app.setFontBold(p.bold);
              if (p.italic !== undefined) app.setFontItalic(p.italic);
              if (p.underline !== undefined) app.setFontUnderline(p.underline);
              if (p.strike !== undefined) app.setFontStrike(p.strike);
              if (p.align !== undefined) app.setTextAlign(p.align);
              if (p.lineHeight !== undefined) app.setLineHeight(p.lineHeight);
              if (p.letterSpacing !== undefined) app.setLetterSpacing(p.letterSpacing);
              // Alignment, line-height & letter-spacing are whole-box properties —
              // always patch the annotation directly, never the run selection.
              const { align, lineHeight, letterSpacing, ...runPatch } = p;
              if (align !== undefined) patchSelectedText({ align });
              if (lineHeight !== undefined) patchSelectedText({ lineHeight });
              if (letterSpacing !== undefined) patchSelectedText({ letterSpacing });
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
          {liveBlockEditor && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-6 shrink-0" />
              <BlockFormatControls
                state={liveBlockEditor.state()}
                setKind={(k) => {
                  liveBlockEditor.setKind(k);
                  bumpSel();
                }}
                toggleList={(l) => {
                  liveBlockEditor.toggleList(l);
                  bumpSel();
                }}
                indent={() => {
                  liveBlockEditor.indent();
                  bumpSel();
                }}
                outdent={() => {
                  liveBlockEditor.outdent();
                  bumpSel();
                }}
              />
            </>
          )}
          {selectedText && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-6 shrink-0" />
              <TextLinkControl ann={selectedText} onPatch={patchSelectedText} />
            </>
          )}
          </>
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
        ) : selectedMark ? (
          <div className="flex items-center gap-2">
            <ToggleGroup
              value={[selectedMark.symbol]}
              onValueChange={(v) =>
                v[0] && patchSelectedMark({ symbol: v[0] as MarkSymbol })
              }
              aria-label="Mark symbol"
              className="shrink-0"
            >
              <ToggleGroupItem value="check" aria-label="Check" className="h-7 w-8">
                <Check className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="cross" aria-label="Cross" className="h-7 w-8">
                <X className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Separator orientation="vertical" className="h-6 shrink-0" />
            <ColorSwatch
              value={selectedMark.color}
              onChange={(v) => patchSelectedMark({ color: v })}
              title="Color"
            />
          </div>
        ) : app.tool === "select" ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            Click to select · drag to move · double-click text or fields to edit ·
            Enter/F2 edits selected text or fields
          </span>
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
        ) : app.tool === "mark" ? (
          <div className="flex items-center gap-2">
            <ToggleGroup
              value={[app.markSymbol]}
              onValueChange={(v) =>
                v[0] && app.setMarkSymbol(v[0] as MarkSymbol)
              }
              aria-label="Mark symbol"
              className="shrink-0"
            >
              <ToggleGroupItem value="check" aria-label="Check" className="h-7 w-8">
                <Check className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="cross" aria-label="Cross" className="h-7 w-8">
                <X className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Separator orientation="vertical" className="h-6 shrink-0" />
            <ColorSwatch value={app.markColor} onChange={app.setMarkColor} title="Color" />
            <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
              Click to place · drag to size
            </span>
          </div>
        ) : app.tool === "link" ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            Drag a box over the page to create a link, then set its target.
          </span>
        ) : isMeasureTool ? (
          <>
            <ColorSwatch value={app.toolColor} onChange={app.setToolColor} title="Color" />
            <Separator orientation="vertical" className="h-6 shrink-0" />
            <Button
              variant={app.measureCalibrating ? "default" : "outline"}
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => {
                app.setMeasureCalibrating(true);
                app.setTool("measuredist");
              }}
            >
              <Ruler className="h-3.5 w-3.5" />
              Calibrate
            </Button>
            <span className="shrink-0 text-xs text-muted-foreground">
              {app.measureScale
                ? `1 pt = ${formatScale(app.measureScale.scale)} ${app.measureScale.unit}`
                : "Not calibrated — measuring in PDF points"}
            </span>
            <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground lg:flex">
              {app.measureCalibrating
                ? "· Draw a line over something of known length"
                : app.tool === "measuredist"
                  ? "· Click two points or drag"
                  : "· Click to place points · double-click or Enter finishes · Esc cancels"}
            </span>
          </>
        ) : isPolyTool ? (
          <>
            <ColorSwatch value={app.toolColor} onChange={app.setToolColor} title="Color" />
            <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
              Click to place points · double-click or Enter finishes · Esc cancels
            </span>
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
            <Tip label={selectedAnn.locked ? "Unlock object" : "Lock object"}>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  selectedAnn.locked
                    ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                    : "text-muted-foreground",
                )}
                aria-label={selectedAnn.locked ? "Unlock object" : "Lock object"}
                aria-pressed={!!selectedAnn.locked}
                onClick={toggleSelectedLock}
              >
                {selectedAnn.locked ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <LockOpen className="h-4 w-4" />
                )}
              </Button>
            </Tip>
            {!selectedAnn.locked && ROTATABLE_KINDS.has(selectedAnn.kind) && (
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
            {!selectedAnn.locked && <Tip label="Duplicate">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="Duplicate"
                onClick={duplicateSelected}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </Tip>}
            {!selectedAnn.locked && <Tip label="Delete">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete"
                onClick={deleteSelected}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tip>}
          </div>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}

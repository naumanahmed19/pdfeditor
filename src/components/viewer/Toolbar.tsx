import { useEffect, useRef } from "react";
import {
  Bold,
  Circle,
  CircleDot,
  Eraser,
  FormInput,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  List,
  MessageSquare,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Signature,
  SquareSlash,
  Square,
  SquareCheck,
  TextCursorInput,
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
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { Tip, TooltipProvider } from "../ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { cn } from "../../lib/utils";
import type {
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
  { key: "whiteout", icon: Eraser, name: "Whiteout", desc: "Covers content — it still exists in the file", group: 4, shortcut: "W" },
  { key: "redact", icon: SquareSlash, name: "Redact", desc: "Permanently removes covered content — draw boxes, then Apply", group: 4, shortcut: "X" },
];

export function EditorToolbar() {
  const app = useApp();
  const imageRef = useRef<HTMLInputElement>(null);

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

  // A selected rect/ellipse annotation (fillable shapes).
  const selectedShape = (() => {
    if (!app.selected) return null;
    const ann = (app.annotations[app.selected.page] ?? []).find(
      (a) => a.id === app.selected!.id,
    );
    return ann && (ann.kind === "rect" || ann.kind === "ellipse") ? ann : null;
  })();

  const patchSelectedShape = (patch: Partial<ShapeAnnotation>) => {
    if (selectedShape && app.selected) {
      app.updateAnnotation(app.selected.page, {
        ...selectedShape,
        ...patch,
      } as ShapeAnnotation);
    }
  };

  const fontFamily = selectedText?.fontFamily ?? app.fontFamily;
  const isBold = selectedText ? !!selectedText.bold : app.fontBold;
  const isItalic = selectedText ? !!selectedText.italic : app.fontItalic;
  const isUnderline = selectedText ? !!selectedText.underline : app.fontUnderline;
  const isStrike = selectedText ? !!selectedText.strike : app.fontStrike;
  const alignValue = selectedText?.align ?? app.textAlign;

  // Contextual style controls: font options only while working with text,
  // stroke width only for drawing tools.
  const showFontControls = app.tool === "text" || !!selectedText;
  const showStroke = ["ink", "rect", "ellipse", "line"].includes(app.tool);
  const showColor = showFontControls || showStroke || app.tool === "highlight";
  // Fill applies to the rectangle/ellipse tools and to a selected rect/ellipse.
  const showFill =
    app.tool === "rect" || app.tool === "ellipse" || !!selectedShape;
  const fillValue = selectedShape ? selectedShape.fill ?? null : app.toolFill;
  const setFill = (v: string | null) => {
    if (selectedShape) patchSelectedShape({ fill: v ?? undefined });
    else app.setToolFill(v);
  };

  return (
    // data-ann-controls: pressing toolbar controls must not deselect the
    // annotation or dismiss its popover (see AnnotationItem's onOpenChange).
    <TooltipProvider delay={350}>
    <div
      data-ann-controls
      role="toolbar"
      aria-label="PDF editing tools"
      className="flex flex-wrap items-center gap-1 border-b bg-background/95 px-3 py-1.5 backdrop-blur"
    >
      {/* tools */}
      <ToggleGroup
        value={toolValue}
        onValueChange={handleToolChange}
        className="flex flex-wrap items-center gap-1 bg-transparent p-0"
        aria-label="Annotation tools"
      >
        {TOOLS.map((t, i) => (
          <div key={t.key} className="flex items-center gap-1">
            {i > 0 && t.group !== TOOLS[i - 1].group && (
              <div className="mx-1 h-6 w-px bg-border" />
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
      <div className="mx-1 h-6 w-px bg-border" />
      <Tip label="Insert image" desc="PNG or JPEG, placed as a stamp">
        <button
          onClick={() => imageRef.current?.click()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </Tip>
      <Menu>
        <MenuTrigger
          className={cn(
            "flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
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
            "flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            app.pendingStamp
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Signature className="h-4 w-4" />
          Sign
        </button>
      </Tip>
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

      {/* style controls — contextual */}
      <div className="ml-1 flex items-center gap-1.5">
        {showFontControls ? (
          <TextStyleControls
            value={{
              color: selectedText?.color ?? app.toolColor,
              fontFamily,
              fontSize: selectedText?.fontSize ?? app.fontSize,
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
              className="h-7 w-32 px-2 text-xs"
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
                className="h-7 w-56 px-2 text-xs"
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
                className="h-7 w-28 px-2 text-xs"
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
              className="h-7 w-32 px-2 text-xs"
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
              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
              onClick={() => {
                app.upsertFieldOp(app.selectedField!, { deleted: true });
                app.setSelectedField(null);
              }}
            >
              Delete field
            </Button>
          </>
        )}
      </div>

      <div className="mx-1 h-6 w-px bg-border" />

      <Tip label="Undo" shortcut="Ctrl+Z">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
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
          className="h-8 w-8 text-muted-foreground"
          disabled={!app.canRedo}
          onClick={app.redo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
      </Tip>

      <div className="ml-auto flex items-center gap-1">
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
    </TooltipProvider>
  );
}

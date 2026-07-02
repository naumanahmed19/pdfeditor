import { useRef } from "react";
import {
  Bold,
  Circle,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Minus,
  MousePointer2,
  PenLine,
  Pencil,
  Redo2,
  Square,
  TextCursorInput,
  Type,
  Undo2,
} from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn } from "../../lib/utils";
import type { FontFamilyKind, TextAnnotation, ToolKind } from "../../types";

const TOOLS: Array<{ key: ToolKind; icon: typeof Type; label: string }> = [
  { key: "select", icon: MousePointer2, label: "Select / move (text selection)" },
  { key: "text", icon: Type, label: "Add text" },
  { key: "edittext", icon: TextCursorInput, label: "Edit existing text (click a line)" },
  { key: "highlight", icon: Highlighter, label: "Highlight" },
  { key: "ink", icon: Pencil, label: "Draw freehand" },
  { key: "rect", icon: Square, label: "Rectangle" },
  { key: "ellipse", icon: Circle, label: "Ellipse" },
  { key: "line", icon: Minus, label: "Line" },
  { key: "whiteout", icon: Eraser, label: "Whiteout (cover content)" },
];

export function EditorToolbar() {
  const app = useApp();
  const imageRef = useRef<HTMLInputElement>(null);

  if (!app.pdf) return null;

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

  const fontFamily = selectedText?.fontFamily ?? app.fontFamily;
  const isBold = selectedText ? !!selectedText.bold : app.fontBold;
  const isItalic = selectedText ? !!selectedText.italic : app.fontItalic;

  // Contextual style controls: font options only while working with text,
  // stroke width only for drawing tools.
  const showFontControls = app.tool === "text" || !!selectedText;
  const showStroke = ["ink", "rect", "ellipse", "line"].includes(app.tool);
  const showColor = showFontControls || showStroke;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
      {/* tools */}
      <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            title={t.label}
            onClick={() => {
              app.setTool(t.key);
              app.setPendingStamp(null);
              if (t.key !== "select") app.setSelected(null);
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
              app.tool === t.key && !app.pendingStamp
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
          </button>
        ))}
        <button
          title="Insert image"
          onClick={() => imageRef.current?.click()}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
        <button
          title="Insert signature"
          onClick={() => app.setSignatureModalOpen(true)}
          className={cn(
            "flex h-7 items-center justify-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors",
            app.pendingStamp
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <PenLine className="h-4 w-4" />
          Sign
        </button>
      </div>
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
        {showColor && (
          <input
            type="color"
            value={selectedText?.color ?? app.toolColor}
            onChange={(e) => {
              app.setToolColor(e.target.value);
              patchSelectedText({ color: e.target.value });
            }}
            title="Color"
            className="h-6 w-6 cursor-pointer rounded border border-input bg-background p-0.5"
          />
        )}
        {showFontControls && (
          <>
            <Select
              value={fontFamily}
              onChange={(e) => {
                const v = e.target.value as FontFamilyKind;
                app.setFontFamily(v);
                // Clear the embedded display font so the chosen family shows.
                patchSelectedText({ fontFamily: v, displayFontCss: undefined });
              }}
              aria-label="Font family"
              className="h-7 w-24 px-2 text-xs"
            >
              <option value="helvetica">Helvetica</option>
              <option value="times">Times</option>
              <option value="courier">Courier</option>
              <option value="carlito">Carlito (Calibri)</option>
              <option value="caladea">Caladea (Cambria)</option>
            </Select>
            <button
              title="Bold"
              onClick={() => {
                const next = !isBold;
                app.setFontBold(next);
                patchSelectedText({ bold: next });
              }}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md border border-input transition-colors",
                isBold
                  ? "bg-accent text-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              title="Italic"
              onClick={() => {
                const next = !isItalic;
                app.setFontItalic(next);
                patchSelectedText({ italic: next });
              }}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md border border-input transition-colors",
                isItalic
                  ? "bg-accent text-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <Select
              value={selectedText?.fontSize ?? app.fontSize}
              onChange={(e) => {
                app.setFontSize(Number(e.target.value));
                patchSelectedText({ fontSize: Number(e.target.value) });
              }}
              aria-label="Font size"
              className="h-7 w-[4.75rem] px-2 text-xs"
            >
              {[...new Set([10, 12, 14, 16, 18, 22, 28, 36, selectedText?.fontSize ?? app.fontSize])]
                .sort((a, b) => a - b)
                .map((s) => (
                  <option key={s} value={s}>
                    {s}pt
                  </option>
                ))}
            </Select>
          </>
        )}
        {showStroke && (
          <Select
            value={app.strokeWidth}
            onChange={(e) => app.setStrokeWidth(Number(e.target.value))}
            aria-label="Stroke width"
            className="h-7 w-[4.75rem] px-2 text-xs"
          >
            {[1, 2, 3, 4, 6, 8].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!app.canUndo}
        onClick={app.undo}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!app.canRedo}
        onClick={app.redo}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 className="h-4 w-4" />
      </Button>

      <div className="ml-auto flex items-center gap-1">
        {app.pendingStamp && (
          <span className="rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            Click on the page to place — Esc to cancel
          </span>
        )}
      </div>
    </div>
  );
}

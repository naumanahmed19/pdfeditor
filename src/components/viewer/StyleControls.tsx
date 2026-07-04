// Shared annotation style controls — ONE implementation used by both the
// editor toolbar (tool defaults / selected annotation) and the selection
// popover, so the two always look and behave identically.
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Button } from "../ui/button";
import { ColorSwatch } from "../ui/color-swatch";
import { Select } from "../ui/select";
import { hexToRgb01 } from "../../lib/utils";
import type { FontFamilyKind } from "../../types";

/** Perceived-luminance check so overlay icons stay readable on any color. */
function isDarkColor(hex: string): boolean {
  const { r, g, b } = hexToRgb01(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.55;
}

export const FONT_OPTIONS: Array<{ v: FontFamilyKind; label: string }> = [
  { v: "helvetica", label: "Helvetica" },
  { v: "times", label: "Times" },
  { v: "courier", label: "Courier" },
  { v: "carlito", label: "Carlito (Calibri)" },
  { v: "caladea", label: "Caladea (Cambria)" },
];

const FONT_SIZES = [10, 12, 14, 16, 18, 22, 28, 36];

export interface TextStyleValue {
  color: string;
  fontFamily: FontFamilyKind;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Box-level paragraph alignment. */
  align: "left" | "center" | "right";
}

const NEXT_ALIGN = { left: "center", center: "right", right: "left" } as const;
const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

/** Canonical text styling row: swatch · family · size · B · I · U · S · align. */
export function TextStyleControls({
  value,
  onPatch,
}: {
  value: TextStyleValue;
  onPatch: (p: Partial<TextStyleValue>) => void;
}) {
  const AlignIcon = ALIGN_ICON[value.align];
  return (
    <>
      <ColorSwatch
        value={value.color}
        onChange={(v) => onPatch({ color: v })}
        title="Text color"
      />
      <Select
        value={value.fontFamily}
        onChange={(e) => onPatch({ fontFamily: e.target.value as FontFamilyKind })}
        aria-label="Font family"
        className="h-7 w-24 px-2 text-xs"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.v} value={f.v}>
            {f.label}
          </option>
        ))}
      </Select>
      <Select
        value={String(value.fontSize)}
        onChange={(e) => onPatch({ fontSize: Number(e.target.value) })}
        aria-label="Font size"
        className="h-7 w-[4.75rem] px-2 text-xs"
      >
        {[...new Set([...FONT_SIZES, value.fontSize])]
          .sort((a, b) => a - b)
          .map((s) => (
            <option key={s} value={s}>
              {s}pt
            </option>
          ))}
      </Select>
      <Button
        variant={value.bold ? "subtle" : "ghost"}
        size="icon"
        className="h-7 w-7"
        title="Bold"
        onClick={() => onPatch({ bold: !value.bold })}
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={value.italic ? "subtle" : "ghost"}
        size="icon"
        className="h-7 w-7"
        title="Italic"
        onClick={() => onPatch({ italic: !value.italic })}
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={value.underline ? "subtle" : "ghost"}
        size="icon"
        className="h-7 w-7"
        title="Underline"
        onClick={() => onPatch({ underline: !value.underline })}
      >
        <Underline className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={value.strike ? "subtle" : "ghost"}
        size="icon"
        className="h-7 w-7"
        title="Strikethrough"
        onClick={() => onPatch({ strike: !value.strike })}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={`Align: ${value.align} — click to change`}
        onClick={() => onPatch({ align: NEXT_ALIGN[value.align] })}
      >
        <AlignIcon className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

/** Chrome-style pastel palette for the highlighter. */
export const HIGHLIGHT_PRESETS = [
  "#facc15", // yellow (default)
  "#a7f3d0", // green
  "#bfdbfe", // blue
  "#fbcfe8", // pink
  "#fed7aa", // orange
  "#ddd6fe", // violet
];

/** Stronger palette for pen/shape strokes. */
export const INK_PRESETS = [
  "#e11d48", // red (default)
  "#1d4ed8", // blue
  "#047857", // green
  "#111111", // black
  "#f59e0b", // amber
  "#7c3aed", // violet
];

/** One-click color presets (browser-style), with the custom picker at the end. */
export function ColorPresets({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {colors.map((c) => (
        <button
          key={c}
          title={c}
          aria-label={`Color ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          onClick={() => onChange(c)}
          className={
            "h-5 w-5 rounded-full border border-black/15 shadow-sm transition-transform hover:scale-110 dark:border-white/20 " +
            (value.toLowerCase() === c.toLowerCase()
              ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
              : "")
          }
          style={{ backgroundColor: c }}
        />
      ))}
      <span className="relative inline-flex" title="Custom color">
        <ColorSwatch value={value} onChange={onChange} title="Custom color" className="h-5 w-5" />
        <Plus
          className={
            "pointer-events-none absolute inset-0 m-auto h-3 w-3 " +
            (isDarkColor(value)
              ? "text-white/90 drop-shadow-[0_0_1.5px_rgba(0,0,0,0.6)]"
              : "text-black/60 drop-shadow-[0_0_1.5px_rgba(255,255,255,0.95)]")
          }
          strokeWidth={3}
        />
      </span>
    </div>
  );
}

/** Browser-style stroke size presets: growing dots instead of a dropdown. */
export function SizePresets({
  sizes = [1, 2, 3, 5, 8],
  value,
  onChange,
}: {
  sizes?: number[];
  value: number;
  onChange: (w: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      {sizes.map((s) => (
        <button
          key={s}
          title={`${s}px`}
          aria-label={`Stroke ${s}px`}
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={
            "flex h-7 w-7 items-center justify-center rounded-sm transition-colors " +
            (value === s
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          <span
            className="rounded-full bg-current"
            style={{ width: 2 + s * 1.4, height: 2 + s * 1.4 }}
          />
        </button>
      ))}
    </div>
  );
}

/** Canonical stroke-width picker (self-labelled options, no side label). */
export function StrokeWidthSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (w: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Stroke width"
      className="h-7 w-[4.75rem] px-2 text-xs"
    >
      {[0, 1, 2, 3, 4, 6, 8].map((w) => (
        <option key={w} value={w}>
          {w === 0 ? "No border" : `${w}px`}
        </option>
      ))}
    </Select>
  );
}

/** Canonical fill control: labelled chip with swatch + remove, or Add. */
export function FillControl({
  value,
  onChange,
  defaultColor = "#3b82f6",
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  defaultColor?: string;
}) {
  return (
    <div className="flex h-7 items-center gap-1 rounded-md border border-input px-1.5">
      <span className="text-[10px] font-medium text-muted-foreground">Fill</span>
      {value ? (
        <>
          <ColorSwatch value={value} onChange={onChange} title="Fill color" className="h-5 w-5" />
          <button
            title="Remove fill"
            onClick={() => onChange(null)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ×
          </button>
        </>
      ) : (
        <button
          title="Add a fill color"
          onClick={() => onChange(defaultColor)}
          className="rounded px-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          None
        </button>
      )}
    </div>
  );
}

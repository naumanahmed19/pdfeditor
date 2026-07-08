// Shared annotation style controls — ONE implementation used by both the
// editor toolbar (tool defaults / selected annotation) and the selection
// popover, so the two always look and behave identically.
import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Italic,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";
import { ColorPopover } from "../ui/color-popover";
import { ColorSwatch } from "../ui/color-swatch";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select } from "../ui/select";
import { Separator } from "../ui/separator";
import { Tip } from "../ui/tooltip";
import { ToggleGroupItem } from "../ui/toggle-group";
import { cn, hexToRgb01 } from "../../lib/utils";
import type { FontFamilyKind } from "../../types";

/** Perceived-luminance check so overlay icons stay readable on any color. */
function isDarkColor(hex: string): boolean {
  const { r, g, b } = hexToRgb01(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.55;
}

export const FONT_OPTIONS: Array<{ v: FontFamilyKind; label: string }> = [
  { v: "helvetica", label: "Helvetica" },
  { v: "roboto", label: "Roboto" },
  { v: "opensans", label: "Open Sans" },
  { v: "montserrat", label: "Montserrat" },
  { v: "carlito", label: "Carlito (Calibri)" },
  { v: "times", label: "Times" },
  { v: "lora", label: "Lora" },
  { v: "caladea", label: "Caladea (Cambria)" },
  { v: "courier", label: "Courier" },
];

/** Sentinel value for the "Request a font…" picker entry (not a real family). */
export const REQUEST_FONT_VALUE = "__request_font__";

// Where "Request a font…" sends users. Change this to your support inbox/form.
const FONT_REQUEST_EMAIL = "naumanahmed19@gmail.com";

/** Open the user's mail client with a prefilled font request. */
function requestFont() {
  const subject = encodeURIComponent("PickPDF — font request");
  const body = encodeURIComponent(
    "Which font would you like added to PickPDF?\n\nFont name:\nLink (optional):\n",
  );
  window.open(`mailto:${FONT_REQUEST_EMAIL}?subject=${subject}&body=${body}`, "_blank");
}

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;

/** Format a number for display: fixed decimals, trailing zeros trimmed. */
function fmtNum(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Editable numeric combobox — type any value (clamped to [min, max] and rounded
 * to `decimals`) OR pick a preset from the chevron dropdown. Reused for font
 * size, line height and letter spacing. `↑/↓` nudge by `step`.
 */
export function NumberComboField({
  value,
  onChange,
  presets,
  min,
  max,
  step,
  decimals = 0,
  suffix = "",
  formatOption,
  ariaLabel,
  fieldClassName = "w-[4.5rem]",
}: {
  value: number;
  onChange: (n: number) => void;
  presets: number[];
  min: number;
  max: number;
  step: number;
  decimals?: number;
  /** Small adornment shown inside the input, e.g. "pt" or "×". */
  suffix?: string;
  /** Dropdown label for a preset (defaults to formatted value + suffix). */
  formatOption?: (n: number) => string;
  ariaLabel: string;
  /** Width utility for the input (defaults to w-[4.5rem]). */
  fieldClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(fmtNum(value, decimals));
  // Follow the external value (selection change, preset pick, arrow keys).
  useEffect(() => setDraft(fmtNum(value, decimals)), [value, decimals]);

  const roundClamp = (n: number) =>
    Number(Math.min(max, Math.max(min, n)).toFixed(decimals));

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) {
      const v = roundClamp(n);
      onChange(v);
      setDraft(fmtNum(v, decimals));
    } else {
      setDraft(fmtNum(value, decimals)); // revert empty / invalid entry
    }
  };

  // Digits only when integer; allow a single decimal point otherwise.
  const filter = (raw: string) =>
    (decimals > 0 ? raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") : raw.replace(/[^\d]/g, "")).slice(0, 6);

  const optionLabel = formatOption ?? ((n: number) => `${fmtNum(n, decimals)}${suffix}`);

  return (
    <div className="relative flex items-center">
      <Input
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(filter(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(roundClamp(value + step));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(roundClamp(value - step));
          }
        }}
        className={cn("h-8 pr-9 text-xs", fieldClassName)}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-6 text-[10px] text-muted-foreground">
          {suffix}
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <Tip label="Presets">
          <PopoverTrigger
            aria-label={`${ariaLabel} presets`}
            className="absolute right-0 flex h-8 w-6 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </PopoverTrigger>
        </Tip>
        {/* data-ann-controls: picking a preset must not end the text-editing session. */}
        <PopoverContent data-ann-controls align="end" className="max-h-64 w-24 overflow-y-auto p-1">
          <div className="flex flex-col">
            {presets.map((s) => (
              <button
                key={s}
                type="button"
                // Keep focus/selection where it is, then apply.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(roundClamp(s));
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 items-center rounded-sm px-2 text-sm hover:bg-muted",
                  s === value && "bg-muted font-medium",
                )}
              >
                {optionLabel(s)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

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
  /** Box-level line-height multiplier. */
  lineHeight: number;
  /** Box-level letter spacing, in PDF points. */
  letterSpacing: number;
}

export const LINE_HEIGHT_OPTIONS = [1, 1.15, 1.25, 1.5, 1.75, 2];
export const LETTER_SPACING_OPTIONS = [0, 0.5, 1, 1.5, 2, 3];

/** shadcn-style toggle: 32px square, primary fill when pressed. */
export function StyleToggle({
  label,
  icon: Icon,
  pressed,
  disabled,
  onPressedChange,
}: {
  label: string;
  icon: typeof Bold;
  pressed: boolean;
  disabled?: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  return (
    <Tip label={label}>
      <ToggleGroupItem
        value={label}
        aria-label={label}
        pressed={pressed}
        disabled={disabled}
        onPressedChange={onPressedChange}
        className="h-8 w-8 rounded-md data-[pressed]:!bg-primary data-[pressed]:!text-primary-foreground"
      >
        <Icon className="h-4 w-4" />
      </ToggleGroupItem>
    </Tip>
  );
}

const ALIGN_OPTIONS = [
  { v: "left", label: "Align left", icon: AlignLeft },
  { v: "center", label: "Align center", icon: AlignCenter },
  { v: "right", label: "Align right", icon: AlignRight },
] as const;

/** Canonical text styling row: family · size | B I U S | align | color. */
export function TextStyleControls({
  value,
  onPatch,
}: {
  value: TextStyleValue;
  onPatch: (p: Partial<TextStyleValue>) => void;
}) {
  return (
    <>
      <Select
        value={value.fontFamily}
        onChange={(e) => {
          if (e.target.value === REQUEST_FONT_VALUE) {
            requestFont();
            return;
          }
          onPatch({ fontFamily: e.target.value as FontFamilyKind });
        }}
        aria-label="Font family"
        className="h-8 w-24 px-2 text-xs"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.v} value={f.v}>
            {f.label}
          </option>
        ))}
        <option value={REQUEST_FONT_VALUE}>Request a font…</option>
      </Select>
      <NumberComboField
        value={value.fontSize}
        onChange={(fontSize) => onPatch({ fontSize })}
        presets={FONT_SIZES}
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        step={1}
        suffix="pt"
        ariaLabel="Font size"
      />
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <StyleToggle
        label="Bold"
        icon={Bold}
        pressed={value.bold}
        onPressedChange={(p) => onPatch({ bold: p })}
      />
      <StyleToggle
        label="Italic"
        icon={Italic}
        pressed={value.italic}
        onPressedChange={(p) => onPatch({ italic: p })}
      />
      <StyleToggle
        label="Underline"
        icon={Underline}
        pressed={value.underline}
        onPressedChange={(p) => onPatch({ underline: p })}
      />
      <StyleToggle
        label="Strikethrough"
        icon={Strikethrough}
        pressed={value.strike}
        onPressedChange={(p) => onPatch({ strike: p })}
      />
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      {ALIGN_OPTIONS.map((a) => (
        <StyleToggle
          key={a.v}
          label={a.label}
          icon={a.icon}
          pressed={value.align === a.v}
          onPressedChange={() => onPatch({ align: a.v })}
        />
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <Popover>
        <Tip label="Line & letter spacing">
          <PopoverTrigger
            aria-label="Line & letter spacing"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent data-[popup-open]:bg-accent"
          >
            <Baseline className="h-4 w-4" />
          </PopoverTrigger>
        </Tip>
        {/* data-ann-controls: adjusting spacing must not end the text-editing
            session (see Viewer's onOpenChange / the editor's onCommit). */}
        <PopoverContent data-ann-controls align="start" className="w-56 p-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span className="text-muted-foreground">Line height</span>
              <NumberComboField
                value={value.lineHeight}
                onChange={(lineHeight) => onPatch({ lineHeight })}
                presets={LINE_HEIGHT_OPTIONS}
                min={0.5}
                max={4}
                step={0.05}
                decimals={2}
                suffix="×"
                ariaLabel="Line height"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span className="text-muted-foreground">Letter spacing</span>
              <NumberComboField
                value={value.letterSpacing}
                onChange={(letterSpacing) => onPatch({ letterSpacing })}
                presets={LETTER_SPACING_OPTIONS}
                min={0}
                max={20}
                step={0.5}
                decimals={1}
                suffix="pt"
                formatOption={(n) => (n === 0 ? "None" : `${fmtNum(n, 1)}pt`)}
                ariaLabel="Letter spacing"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <ColorPopover
        label="Text color"
        value={value.color}
        onChange={(c) => c && onPatch({ color: c })}
      />
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

/** Canonical fill control: label + swatch popover with a "none" cell. */
export function FillControl({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium text-muted-foreground">Fill</span>
      <ColorPopover label="Fill color" value={value} onChange={onChange} allowNone />
    </div>
  );
}

import { Check, Slash } from "lucide-react";
import { cn } from "../../lib/utils";
import { hexToRgb01 } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { ColorSwatch } from "./color-swatch";
import { Tip } from "./tooltip";

/** Shared editor palette (dark → bright → white). */
export const SWATCHES = [
  "#0f172a",
  "#475569",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#ec4899",
  "#ffffff",
] as const;

function isLight(hex: string): boolean {
  const { r, g, b } = hexToRgb01(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b >= 0.55;
}

/**
 * Swatch-grid color picker in a popover (shadcn-style), with a custom-color
 * input at the end. Pass `allowNone` for clearable colors (e.g. shape fill).
 */
export function ColorPopover({
  label,
  value,
  onChange,
  hollow = false,
  allowNone = false,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Render a hollow ring instead of a filled dot (useful for stroke). */
  hollow?: boolean;
  /** Show a "none" cell that clears the color. */
  allowNone?: boolean;
}) {
  return (
    <Popover>
      <Tip label={label}>
        <PopoverTrigger
          aria-label={`${label}: ${value ?? "none"}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
        >
          {value ? (
            <span
              className={cn(
                "h-4 w-4 rounded-full ring-1 ring-inset ring-foreground/15",
                hollow && "ring-2",
              )}
              style={
                hollow
                  ? { boxShadow: `inset 0 0 0 2px ${value}` }
                  : { backgroundColor: value }
              }
            />
          ) : (
            <span className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-inset ring-foreground/25">
              <Slash className="h-3 w-3" />
            </span>
          )}
        </PopoverTrigger>
      </Tip>
      {/* data-ann-controls: picking a color must not dismiss the annotation
          popover or end the text-editing session (see Viewer's onOpenChange). */}
      <PopoverContent data-ann-controls align="start" className="w-auto p-2">
        <p className="mb-1.5 px-0.5 text-xs font-medium text-muted-foreground">{label}</p>
        <div className="grid grid-cols-5 gap-1.5">
          {allowNone && (
            <button
              type="button"
              aria-label="No color"
              // Keep focus (and the text selection) where it is.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onChange(null)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground ring-1 ring-inset ring-foreground/10 transition-transform hover:scale-105"
            >
              <Slash className="h-3.5 w-3.5" />
            </button>
          )}
          {SWATCHES.map((swatch) => {
            const active = !!value && swatch.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onChange(swatch)}
                className="flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset ring-foreground/10 transition-transform hover:scale-105"
                style={{ backgroundColor: swatch }}
              >
                {active && (
                  <Check
                    className={cn("h-3.5 w-3.5", isLight(swatch) ? "text-foreground" : "text-white")}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-1.5 px-0.5">
          <span className="text-xs text-muted-foreground">Custom</span>
          <ColorSwatch
            value={value ?? "#111111"}
            onChange={(c) => onChange(c)}
            title="Custom color"
            className="h-5 w-5"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

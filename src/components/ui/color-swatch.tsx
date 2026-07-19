import * as React from "react";
import { cn } from "../../lib/utils";
import { Tip } from "./tooltip";

interface ColorSwatchProps {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
  disabled?: boolean;
  /** Size/spacing overrides (default h-6 w-6). */
  className?: string;
}

/**
 * Design-system color picker: a round swatch filled with the current color;
 * clicking it opens the native color picker (the real input is stretched
 * invisibly over the circle).
 */
export const ColorSwatch = React.forwardRef<HTMLInputElement, ColorSwatchProps>(
  ({ value, onChange, title, disabled, className }, ref) => (
    <Tip label={title ?? "Pick color"}>
      <span
        className={cn(
          "relative inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full border border-black/15 shadow-sm ring-offset-background transition-transform focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 hover:scale-110 dark:border-white/20",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
        style={{ backgroundColor: value }}
      >
        <input
          ref={ref}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={title ?? "Pick color"}
        />
      </span>
    </Tip>
  ),
);
ColorSwatch.displayName = "ColorSwatch";

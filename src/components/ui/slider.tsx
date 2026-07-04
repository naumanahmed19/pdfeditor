import * as React from "react";
import { Slider as BaseSlider } from "@base-ui-components/react/slider";
import { cn } from "../../lib/utils";

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Design-system single-thumb slider built on Base UI (matches Select/Checkbox styling). */
export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, onValueChange, min = 0, max = 100, step = 1, disabled, className, ...props }, ref) => (
    <BaseSlider.Root
      ref={ref}
      value={value}
      onValueChange={(v) => onValueChange(Array.isArray(v) ? v[0] : v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn("w-full", className)}
    >
      <BaseSlider.Control
        className="flex h-4 w-full touch-none select-none items-center"
        aria-label={props["aria-label"]}
      >
        <BaseSlider.Track className="h-1.5 w-full grow rounded-full bg-muted">
          <BaseSlider.Indicator className="rounded-full bg-primary" />
          <BaseSlider.Thumb className="h-4 w-4 rounded-full border border-primary/50 bg-background shadow-sm outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  ),
);
Slider.displayName = "Slider";

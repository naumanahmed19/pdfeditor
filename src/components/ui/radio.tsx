import * as React from "react";
import { RadioGroup as BaseRadioGroup } from "@base-ui-components/react/radio-group";
import { Radio as BaseRadio } from "@base-ui-components/react/radio";
import { cn } from "../../lib/utils";

/** Design-system radio group (matches Checkbox/Select styling). */
export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof BaseRadioGroup>,
  React.ComponentPropsWithoutRef<typeof BaseRadioGroup>
>(({ className, ...props }, ref) => (
  <BaseRadioGroup ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

/**
 * A single radio option: the circular control plus an inline label. Keep any
 * extra controls (e.g. a range Input) as siblings after the label text — not
 * inside — so clicking them doesn't select the radio.
 */
export function Radio({
  value,
  disabled,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}>
      <BaseRadio.Root
        value={value}
        disabled={disabled}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-input bg-background outline-none transition-colors",
          "hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
          "data-[checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <BaseRadio.Indicator className="h-2 w-2 rounded-full bg-primary" />
      </BaseRadio.Root>
      {children}
    </label>
  );
}

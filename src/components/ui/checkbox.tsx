import * as React from "react";
import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

/** Design-system checkbox built on Base UI (matches the Select/Menu styling). */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof BaseCheckbox.Root>,
  React.ComponentPropsWithoutRef<typeof BaseCheckbox.Root>
>(({ className, ...props }, ref) => (
  <BaseCheckbox.Root
    ref={ref}
    className={cn(
      "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background outline-none transition-colors",
      "hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
      "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <BaseCheckbox.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3 w-3" strokeWidth={3} />
    </BaseCheckbox.Indicator>
  </BaseCheckbox.Root>
));
Checkbox.displayName = "Checkbox";

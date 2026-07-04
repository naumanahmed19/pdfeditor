import * as React from "react";
import { ToggleGroup as BaseToggleGroup } from "@base-ui-components/react/toggle-group";
import { Toggle as BaseToggle } from "@base-ui-components/react/toggle";
import { cn } from "../../lib/utils";

/**
 * Single-select segmented control built on Base UI. Renders a muted track by
 * default; pass a plain className to embed it inside an existing track.
 */
export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof BaseToggleGroup>,
  React.ComponentPropsWithoutRef<typeof BaseToggleGroup>
>(({ className, ...props }, ref) => (
  <BaseToggleGroup
    ref={ref}
    className={cn(
      "inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5",
      className,
    )}
    {...props}
  />
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof BaseToggle>,
  React.ComponentPropsWithoutRef<typeof BaseToggle>
>(({ className, ...props }, ref) => (
  <BaseToggle
    ref={ref}
    className={cn(
      "flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors",
      "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
      "data-[pressed]:bg-background data-[pressed]:text-foreground data-[pressed]:shadow-sm",
      "disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";

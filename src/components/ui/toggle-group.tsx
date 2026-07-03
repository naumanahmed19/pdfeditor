import * as React from "react";
import { ToggleGroup as BaseToggleGroup } from "@base-ui-components/react/toggle-group";
import { Toggle as BaseToggle } from "@base-ui-components/react/toggle";
import { cn } from "../../lib/utils";

/** Single-select segmented control, styled like the default shadcn toggle group. */
export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof BaseToggleGroup>,
  React.ComponentPropsWithoutRef<typeof BaseToggleGroup>
>(({ className, ...props }, ref) => (
  <BaseToggleGroup
    ref={ref}
    className={cn("flex items-center gap-1", className)}
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
      "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors",
      "hover:bg-muted hover:text-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "data-[pressed]:bg-accent data-[pressed]:text-accent-foreground",
      "disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";

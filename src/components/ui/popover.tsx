import * as React from "react";
import { Popover as BasePopover } from "@base-ui-components/react/popover";
import { cn } from "../../lib/utils";

const Popover = BasePopover.Root;

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof BasePopover.Trigger>,
  React.ComponentPropsWithoutRef<typeof BasePopover.Trigger>
>(({ className, ...props }, ref) => (
  <BasePopover.Trigger
    ref={ref}
    className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    {...props}
  />
));
PopoverTrigger.displayName = "PopoverTrigger";

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof BasePopover.Popup> & {
  side?: React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>["side"];
  align?: React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>["align"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>["sideOffset"];
  /** Anchor element/ref/virtual — for popovers not opened from a Trigger. */
  anchor?: React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>["anchor"];
  /** Extra classes for the positioner — e.g. a higher z-index when the
   *  popover must sit above a modal overlay (which uses z-[60]). */
  positionerClassName?: string;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof BasePopover.Popup>,
  PopoverContentProps
>(({ className, side = "bottom", align = "center", sideOffset = 6, anchor, positionerClassName, ...props }, ref) => (
  <BasePopover.Portal>
    <BasePopover.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      anchor={anchor}
      className={cn("z-50", positionerClassName)}
    >
      <BasePopover.Popup
        ref={ref}
        className={cn(
          "rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none",
          "origin-[var(--transform-origin)] transition-[opacity,transform] duration-150",
          "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
          className,
        )}
        {...props}
      />
    </BasePopover.Positioner>
  </BasePopover.Portal>
));
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };

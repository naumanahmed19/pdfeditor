import * as React from "react";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { cn } from "../../lib/utils";

const Menu = BaseMenu.Root;

const MenuTrigger = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Trigger>,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Trigger>
>(({ className, ...props }, ref) => (
  <BaseMenu.Trigger
    ref={ref}
    className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    {...props}
  />
));
MenuTrigger.displayName = "MenuTrigger";

type MenuContentProps = React.ComponentPropsWithoutRef<typeof BaseMenu.Popup> & {
  side?: React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>["side"];
  align?: React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>["align"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>["sideOffset"];
};

const MenuContent = React.forwardRef<React.ElementRef<typeof BaseMenu.Popup>, MenuContentProps>(
  ({ className, side = "bottom", align = "start", sideOffset = 6, ...props }, ref) => (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <BaseMenu.Popup
          ref={ref}
          className={cn(
            "min-w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
            "data-[closed]:opacity-0 data-[open]:opacity-100",
            className,
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  ),
);
MenuContent.displayName = "MenuContent";

const MenuGroup = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Group>,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Group>
>(({ className, ...props }, ref) => <BaseMenu.Group ref={ref} className={cn("grid gap-0.5", className)} {...props} />);
MenuGroup.displayName = "MenuGroup";

const MenuItem = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Item>,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Item>
>(({ className, ...props }, ref) => (
  <BaseMenu.Item
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
      className,
    )}
    {...props}
  />
));
MenuItem.displayName = "MenuItem";

const MenuLabel = React.forwardRef<
  React.ElementRef<typeof BaseMenu.GroupLabel>,
  React.ComponentPropsWithoutRef<typeof BaseMenu.GroupLabel>
>(({ className, ...props }, ref) => (
  <BaseMenu.GroupLabel
    ref={ref}
    className={cn("px-2 py-1.5 text-[11px] font-medium uppercase tracking-normal text-muted-foreground", className)}
    {...props}
  />
));
MenuLabel.displayName = "MenuLabel";

const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof BaseMenu.Separator>
>(({ className, ...props }, ref) => (
  <BaseMenu.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
MenuSeparator.displayName = "MenuSeparator";

export { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger };

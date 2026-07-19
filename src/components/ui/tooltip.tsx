import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";
import { cn } from "../../lib/utils";

/** Shares hover delay across a cluster of tooltips (instant when moving
 *  between neighbors once one is open — the classic toolbar feel). */
function TooltipProvider({
  delay = 0,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

function Tooltip({
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup> &
  Pick<
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background",
            "origin-[var(--transform-origin)] transition-[opacity,transform] duration-100",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow
            className={cn(
              "z-50 size-2.5 rotate-45 rounded-[2px] bg-foreground",
              "data-[side=top]:-bottom-1 data-[side=bottom]:-top-1",
              "data-[side=left]:-right-1 data-[side=right]:-left-1",
            )}
          />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/**
 * Convenience wrapper — renders the child AS the trigger (no wrapper DOM):
 *
 *   <Tip label="Bold" shortcut="Ctrl+B"><Button .../></Tip>
 */
function Tip({
  label,
  desc,
  shortcut,
  side = "bottom",
  delay = 350,
  disabled = false,
  children,
}: {
  label: React.ReactNode;
  desc?: React.ReactNode;
  /** Keyboard shortcut, shown as a kbd chip next to the label. */
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  /** Keep the trigger mounted while suppressing the tooltip. */
  disabled?: boolean;
  children: React.ReactElement;
}) {
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger delay={delay} render={children} />
      <TooltipContent side={side} sideOffset={6} className="flex-col items-start py-1.5">
        <span className="flex items-center gap-2 font-medium">
          {label}
          {shortcut && (
            <kbd
              data-slot="kbd"
              className="rounded bg-background/20 px-1 font-mono text-[10px] leading-4"
            >
              {shortcut}
            </kbd>
          )}
        </span>
        {desc && <div className="font-normal opacity-70">{desc}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

export { Tip, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

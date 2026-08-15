import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Tip } from "../ui/tooltip";

export interface ActivityBarItem<Key extends string> {
  key: Key;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

interface ActivityBarProps<Key extends string> {
  items: readonly ActivityBarItem<Key>[];
  activeItem: Key;
  panelOpen: boolean;
  onSelect: (key: Key) => void;
  footer?: ReactNode;
  className?: string;
}

/** Compact VS Code-style navigation rail for switching sidebar panels. */
export function ActivityBar<Key extends string>({
  items,
  activeItem,
  panelOpen,
  onSelect,
  footer,
  className,
}: ActivityBarProps<Key>) {
  return (
    <nav
      aria-label="Sidebar views"
      data-testid="activity-bar"
      className={cn(
        "flex w-12 shrink-0 flex-col items-center overflow-hidden bg-sidebar",
        panelOpen && "border-r border-sidebar-border/60",
        className,
      )}
    >
      <div className="scrollbar-soft flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto py-1.5">
        {items.map((item) => {
          const active = panelOpen && activeItem === item.key;
          const Icon = item.icon;
          return (
            <Tip key={item.key} label={item.label} side="right">
              <button
                type="button"
                aria-label={item.label}
                aria-pressed={active}
                disabled={item.disabled}
                data-active={active || undefined}
                onClick={() => onSelect(item.key)}
                className={cn(
                  "group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-[#ff5a52]/35",
                  active &&
                    "bg-[#ff5a52]/10 text-[#df4942] hover:bg-[#ff5a52]/15 hover:text-[#df4942] dark:bg-[#ff5a52]/15 dark:text-[#ff746d] dark:hover:bg-[#ff5a52]/20 dark:hover:text-[#ff746d]",
                  item.disabled && "cursor-not-allowed opacity-35 hover:bg-transparent",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            </Tip>
          );
        })}
      </div>
      {footer && (
        <div className="flex w-full shrink-0 items-center justify-center py-1.5">
          {footer}
        </div>
      )}
    </nav>
  );
}

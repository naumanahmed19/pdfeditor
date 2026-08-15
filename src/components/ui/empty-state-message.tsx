import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

type EmptyStateMessageProps = {
  className?: string;
  description?: ReactNode;
  icon: LucideIcon;
  title: string;
};

export function EmptyStateMessage({
  className,
  description,
  icon: Icon,
  title,
}: EmptyStateMessageProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-40 flex-1 items-center justify-center px-5 py-8 text-center",
        className,
      )}
    >
      <div className="flex max-w-52 flex-col items-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-muted/50 text-muted-foreground shadow-sm">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <p className="mt-3 text-xs font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

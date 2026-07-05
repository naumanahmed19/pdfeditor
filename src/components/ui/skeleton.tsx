import { cn } from "../../lib/utils";

/** shadcn Skeleton — a pulsing placeholder shown while content loads. */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-muted-foreground/20",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };

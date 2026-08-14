import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export const TOOL_HEADER_ACTIONS_ID = "tool-header-actions";
export type ToolPageWidth = "standard" | "full";

export function ToolPageContainer({
  width = "standard",
  children,
}: {
  width?: ToolPageWidth;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="tool-page-content"
      data-layout-width={width}
      className={cn("mx-auto w-full", width === "full" ? "max-w-none" : "max-w-3xl")}
    >
      {children}
    </div>
  );
}

export function ToolPageHeader({
  title,
  description,
  actions,
  showIntro = true,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  showIntro?: boolean;
}) {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setActionsHost(document.getElementById(TOOL_HEADER_ACTIONS_ID));
  }, []);

  return (
    <>
      {showIntro && (
        <header className="pb-5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <div className="max-w-2xl pt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        </header>
      )}
      {actions && actionsHost ? createPortal(actions, actionsHost) : null}
    </>
  );
}

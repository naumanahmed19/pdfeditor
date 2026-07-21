import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Command, FileUp, MessageSquare, Scissors, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { isTauriMacOS } from "../../lib/tauri";

export const ONBOARDING_TOUR_EVENT = "pickpdf:start-onboarding-tour";
export const ONBOARDING_TOUR_STORAGE_KEY = "pickpdf.onboarding-tour.v2.complete";

type Props = {
  hasDocument: boolean;
  onOpenDocument: () => void;
  onChooseComment: () => void;
  onOpenSplit: () => void;
  onOpenCommandPalette: () => void;
  nativeMacMenu?: boolean;
};

type TargetRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

const CARD_WIDTH = 304;
const CARD_GAP = 14;
const EDGE_GAP = 12;

function hasFinishedTour(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberTour(): void {
  try {
    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function readRect(element: Element): TargetRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function OnboardingTour({
  hasDocument,
  onOpenDocument,
  onChooseComment,
  onOpenSplit,
  onOpenCommandPalette,
  nativeMacMenu = isTauriMacOS,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const steps = useMemo(() => {
    const commonSteps = [
      {
        title: hasDocument ? "Your PDF is ready" : "Open your first PDF",
        description: hasDocument
          ? "The document name and save controls live here while you work."
          : "Start by opening a PDF. You can also drag a file anywhere onto this screen.",
        selector: hasDocument ? "[data-tour='document-header']" : "[data-tour='open-pdf']",
        icon: hasDocument ? Check : FileUp,
        actionLabel: hasDocument ? undefined : "Open PDF",
        action: hasDocument ? undefined : onOpenDocument,
      },
      {
        title: "Add a comment",
        description: hasDocument
          ? "Open Markup and choose Comment, then click anywhere on the page to leave a note."
          : "Open a PDF first and PickPDF will show you exactly where the Comment tool lives.",
        selector: hasDocument ? "[data-tour='comment-tools']" : "[data-tour='open-pdf']",
        icon: MessageSquare,
        actionLabel: hasDocument ? "Choose Comment" : "Open PDF first",
        action: hasDocument ? onChooseComment : onOpenDocument,
        requiresDocument: true,
      },
    ];

    if (nativeMacMenu) {
      return [
        ...commonSteps,
        {
          title: "Split or find any tool",
          description:
            "On Mac, choose Tools → Split & Extract in the system menu bar. Or open the command palette here and type “split”.",
          selector: "[data-tour='command-palette']",
          icon: Scissors,
          actionLabel: "Open command palette",
          action: onOpenCommandPalette,
        },
      ];
    }

    return [
      ...commonSteps,
      {
        title: "Split or extract pages",
        description:
          "Document actions such as Split & extract are grouped under Tools, so the main workspace stays uncluttered.",
        selector: "[data-tour='tools-menu']",
        icon: Scissors,
        actionLabel: "Open Split & extract",
        action: onOpenSplit,
      },
      {
        title: "Find every tool fast",
        description:
          "Use the command palette whenever you know what you want to do but not where the control is.",
        selector: "[data-tour='command-palette']",
        icon: Command,
        actionLabel: "Open command palette",
        action: onOpenCommandPalette,
      },
    ];
  }, [
    hasDocument,
    nativeMacMenu,
    onChooseComment,
    onOpenCommandPalette,
    onOpenDocument,
    onOpenSplit,
  ]);

  const finish = useCallback(() => {
    rememberTour();
    setOpen(false);
    setTargetRect(null);
  }, []);

  useEffect(() => {
    if (!hasFinishedTour()) setOpen(true);

    const restart = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_TOUR_EVENT, restart);
    return () => window.removeEventListener(ONBOARDING_TOUR_EVENT, restart);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish, open]);

  useEffect(() => {
    if (!open || step !== steps.length - 1) return;
    const finishWhenOpened = () => finish();
    window.addEventListener("pdfwb:open-command-palette", finishWhenOpened);
    return () =>
      window.removeEventListener("pdfwb:open-command-palette", finishWhenOpened);
  }, [finish, open, step, steps.length]);

  useLayoutEffect(() => {
    if (!open) return;
    let target: Element | null = null;
    let frame = 0;
    let observer: ResizeObserver | undefined;

    const update = () => {
      target = document.querySelector(steps[step].selector);
      setTargetRect(target ? readRect(target) : null);
    };

    frame = requestAnimationFrame(() => {
      update();
      if (target) {
        (target as HTMLElement).scrollIntoView?.({ block: "nearest", inline: "center" });
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(update);
          observer.observe(target);
        }
      }
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [hasDocument, layoutTick, open, step]);

  if (!open || typeof document === "undefined") return null;

  const current = steps[step];
  const Icon = current.icon;
  const lastStep = step === steps.length - 1;
  const paddedTarget = targetRect
    ? {
        top: Math.max(6, targetRect.top - 6),
        left: Math.max(6, targetRect.left - 6),
        width: targetRect.width + 12,
        height: targetRect.height + 12,
      }
    : null;

  const card = (() => {
    if (!targetRect) {
      return {
        top: Math.max(70, window.innerHeight / 2 - 130),
        left: Math.max(EDGE_GAP, (window.innerWidth - CARD_WIDTH) / 2),
        side: "center" as const,
        arrowLeft: 0,
      };
    }

    const roomBelow = window.innerHeight - targetRect.bottom;
    const side = roomBelow >= 245 || targetRect.top < 245 ? "below" : "above";
    const left = Math.min(
      window.innerWidth - CARD_WIDTH - EDGE_GAP,
      Math.max(EDGE_GAP, targetRect.left + targetRect.width / 2 - CARD_WIDTH / 2),
    );
    const top = side === "below" ? targetRect.bottom + CARD_GAP : targetRect.top - CARD_GAP;
    const arrowLeft = Math.min(CARD_WIDTH - 24, Math.max(24, targetRect.left + targetRect.width / 2 - left));
    return { top, left, side, arrowLeft };
  })();

  const runAction = () => {
    current.action?.();
    setLayoutTick((value) => value + 1);
    if (lastStep) finish();
  };

  return createPortal(
    <div aria-label="Getting started with PickPDF">
      {paddedTarget ? (
        <div
          className="pointer-events-none fixed z-[45] rounded-lg border-2 border-primary ring-2 ring-background transition-all duration-200"
          style={{
            top: paddedTarget.top,
            left: paddedTarget.left,
            width: paddedTarget.width,
            height: paddedTarget.height,
            boxShadow: "0 0 0 9999px rgb(9 9 11 / 72%)",
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[45] bg-zinc-950/70" aria-hidden="true" />
      )}

      <button
        type="button"
        aria-label="Close tour"
        onClick={finish}
        className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full bg-background/95 text-foreground shadow-lg transition-colors hover:bg-accent"
      >
        <X className="h-5 w-5" />
      </button>

      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="onboarding-tour-title"
        className="fixed z-[60] w-[min(304px,calc(100vw-24px))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-2xl"
        style={{
          left: card.left,
          ...(card.side === "above" ? { bottom: window.innerHeight - card.top } : { top: card.top }),
        }}
      >
        {card.side !== "center" && (
          <span
            className={cn(
              "absolute h-3 w-3 rotate-45 border bg-popover",
              card.side === "below" ? "-top-1.5 border-b-0 border-r-0" : "-bottom-1.5 border-l-0 border-t-0",
            )}
            style={{ left: card.arrowLeft - 6 }}
            aria-hidden="true"
          />
        )}

        <div className="relative">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <h2 id="onboarding-tour-title" className="text-base font-semibold leading-snug">
            {current.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {current.description}
          </p>

          {current.actionLabel && (
            <button
              type="button"
              onClick={runAction}
              className="mt-3 text-xs font-semibold text-primary hover:underline"
            >
              {current.actionLabel}
            </button>
          )}

          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {step + 1}/{steps.length}
            </span>
            <div className="flex items-center gap-1.5">
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setStep((value) => value - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
              <Button
                size="sm"
                disabled={Boolean(current.requiresDocument && !hasDocument)}
                onClick={() => {
                  if (lastStep) finish();
                  else setStep((value) => value + 1);
                }}
              >
                {lastStep ? "Finish" : "Next"}
                {!lastStep && <ChevronRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

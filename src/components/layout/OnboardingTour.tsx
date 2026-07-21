import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  FileUp,
  MessageSquare,
  Play,
  ScanText,
  Scissors,
  Search,
  Signature,
  Sparkles,
  SquareSlash,
  TextCursorInput,
  X,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../../lib/utils";
import { isTauriMacOS } from "../../lib/tauri";

export const ONBOARDING_TOUR_EVENT = "pickpdf:start-onboarding-tour";
export const TUTORIAL_CENTER_EVENT = "pickpdf:open-tutorial-center";
export const ONBOARDING_TOUR_STORAGE_KEY = "pickpdf.onboarding-tour.v2.complete";

type TutorialId =
  | "getting-started"
  | "find-replace"
  | "comments"
  | "split-extract"
  | "edit-text"
  | "sign"
  | "redact"
  | "ocr";

type Props = {
  hasDocument: boolean;
  onOpenDocument: () => void;
  onChooseComment: () => void;
  onOpenComments: () => void;
  onFocusSearch: () => void;
  onOpenReplace: () => void;
  onOpenSplit: () => void;
  onChooseEditText: () => void;
  onOpenSignature: () => void;
  onChooseRedact: () => void;
  onRunOcr: () => void;
  onOpenCommandPalette: () => void;
  nativeMacMenu?: boolean;
};

type TutorialStep = {
  title: string;
  description: string;
  selector: string;
  icon: LucideIcon;
  actionLabel?: string;
  action?: () => void;
  onEnter?: () => void;
  requiresDocument?: boolean;
};

type TutorialDefinition = {
  id: TutorialId;
  title: string;
  summary: string;
  icon: LucideIcon;
  steps: TutorialStep[];
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
const TUTORIAL_IDS: TutorialId[] = [
  "getting-started",
  "find-replace",
  "comments",
  "split-extract",
  "edit-text",
  "sign",
  "redact",
  "ocr",
];

function tutorialStorageKey(id: TutorialId): string {
  return `pickpdf.tutorial.${id}.complete`;
}

function hasFinishedTour(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function completedTutorials(): TutorialId[] {
  try {
    return TUTORIAL_IDS.filter((id) => localStorage.getItem(tutorialStorageKey(id)) === "1");
  } catch {
    return [];
  }
}

function rememberTutorial(id: TutorialId): void {
  try {
    localStorage.setItem(tutorialStorageKey(id), "1");
    if (id === "getting-started") {
      localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
    }
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
  onOpenComments,
  onFocusSearch,
  onOpenReplace,
  onOpenSplit,
  onChooseEditText,
  onOpenSignature,
  onChooseRedact,
  onRunOcr,
  onOpenCommandPalette,
  nativeMacMenu = isTauriMacOS,
}: Props) {
  const [open, setOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [topicId, setTopicId] = useState<TutorialId>("getting-started");
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [completed, setCompleted] = useState<TutorialId[]>(completedTutorials);

  const tutorials = useMemo<TutorialDefinition[]>(() => {
    const documentStep: TutorialStep = {
      title: hasDocument ? "Your PDF is ready" : "Open a PDF to continue",
      description: hasDocument
        ? "This tutorial uses the document you already have open."
        : "Open a PDF first so the controls in this tutorial are available.",
      selector: hasDocument ? "[data-tour='document-header']" : "[data-tour='open-pdf']",
      icon: hasDocument ? Check : FileUp,
      actionLabel: hasDocument ? undefined : "Open PDF",
      action: hasDocument ? undefined : onOpenDocument,
    };

    const gettingStartedSteps: TutorialStep[] = [
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
      gettingStartedSteps.push({
        title: "Split or find any tool",
        description:
          "On Mac, choose Tools → Split & Extract in the system menu bar. Or open the command palette here and type “split”.",
        selector: "[data-tour='command-palette']",
        icon: Scissors,
        actionLabel: "Open command palette",
        action: onOpenCommandPalette,
      });
    } else {
      gettingStartedSteps.push(
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
      );
    }

    return [
      {
        id: "getting-started",
        title: "Getting started",
        summary: "Open a PDF, add a comment, and find common tools.",
        icon: Sparkles,
        steps: gettingStartedSteps,
      },
      {
        id: "find-replace",
        title: "Find & replace",
        summary: "Search document text and replace one or every match.",
        icon: Search,
        steps: [
          documentStep,
          {
            title: "Find text in your document",
            description:
              "Type a word or phrase here. Enter moves forward through matches; Shift+Enter moves back.",
            selector: "[data-tour='document-search']",
            icon: Search,
            actionLabel: "Focus search",
            action: onFocusSearch,
            requiresDocument: true,
          },
          {
            title: "Replace one match or all",
            description:
              "Open Replace, enter the new text, then choose Replace for the current match or All for every match.",
            selector: "[data-tour='replace-toggle']",
            icon: Search,
            actionLabel: "Open replace",
            action: onOpenReplace,
            requiresDocument: true,
          },
        ],
      },
      {
        id: "comments",
        title: "Comments",
        summary: "Add sticky notes and review every comment in one place.",
        icon: MessageSquare,
        steps: [
          documentStep,
          {
            title: "Place a comment",
            description:
              "Open Markup, choose Comment, and click the page where the note belongs.",
            selector: hasDocument ? "[data-tour='comment-tools']" : "[data-tour='open-pdf']",
            icon: MessageSquare,
            actionLabel: hasDocument ? "Choose Comment" : "Open PDF first",
            action: hasDocument ? onChooseComment : onOpenDocument,
            requiresDocument: true,
          },
          {
            title: "Review all comments",
            description:
              "Open the Comments panel to see every note by page and jump directly to one.",
            selector: "[data-tour='comments-list']",
            icon: BookOpen,
            onEnter: onOpenComments,
            requiresDocument: true,
          },
        ],
      },
      {
        id: "split-extract",
        title: "Split & extract",
        summary: "Extract page ranges or split a PDF into separate files.",
        icon: Scissors,
        steps: [
          documentStep,
          nativeMacMenu
            ? {
                title: "Open Split & Extract on Mac",
                description:
                  "Choose Tools → Split & Extract in the system menu bar, or open the command palette and type “split”.",
                selector: "[data-tour='command-palette']",
                icon: Command,
                actionLabel: "Open command palette",
                action: onOpenCommandPalette,
                requiresDocument: true,
              }
            : {
                title: "Open Split & extract",
                description:
                  "Choose Split & extract under Tools, then select a page range or split every page into its own file.",
                selector: "[data-tour='tools-menu']",
                icon: Scissors,
                actionLabel: "Open Split & extract",
                action: onOpenSplit,
                requiresDocument: true,
              },
        ],
      },
      {
        id: "edit-text",
        title: "Edit existing text",
        summary: "Retype PDF text and change its font, size, or color.",
        icon: TextCursorInput,
        steps: [
          documentStep,
          {
            title: "Choose Edit text",
            description:
              "Open Text and choose Edit text, then click a line in the PDF to retype or restyle it.",
            selector: hasDocument ? "[data-tour='text-tools']" : "[data-tour='open-pdf']",
            icon: TextCursorInput,
            actionLabel: hasDocument ? "Choose Edit text" : "Open PDF first",
            action: hasDocument ? onChooseEditText : onOpenDocument,
            requiresDocument: true,
          },
        ],
      },
      {
        id: "sign",
        title: "Sign a PDF",
        summary: "Draw, type, upload, and reuse your signature.",
        icon: Signature,
        steps: [
          documentStep,
          {
            title: "Create or reuse a signature",
            description:
              "Choose Sign to draw, type, or upload a signature. After choosing one, click the page to place it.",
            selector: hasDocument ? "[data-tour='sign-document']" : "[data-tour='open-pdf']",
            icon: Signature,
            actionLabel: hasDocument ? "Open signature picker" : "Open PDF first",
            action: hasDocument ? onOpenSignature : onOpenDocument,
            requiresDocument: true,
          },
        ],
      },
      {
        id: "redact",
        title: "Redact sensitive information",
        summary: "Permanently remove text and images from selected areas.",
        icon: SquareSlash,
        steps: [
          documentStep,
          {
            title: "Choose Redact carefully",
            description:
              "Open Cleanup and choose Redact. Draw boxes over sensitive content, review them, then use Apply redactions.",
            selector: hasDocument ? "[data-tour='cleanup-tools']" : "[data-tour='open-pdf']",
            icon: SquareSlash,
            actionLabel: hasDocument ? "Choose Redact" : "Open PDF first",
            action: hasDocument ? onChooseRedact : onOpenDocument,
            requiresDocument: true,
          },
        ],
      },
      {
        id: "ocr",
        title: "Make scans searchable",
        summary: "Run OCR so scanned text can be searched, copied, and read by AI.",
        icon: ScanText,
        steps: [
          documentStep,
          {
            title: "Run OCR on a scanned PDF",
            description: nativeMacMenu
              ? "On Mac, choose Tools → Make Searchable (OCR) in the system menu bar, or start it here."
              : "Make Searchable (OCR) lives under Tools. Choose a language, then PickPDF adds a searchable text layer.",
            selector: nativeMacMenu
              ? "[data-tour='command-palette']"
              : "[data-tour='tools-menu']",
            icon: ScanText,
            actionLabel: hasDocument ? "Start OCR" : "Open PDF first",
            action: hasDocument ? onRunOcr : onOpenDocument,
            requiresDocument: true,
          },
        ],
      },
    ];
  }, [
    hasDocument,
    nativeMacMenu,
    onChooseComment,
    onFocusSearch,
    onOpenCommandPalette,
    onOpenComments,
    onOpenDocument,
    onOpenReplace,
    onOpenSplit,
    onOpenSignature,
    onRunOcr,
    onChooseEditText,
    onChooseRedact,
  ]);

  const tutorial = tutorials.find((item) => item.id === topicId) ?? tutorials[0];
  const steps = tutorial.steps;

  const finish = useCallback(() => {
    rememberTutorial(topicId);
    setCompleted((items) => (items.includes(topicId) ? items : [...items, topicId]));
    setOpen(false);
    setTargetRect(null);
  }, [topicId]);

  const startTutorial = useCallback((id: TutorialId) => {
    setTopicId(id);
    setStep(0);
    setTargetRect(null);
    setLibraryOpen(false);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!hasFinishedTour()) startTutorial("getting-started");

    const restart = () => startTutorial("getting-started");
    const openLibrary = () => {
      setCompleted(completedTutorials());
      setOpen(false);
      setTargetRect(null);
      setLibraryOpen(true);
    };
    window.addEventListener(ONBOARDING_TOUR_EVENT, restart);
    window.addEventListener(TUTORIAL_CENTER_EVENT, openLibrary);
    return () => {
      window.removeEventListener(ONBOARDING_TOUR_EVENT, restart);
      window.removeEventListener(TUTORIAL_CENTER_EVENT, openLibrary);
    };
  }, [startTutorial]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish, open]);

  useEffect(() => {
    if (
      !open ||
      step !== steps.length - 1 ||
      steps[step].selector !== "[data-tour='command-palette']"
    ) {
      return;
    }
    const finishWhenOpened = () => finish();
    window.addEventListener("pdfwb:open-command-palette", finishWhenOpened);
    return () =>
      window.removeEventListener("pdfwb:open-command-palette", finishWhenOpened);
  }, [finish, open, step, steps]);

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
  }, [hasDocument, layoutTick, open, step, topicId]);

  if (libraryOpen) {
    return (
      <Dialog open onOpenChange={(next) => setLibraryOpen(next)}>
        <DialogContent
          aria-label="PickPDF tutorials"
          className="max-h-[80vh] max-w-xl overflow-y-auto"
        >
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
            <DialogTitle>Learn PickPDF</DialogTitle>
            <DialogDescription>
              Choose a short tutorial. Each one points to the real controls while you work.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 pt-2 sm:grid-cols-2">
            {tutorials.map((item) => {
              const Icon = item.icon;
              const isComplete = completed.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Start ${item.title} tutorial`}
                  onClick={() => startTutorial(item.id)}
                  className="group flex min-h-32 flex-col rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    {isComplete && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        Completed
                      </span>
                    )}
                  </div>
                  <span className="mt-3 text-sm font-semibold">{item.title}</span>
                  <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.summary}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-primary">
                    <Play className="h-3 w-3 fill-current" />
                    {item.steps.length} steps
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

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
    const arrowLeft = Math.min(
      CARD_WIDTH - 24,
      Math.max(24, targetRect.left + targetRect.width / 2 - left),
    );
    return { top, left, side, arrowLeft };
  })();

  const runAction = () => {
    current.action?.();
    setLayoutTick((value) => value + 1);
    if (lastStep) finish();
  };

  return createPortal(
    <div aria-label={`${tutorial.title} tutorial`}>
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
        aria-label="Close tutorial"
        onClick={finish}
        className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full bg-background/95 text-foreground shadow-lg transition-colors hover:bg-accent"
      >
        <X className="h-5 w-5" />
      </button>

      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="tutorial-step-title"
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
              card.side === "below"
                ? "-top-1.5 border-b-0 border-r-0"
                : "-bottom-1.5 border-l-0 border-t-0",
            )}
            style={{ left: card.arrowLeft - 6 }}
            aria-hidden="true"
          />
        )}

        <div className="relative">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
            {tutorial.title}
          </p>
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <h2 id="tutorial-step-title" className="text-base font-semibold leading-snug">
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
                  else {
                    const nextStep = step + 1;
                    steps[nextStep].onEnter?.();
                    setStep(nextStep);
                    setLayoutTick((value) => value + 1);
                  }
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

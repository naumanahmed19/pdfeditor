import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  FileUp,
  MessageSquare,
  Scissors,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../../lib/utils";

export const ONBOARDING_TOUR_EVENT = "pickpdf:start-onboarding-tour";
export const ONBOARDING_TOUR_STORAGE_KEY = "pickpdf.onboarding-tour.v1.complete";

type Props = {
  hasDocument: boolean;
  onOpenDocument: () => void;
  onChooseComment: () => void;
  onOpenSplit: () => void;
  onOpenCommandPalette: () => void;
};

const STEPS = [
  {
    eyebrow: "Welcome to PickPDF",
    title: "The basics, one step at a time",
    description:
      "This quick tour covers the few things you need to start. Everything else can wait until you need it.",
    icon: Sparkles,
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    eyebrow: "Step 1",
    title: "Open a PDF and move around",
    description:
      "Open a file, then use the page controls at the bottom to move and zoom. Your file stays on your device.",
    icon: FileUp,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    eyebrow: "Step 2",
    title: "Add a comment",
    description:
      "Choose Comment in the editing toolbar, then click anywhere on the page. Type your note and click outside it to finish.",
    icon: MessageSquare,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    eyebrow: "Step 3",
    title: "Split a file — and find anything else",
    description:
      "Split & extract lives in Tools. If you cannot find an action later, the command palette searches every available tool.",
    icon: Scissors,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
] as const;

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

export function OnboardingTour({
  hasDocument,
  onOpenDocument,
  onChooseComment,
  onOpenSplit,
  onOpenCommandPalette,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!hasFinishedTour()) setOpen(true);

    const restart = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_TOUR_EVENT, restart);
    return () => window.removeEventListener(ONBOARDING_TOUR_EVENT, restart);
  }, []);

  const finish = useCallback(() => {
    rememberTour();
    setOpen(false);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (next) setOpen(true);
    else finish();
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-label="Getting started with PickPDF"
        className="max-w-2xl overflow-hidden p-0"
        showCloseButton={false}
      >
        <div className="grid min-h-[390px] sm:grid-cols-[180px_1fr]">
          <aside className="relative overflow-hidden border-b bg-muted/45 p-5 sm:border-b-0 sm:border-r">
            <div className="absolute -left-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative flex h-full flex-row items-center justify-between gap-4 sm:flex-col sm:items-stretch">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Quick tour
                </p>
                <p className="mt-2 hidden text-sm leading-relaxed text-muted-foreground sm:block">
                  Learn just enough to make your first edit.
                </p>
              </div>
              <ol className="flex gap-2 sm:flex-col" aria-label="Tour progress">
                {STEPS.map((item, index) => (
                  <li key={item.title} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                        index < step && "border-primary bg-primary text-primary-foreground",
                        index === step && "border-primary bg-background text-primary ring-2 ring-primary/15",
                        index > step && "border-border bg-background/70 text-muted-foreground",
                      )}
                      aria-current={index === step ? "step" : undefined}
                    >
                      {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        "hidden text-xs sm:inline",
                        index === step ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {index === 0 ? "Welcome" : item.title.split(" ")[0]}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <section className="flex min-w-0 flex-col p-6 sm:p-8">
            <DialogHeader>
              <div className={cn("mb-4 flex h-12 w-12 items-center justify-center rounded-2xl", current.color)}>
                <Icon className="h-6 w-6" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                {current.eyebrow}
              </p>
              <DialogTitle className="pt-1 text-2xl leading-tight">{current.title}</DialogTitle>
              <DialogDescription className="max-w-md pt-2 text-sm leading-relaxed">
                {current.description}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 min-h-16">
              {step === 0 && (
                <div className="grid grid-cols-3 gap-2" aria-label="Tour topics">
                  {[
                    [FileUp, "Open"],
                    [MessageSquare, "Comment"],
                    [Scissors, "Split"],
                  ].map(([TopicIcon, label]) => {
                    const Topic = TopicIcon as typeof FileUp;
                    return (
                      <div key={label as string} className="rounded-lg border bg-muted/25 px-2 py-3 text-center">
                        <Topic className="mx-auto h-4 w-4 text-muted-foreground" />
                        <p className="mt-1.5 text-xs font-medium">{label as string}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {step === 1 && (
                hasDocument ? (
                  <div className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium">
                    <Check className="h-4 w-4 text-emerald-600" />
                    PDF ready
                  </div>
                ) : (
                  <Button variant="outline" onClick={onOpenDocument}>
                    <FileUp className="h-4 w-4" />
                    Open a PDF
                  </Button>
                )
              )}

              {step === 2 && (
                <div>
                  <Button
                    variant="outline"
                    onClick={hasDocument ? onChooseComment : onOpenDocument}
                  >
                    {hasDocument ? <MessageSquare className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}
                    {hasDocument ? "Choose the Comment tool" : "Open a PDF first"}
                  </Button>
                  {hasDocument && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      We’ll arm the tool for you. After the tour, click the page to place your note.
                    </p>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={onOpenSplit}>
                    <Scissors className="h-4 w-4" />
                    Show Split &amp; extract
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      finish();
                      onOpenCommandPalette();
                    }}
                  >
                    <Command className="h-4 w-4" />
                    Search all tools
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-auto flex items-center justify-between border-t pt-5">
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={finish}
              >
                Skip tour
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setStep((value) => value - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    if (isLast) finish();
                    else setStep((value) => value + 1);
                  }}
                >
                  {isLast ? "Finish" : "Next"}
                  {!isLast && <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

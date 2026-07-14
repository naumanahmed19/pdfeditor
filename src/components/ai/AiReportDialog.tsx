import { useEffect, useState } from "react";
import { toast } from "sonner";
import packageInfo from "../../../package.json";
import {
  AI_REPORT_CATEGORIES,
  AI_REPORT_EMAIL,
  buildAiReport,
  copyAiReport,
  openAiReportEmail,
  type AiReportCategory,
  type AiReportDraft,
} from "../../lib/aiReport";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

interface AiReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  response: string;
  provider: string;
  model: string;
  sendReport?: (draft: AiReportDraft) => Promise<void>;
}

export function AiReportDialog({
  open,
  onOpenChange,
  response,
  provider,
  model,
  sendReport = openAiReportEmail,
}: AiReportDialogProps) {
  const [category, setCategory] = useState<AiReportCategory>("inappropriate");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory("inappropriate");
    setDetails("");
    setSubmitting(false);
  }, [open, response]);

  const submit = async () => {
    if (!response.trim() || submitting) return;
    const draft = buildAiReport({
      response,
      category,
      details,
      appVersion: packageInfo.version,
      provider,
      model,
    });

    setSubmitting(true);
    try {
      await sendReport(draft);
      onOpenChange(false);
    } catch {
      try {
        await copyAiReport(draft);
        toast.error(
          `Could not open your email app. The report was copied; send it to ${AI_REPORT_EMAIL}.`,
        );
      } catch {
        toast.error(
          `Could not open your email app. Please report the response to ${AI_REPORT_EMAIL}.`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Report AI response" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report AI response</DialogTitle>
          <DialogDescription>
            This opens your email app and includes the AI response plus app,
            provider and model details. Your prompt and PDF content are not included.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Reason</span>
            <Select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as AiReportCategory)
              }
              aria-label="Report category"
            >
              {AI_REPORT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Additional details (optional)</span>
            <Textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={1000}
              placeholder="Tell us what was wrong with this response."
              aria-label="Additional report details"
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Opening email..." : "Continue to email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { FileText, X } from "lucide-react";
import { Button } from "../ui/button";
import { isTauri } from "../../lib/tauri";

interface Props {
  open: boolean;
  onClose: () => void;
}

const APP_NAME = "PickPDF";
const APP_VERSION = "0.1.0";
const APP_TAGLINE =
  "A local-first PDF reader, editor, form designer and organizer with a built-in local-AI assistant.";

export function AboutModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <FileText className="h-7 w-7" />
        </div>

        <h2 className="pt-3 text-lg font-semibold">{APP_NAME}</h2>
        <p className="text-xs text-muted-foreground">
          Version {APP_VERSION}
          {isTauri ? " · Desktop" : " · Web"}
        </p>

        <p className="px-2 pt-3 text-sm text-muted-foreground">{APP_TAGLINE}</p>

        <p className="pt-6 text-[11px] leading-relaxed text-muted-foreground">
          © {new Date().getFullYear()} PickPDF.
        </p>
      </div>
    </div>
  );
}

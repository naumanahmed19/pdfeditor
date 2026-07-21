import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import packageInfo from "../../../package.json";
import { isTauri, isTauriMobile } from "../../lib/tauri";
import { isAppUpdaterEnabled, requestAppUpdateCheck } from "../../lib/updater";
import { Button } from "../ui/button";
import { BrandLogo } from "./BrandLogo";

interface Props {
  open: boolean;
  onClose: () => void;
}

const APP_TAGLINE =
  "A local-first PDF reader, editor, form designer and organizer with a built-in local-AI assistant.";

export function AboutModal({ open, onClose }: Props) {
  const [version, setVersion] = useState(packageInfo.version);

  useEffect(() => {
    if (!open || !isTauri) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch((error) => console.error("Could not read app version", error));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-shell"
        role="dialog"
        aria-modal="true"
        aria-label="About PickPDF"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 h-7 w-7"
            aria-label="Close about dialog"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <BrandLogo variant="asset" className="mx-auto mt-1 h-32 w-48" />

        <p className="text-xs text-muted-foreground">
          Version {version}
          {isTauriMobile ? " - Mobile" : isTauri ? " - Desktop" : " - Web"}
        </p>

        {isAppUpdaterEnabled() && (
          <Button
            variant="outline"
            size="sm"
            className="mx-auto mt-4"
            onClick={() => {
              requestAppUpdateCheck();
              onClose();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Check for updates
          </Button>
        )}

        <p className="px-2 pt-3 text-sm text-muted-foreground">{APP_TAGLINE}</p>

        <p className="pt-6 text-[11px] leading-relaxed text-muted-foreground">
          Copyright {new Date().getFullYear()} PickPDF.
        </p>
      </div>
    </div>
  );
}

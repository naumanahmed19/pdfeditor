import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "../ui/button";
import {
  isAppUpdaterEnabled,
  UPDATE_CHECK_EVENT,
} from "../../lib/updater";

type InstallState = "idle" | "downloading" | "installing" | "failed";

export function UpdateNotifier() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const checkingRef = useRef(false);

  const checkForUpdate = useCallback(async (manual: boolean) => {
    if (!isAppUpdaterEnabled() || checkingRef.current) return;

    checkingRef.current = true;
    try {
      const available = await check();
      if (available) {
        setUpdate((previous) => {
          if (previous && previous.rid !== available.rid) void previous.close();
          return available;
        });
        setInstallState("idle");
        setProgress(null);
      } else if (manual) {
        toast.success("PickPDF is up to date");
      }
    } catch (error) {
      console.error("Update check failed", error);
      if (manual) {
        toast.error("Could not check for updates", {
          description: "Check your connection and try again.",
        });
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isAppUpdaterEnabled()) return;

    const automaticCheck = window.setTimeout(
      () => void checkForUpdate(false),
      5000,
    );
    const onManualCheck = () => void checkForUpdate(true);
    window.addEventListener(UPDATE_CHECK_EVENT, onManualCheck);

    return () => {
      window.clearTimeout(automaticCheck);
      window.removeEventListener(UPDATE_CHECK_EVENT, onManualCheck);
    };
  }, [checkForUpdate]);

  const dismiss = () => {
    if (installState === "downloading" || installState === "installing") return;
    if (update) void update.close();
    setUpdate(null);
    setInstallState("idle");
    setProgress(null);
  };

  const install = async () => {
    if (!update) return;

    setInstallState("downloading");
    setProgress(0);
    let downloaded = 0;
    let total = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(total > 0 ? 0 : null);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(total > 0 ? Math.min(100, (downloaded / total) * 100) : null);
        } else if (event.event === "Finished") {
          setInstallState("installing");
          setProgress(100);
        }
      });
      await relaunch();
    } catch (error) {
      console.error("Update installation failed", error);
      setInstallState("failed");
      setProgress(null);
    }
  };

  if (!update) return null;

  const busy = installState === "downloading" || installState === "installing";
  const status =
    installState === "downloading"
      ? progress == null
        ? "Downloading update…"
        : `Downloading update… ${Math.round(progress)}%`
      : installState === "installing"
        ? "Installing update…"
        : installState === "failed"
          ? "The update could not be installed. Please try again."
          : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-shell"
        role="dialog"
        aria-modal="true"
        aria-label={`PickPDF ${update.version} update available`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Update available
            </p>
            <h2 className="pt-1 text-lg font-semibold">PickPDF {update.version}</h2>
            <p className="pt-1 text-sm text-muted-foreground">
              You are currently using version {update.currentVersion}.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 h-8 w-8"
            aria-label="Install this update later"
            onClick={dismiss}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {update.body && (
          <div className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            {update.body}
          </div>
        )}

        {status && (
          <div className="mt-4">
            <p
              className={
                installState === "failed"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {status}
            </p>
            {busy && progress != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss} disabled={busy}>
            Later
          </Button>
          <Button onClick={() => void install()} disabled={busy}>
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {installState === "failed" ? "Try again" : "Update and restart"}
          </Button>
        </div>
      </div>
    </div>
  );
}

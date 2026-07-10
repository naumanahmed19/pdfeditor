import { useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, X } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Combobox } from "../ui/combobox";

/**
 * In-app confirmation dialog — replaces window.confirm for every destructive
 * or consequential ask (close with unsaved edits, apply redactions, flatten,
 * save without protection, font substitution). Enter confirms, Escape
 * cancels. Driven by the store's `confirmPrompt` request and settled via
 * `answerConfirm`. Mirrors PasswordModal's structure and styling.
 */
export function ConfirmModal() {
  const app = useApp();
  const req = app.confirmPrompt;
  const confirmRef = useRef<HTMLButtonElement>(null);

  // The request object is inert, so the optional dropdown needs local state;
  // changes are pushed out through req.select.onChange as they happen.
  const [selectValue, setSelectValue] = useState(req?.select?.value ?? "");
  useEffect(() => {
    setSelectValue(req?.select?.value ?? "");
  }, [req]);

  useEffect(() => {
    if (!req) return;
    // Focus the confirm button so Enter/Space settle the dialog.
    const t = setTimeout(() => confirmRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        app.answerConfirm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [req, app]);

  if (!req) return null;

  const danger = req.tone === "danger";
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={() => app.answerConfirm(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={req.title}
        className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-1">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                danger ? "bg-destructive/10" : "bg-primary/10"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${danger ? "text-destructive" : "text-primary"}`}
              />
            </div>
            <h2 className="text-sm font-semibold">{req.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => app.answerConfirm(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="whitespace-pre-line pb-3 pt-1 text-sm text-muted-foreground">
          {req.message}
        </p>

        {req.select && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-sm">{req.select.label}</span>
            <Combobox
              value={selectValue}
              options={[...req.select.options]}
              onValueChange={(v) => {
                setSelectValue(v);
                req.select?.onChange(v);
              }}
              showLabel
              searchPlaceholder="Search…"
              aria-label={req.select.label}
              className="h-8 w-52 text-xs"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => app.answerConfirm(false)}
          >
            {req.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            ref={confirmRef}
            variant={danger ? "destructive" : "default"}
            size="sm"
            onClick={() => app.answerConfirm(true)}
          >
            {req.confirmLabel ?? "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

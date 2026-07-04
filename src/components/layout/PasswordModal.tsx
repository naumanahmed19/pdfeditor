import { useEffect, useRef, useState } from "react";
import { Lock, X } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/**
 * In-app password dialog — replaces window.prompt for every password ask
 * (encrypted PDFs, PickPDF-locked wrappers, owner-password checks). Masked
 * input, error state, Enter submits, Escape cancels. Driven by the store's
 * `passwordPrompt` request and settled via `answerPassword`.
 */
export function PasswordModal() {
  const app = useApp();
  const req = app.passwordPrompt;
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh field per request; refocus on retries (same dialog, new error).
  useEffect(() => {
    if (req) {
      setValue("");
      // After the error text renders, put the caret back in the field.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        app.answerPassword(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, app]);

  if (!req) return null;

  const submit = () => app.answerPassword(value);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={() => app.answerPassword(null)}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">{req.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => app.answerPassword(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="pb-3 pt-1 text-sm text-muted-foreground">{req.message}</p>

        <Input
          ref={inputRef}
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          aria-invalid={!!req.error}
          onKeyDown={(e) => e.key === "Enter" && value && submit()}
        />
        {req.error && (
          <p className="pt-1.5 text-xs text-destructive">{req.error}</p>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={() => app.answerPassword(null)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!value} onClick={submit}>
            Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}

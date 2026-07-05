import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, GitCompare, Upload } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { loadPdf, extractAllText, type PdfDoc } from "../../lib/pdf";
import { diffWords, hasTextChange, pixelDiffPage, type DiffPart } from "../../lib/compare";

type Mode = "text" | "pixel";

/**
 * Compare the open document (A) against a second PDF (B): a word-level text
 * diff and a rendered pixel diff, page by page. Everything runs locally.
 */
export function CompareScreen() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bytesB, setBytesB] = useState<Uint8Array | null>(null);
  const [nameB, setNameB] = useState("");
  const [pdfB, setPdfB] = useState<PdfDoc | null>(null);
  const [textA, setTextA] = useState<string[]>([]);
  const [textB, setTextB] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("text");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pixelChanged, setPixelChanged] = useState<number | null>(null);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShellLite title="Compare documents" desc="Open a PDF first to compare it with another.">
        <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Open a PDF first (title bar → Open PDF), then pick a second file to compare.
        </div>
      </ToolShellLite>
    );
  }

  const bytesA = app.docBytes;
  const pagesA = app.numPages;
  const pagesB = pdfB?.numPages ?? 0;
  const maxPages = Math.max(pagesA, pagesB);

  const onPickFile = async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await loadPdf(bytes);
      const [ta, tb] = await Promise.all([
        extractAllText(app.pdf!),
        extractAllText(doc),
      ]);
      setBytesB(bytes);
      setNameB(file.name);
      setPdfB(doc);
      setTextA(ta.map((p) => p.full));
      setTextB(tb.map((p) => p.full));
      setPage(0);
      toast.success(`Comparing against ${file.name}`);
    } catch (err) {
      toast.error(`Couldn't open that PDF: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(false);
    }
  };

  // Render the pixel diff whenever the page or mode changes.
  useEffect(() => {
    if (mode !== "pixel" || !bytesB) return;
    let cancelled = false;
    setBusy(true);
    setPixelChanged(null);
    (async () => {
      try {
        const diff = await pixelDiffPage(bytesA, bytesB, page);
        if (cancelled) return;
        const canvas = diffCanvasRef.current;
        if (!canvas) return;
        canvas.width = diff.width;
        canvas.height = diff.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const img = ctx.createImageData(diff.width, diff.height);
        img.data.set(diff.rgba);
        ctx.putImageData(img, 0, 0);
        setPixelChanged(diff.changed);
      } catch (err) {
        if (!cancelled) toast.error(`Diff failed: ${err instanceof Error ? err.message : "error"}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, page, bytesA, bytesB]);

  const parts: DiffPart[] =
    bytesB && page < Math.max(textA.length, textB.length)
      ? diffWords(textA[page] ?? "", textB[page] ?? "")
      : [];
  const changed = hasTextChange(parts);

  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Compare documents</h1>
        </div>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          Compare <span className="font-medium text-foreground">{app.docName}</span> with a second
          PDF — word-level text changes and a rendered pixel diff, page by page.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickFile(f);
            e.target.value = "";
          }}
        />

        {!bytesB ? (
          <div
            className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-card px-10 py-16 text-center shadow-shell transition-colors hover:border-primary/50"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Choose the PDF to compare against</p>
            <p className="text-xs text-muted-foreground">
              It stays on your device — nothing is uploaded.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">
                  A · {app.docName} ({pagesA}p)
                </span>
                <span>vs</span>
                <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">
                  B · {nameB} ({pagesB}p)
                </span>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => fileRef.current?.click()}>
                  Change
                </Button>
              </div>
              <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                {(["text", "pixel"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                      mode === m
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "text" ? "Text diff" : "Pixel diff"}
                  </button>
                ))}
              </div>
            </div>

            {/* Page navigation */}
            <div className="flex items-center justify-center gap-2 pb-4">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                Page {page + 1} / {maxPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page >= maxPages - 1}
                onClick={() => setPage((p) => Math.min(maxPages - 1, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {page >= pagesA && (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">
                  Only in B
                </span>
              )}
              {page >= pagesB && (
                <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs text-rose-600">
                  Only in A
                </span>
              )}
            </div>

            {mode === "text" ? (
              <div className="rounded-xl border bg-card p-5 shadow-shell">
                <div className="flex items-center gap-2 pb-3 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {changed ? "Text differs on this page" : "No text changes on this page"}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-300" /> removed
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-300" /> added
                    </span>
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {parts.length === 0 ? (
                    <span className="text-muted-foreground">No extractable text on this page.</span>
                  ) : (
                    parts.map((p, i) => (
                      <span
                        key={i}
                        className={cn(
                          p.type === "add" && "bg-emerald-200/60 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100",
                          p.type === "del" && "bg-rose-200/60 text-rose-900 line-through dark:bg-rose-500/25 dark:text-rose-100",
                        )}
                      >
                        {p.text}
                      </span>
                    ))
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border bg-card p-5 shadow-shell">
                <div className="flex items-center gap-2 pb-3 text-xs text-muted-foreground">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" />
                  <span>Red = changed pixels; faded gray = unchanged.</span>
                  {pixelChanged != null && (
                    <span className="ml-auto tabular-nums">
                      {(pixelChanged * 100).toFixed(2)}% changed
                    </span>
                  )}
                </div>
                <div className="flex justify-center overflow-auto rounded-lg bg-muted/40 p-3">
                  <canvas
                    ref={diffCanvasRef}
                    className="max-w-full shadow-shell ring-1 ring-border/60"
                  />
                </div>
              </div>
            )}
            {busy && <p className="pt-3 text-center text-xs text-muted-foreground">Working…</p>}
          </>
        )}
      </div>
    </div>
  );
}

function ToolShellLite({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">{desc}</p>
        {children}
      </div>
    </div>
  );
}

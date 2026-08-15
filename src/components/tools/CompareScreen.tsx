import { useEffect, useRef, useState } from "react";
import { FileText, GitCompare, Upload } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { loadPdf, extractAllText, type PdfDoc } from "../../lib/pdf";
import { diffWords, hasTextChange, pixelDiffPage, type DiffPart } from "../../lib/compare";
import {
  isPdfFile,
  useToolFileDrop,
  type ToolFileDropHandlers,
} from "./useToolFileDrop";
import { PdfPagePreviewCard } from "./PdfPagePreviewCard";

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
  const pickComparisonRef = useRef<(file: File) => Promise<void>>(async () => {});

  // Render the pixel diff whenever the page or mode changes. Declared BEFORE the
  // early return below so the hook order stays stable when a document opens or
  // closes — otherwise React throws "Rendered fewer hooks than expected" (#300).
  const bytesA = app.docBytes;
  const consumeDroppedFiles = async (files: File[], handles: Array<Promise<unknown>>) => {
    const pdfs = files.flatMap((file, index) =>
      isPdfFile(file) ? [{ file, index }] : [],
    );
    if (!pdfs.length) {
      toast.error("Compare accepts PDF files");
      return;
    }
    if (files.length > 1) {
      toast.info("Compare uses one dropped PDF at a time; using the first file");
    }

    const [{ file, index }] = pdfs;
    if (app.pdf && bytesA) {
      await pickComparisonRef.current(file);
      return;
    }

    const resolvedHandles = await Promise.all(handles);
    const handle = resolvedHandles[index] as { kind?: string } | null | undefined;
    const opened = await app.openFile(file, handle?.kind === "file" ? handle : undefined);
    if (opened) {
      app.setScreen("compare");
      toast.success(`${file.name} loaded; drop a second PDF to compare`);
    }
  };
  const { dragOver, dropHandlers } = useToolFileDrop(consumeDroppedFiles);

  useEffect(() => {
    if (mode !== "pixel" || !bytesB || !bytesA) return;
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

  if (!app.pdf || !bytesA) {
    return (
      <ToolShellLite
        title="Compare documents"
        desc="Open a PDF first to compare it with another."
        dragOver={dragOver}
        dropHandlers={dropHandlers}
      >
        <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Open a PDF first (title bar → Open PDF), then pick a second file to compare.
        </div>
      </ToolShellLite>
    );
  }

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
  pickComparisonRef.current = onPickFile;

  const parts: DiffPart[] =
    bytesB && page < Math.max(textA.length, textB.length)
      ? diffWords(textA[page] ?? "", textB[page] ?? "")
      : [];
  const changed = hasTextChange(parts);
  const pageA = page < pagesA ? app.pdf.page(page) : null;
  const pageSize = pageA ?? app.pdf.page(Math.max(0, pagesA - 1));
  const previewScale = Math.min(480 / pageSize.width, 560 / pageSize.height);

  return (
    <div
      {...dropHandlers}
      className={cn(
        "scrollbar-soft h-full overflow-y-auto p-6 transition-shadow",
        dragOver && "ring-2 ring-inset ring-blue-500/60",
      )}
    >
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

        <div className="flex flex-wrap gap-6" data-testid="compare-workspace">
          <PdfPagePreviewCard
            pdf={app.pdf}
            page={pageA}
            pageSize={pageSize}
            pageIndex={page}
            pageCount={bytesB ? maxPages : pagesA}
            scale={previewScale}
            docVersion={app.docVersion}
            onPageChange={setPage}
            testId="compare-page-preview"
          >
            {!pageA && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/70 px-8 text-center text-sm font-medium text-muted-foreground">
                This page exists only in the comparison PDF.
              </div>
            )}
          </PdfPagePreviewCard>

          <div className="flex min-w-64 flex-1 flex-col gap-3" data-testid="compare-controls">
            {!bytesB ? (
              <button
                type="button"
                aria-label="Choose the PDF to compare against"
                className="flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card px-8 py-10 text-center shadow-shell transition-colors hover:border-primary/50"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Choose the PDF to compare against</span>
                <span className="text-xs text-muted-foreground">
                  It stays on your device — nothing is uploaded.
                </span>
              </button>
            ) : (
              <>
                <div className="rounded-xl border bg-card p-4 text-sm shadow-shell">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{nameB}</p>
                      <p className="pt-1 text-xs text-muted-foreground">
                        Comparing {app.docName} ({pagesA} pages) with {pagesB} pages
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                      Change
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                    {(["text", "pixel"] as Mode[]).map((m) => (
                      <Button
                        key={m}
                        variant={mode === m ? "secondary" : "ghost"}
                        size="sm"
                        className="h-8"
                        onClick={() => setMode(m)}
                      >
                        {m === "text" ? "Text diff" : "Pixel diff"}
                      </Button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Page {page + 1} of {maxPages}</span>
                    {page >= pagesA && (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-600">
                        Only in B
                      </span>
                    )}
                    {page >= pagesB && (
                      <span className="rounded bg-rose-500/15 px-2 py-0.5 text-rose-600">
                        Only in A
                      </span>
                    )}
                  </div>
                </div>

                {mode === "text" ? (
                  <div className="rounded-xl border bg-card p-4 shadow-shell">
                    <div className="flex flex-wrap items-center gap-2 pb-3 text-xs">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {changed ? "Text differs on this page" : "No text changes on this page"}
                      </span>
                      <span className="ml-auto flex items-center gap-3 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-300" /> removed
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-300" /> added
                        </span>
                      </span>
                    </div>
                    <p className="max-h-[380px] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {parts.length === 0 ? (
                        <span className="text-muted-foreground">No extractable text on this page.</span>
                      ) : (
                        parts.map((part, index) => (
                          <span
                            key={index}
                            className={cn(
                              part.type === "add" && "bg-emerald-200/60 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100",
                              part.type === "del" && "bg-rose-200/60 text-rose-900 line-through dark:bg-rose-500/25 dark:text-rose-100",
                            )}
                          >
                            {part.text}
                          </span>
                        ))
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-card p-4 shadow-shell">
                    <div className="flex flex-wrap items-center gap-2 pb-3 text-xs text-muted-foreground">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" />
                      <span>Red = changed pixels; faded gray = unchanged.</span>
                      {pixelChanged != null && (
                        <span className="ml-auto tabular-nums">
                          {(pixelChanged * 100).toFixed(2)}% changed
                        </span>
                      )}
                    </div>
                    <div className="flex max-h-[420px] justify-center overflow-auto rounded-lg bg-muted/40 p-3">
                      <canvas
                        ref={diffCanvasRef}
                        className="max-w-full shadow-shell ring-1 ring-border/60"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            {busy && <p className="text-center text-xs text-muted-foreground">Working…</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolShellLite({
  title,
  desc,
  children,
  dragOver,
  dropHandlers,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
  dragOver: boolean;
  dropHandlers: ToolFileDropHandlers;
}) {
  return (
    <div
      {...dropHandlers}
      className={cn(
        "scrollbar-soft h-full overflow-y-auto p-6 transition-shadow",
        dragOver && "ring-2 ring-inset ring-blue-500/60",
      )}
    >
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">{desc}</p>
        {children}
      </div>
    </div>
  );
}

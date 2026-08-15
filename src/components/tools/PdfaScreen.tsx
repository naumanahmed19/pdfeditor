import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import type { PdfaFinding, PdfaReport } from "../../lib/pdfa";
import { isTauri } from "../../lib/tauri";
import { isPdfFile, useToolFileDrop } from "./useToolFileDrop";

/**
 * PDF/A-2b preflight for the open document. Presents a checklist of rule
 * results grouped by severity — explicitly a preflight, not certification.
 */
export function PdfaScreen() {
  const app = useApp();
  const [report, setReport] = useState<PdfaReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [validatorNotice, setValidatorNotice] = useState<string | null>(null);

  // Re-run automatically when the document (or an edit to it) changes.
  const bytes = app.docBytes;
  const docVersion = app.docVersion;
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    setBusy(true);
    setValidatorNotice(null);
    (async () => {
      try {
        const { checkPdfA } = await import("../../lib/pdfa");
        const preflight = await checkPdfA(bytes);
        if (cancelled) return;
        setReport(preflight);

        if (
          isTauri &&
          import.meta.env.VITE_DISTRIBUTION_CHANNEL !== "mac-app-store"
        ) {
          // Avoid launching the Java validator for every intermediate edit.
          await new Promise((resolve) => window.setTimeout(resolve, 600));
          if (cancelled) return;
          const vera = await import("../../lib/verapdf");
          try {
            const validated = await vera.validatePdfAWithVeraPdf(bytes, "2b");
            if (!cancelled) setReport(validated);
          } catch (err) {
            if (!cancelled) {
              const detail = err instanceof Error ? err.message : "Unknown validation error";
              setValidatorNotice(
                err instanceof vera.VeraPdfUnavailableError
                  ? `${detail} Showing PickPDF's built-in preflight instead.`
                  : `veraPDF validation failed: ${detail} Showing the built-in preflight instead.`,
              );
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setReport(null);
          toast.error(`Check failed: ${err instanceof Error ? err.message : "error"}`);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, docVersion]);

  if (!app.pdf || !bytes) {
    return (
      <Shell>
        <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Open a PDF first (title bar → Open PDF) to run the PDF/A check.
        </div>
      </Shell>
    );
  }

  const failed = report?.findings.filter((f) => !f.passed) ?? [];
  const passed = report?.findings.filter((f) => f.passed) ?? [];
  const bySeverity = (s: PdfaFinding["severity"]) => failed.filter((f) => f.severity === s);

  return (
    <Shell docName={app.docName ?? undefined}>
      {report && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border p-4 shadow-shell",
            report.ready
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-rose-500/40 bg-rose-500/10",
          )}
        >
          {report.ready ? (
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
          ) : (
            <XCircle className="h-6 w-6 shrink-0 text-rose-600" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">{report.verdict}</p>
            <p className="text-xs text-muted-foreground">
              {report.errors} error{report.errors === 1 ? "" : "s"} · {report.warnings} warning
              {report.warnings === 1 ? "" : "s"} · {report.infos} info
            </p>
            {report.source === "verapdf" && (
              <p className="pt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Validated locally with veraPDF
                {report.validatorVersion ? ` ${report.validatorVersion}` : ""}
              </p>
            )}
          </div>
          {busy && (
            <RefreshCw className="ml-auto h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {busy && !report && (
        <p className="pt-6 text-center text-xs text-muted-foreground">Checking…</p>
      )}

      {report && (
        <>
          <Section title="Errors" items={bySeverity("error")} />
          <Section title="Warnings" items={bySeverity("warning")} />
          <Section title="Review" items={bySeverity("info")} />
          <Section title="Passed checks" items={passed} muted />
        </>
      )}

      {validatorNotice && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <p className="pb-1 font-medium">veraPDF is not active</p>
          {validatorNotice}
          <p className="pt-2">
            After installing veraPDF, add its launcher to PATH or set the
            <code className="mx-1 rounded bg-background/70 px-1 py-0.5">VERAPDF_EXECUTABLE</code>
            environment variable, then restart PickPDF.
          </p>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        {report?.source === "verapdf" ? (
          <>
            <p className="pb-1 font-medium text-foreground">Standards validation by veraPDF</p>
            The document was checked locally against {report.profileName ?? "PDF/A-2b"}. No file
            was uploaded. A compliant result is a validator finding, not a legal certification.
          </>
        ) : (
          <>
            <p className="pb-1 font-medium text-foreground">
              This is a preflight check, not certification.
            </p>
            It inspects the document's structure against a PDF/A-2b-oriented baseline (encryption,
            font embedding, transparency, JavaScript, attachments, XFA, XMP metadata, OutputIntent,
            annotation rules). It does not validate content streams, color spaces against the
            OutputIntent, or XMP schema conformance
            {isTauri ? "." : " — install the desktop app with veraPDF for full validation."}
          </>
        )}
      </div>
    </Shell>
  );
}

function Section({
  title,
  items,
  muted,
}: {
  title: string;
  items: PdfaFinding[];
  muted?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="pt-5">
      <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </p>
      <div className="flex flex-col gap-2">
        {items.map((f) => (
          <FindingRow key={f.id} finding={f} muted={muted} />
        ))}
      </div>
    </div>
  );
}

function FindingRow({ finding, muted }: { finding: PdfaFinding; muted?: boolean }) {
  const icon = finding.passed ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
  ) : finding.severity === "error" ? (
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
  ) : finding.severity === "warning" ? (
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
  ) : (
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
  );
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm",
        muted && "opacity-80",
      )}
    >
      {icon}
      <div className="min-w-0">
        <p className="text-sm font-medium">{finding.title}</p>
        <p className="pt-0.5 text-xs text-muted-foreground">{finding.detail}</p>
        {finding.items && finding.items.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {finding.items.map((item) => (
              <li
                key={item}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Shell({ docName, children }: { docName?: string; children: React.ReactNode }) {
  const app = useApp();
  const consumeFiles = async (files: File[], handles: Array<Promise<unknown>>) => {
    const pdfs = files.flatMap((file, index) =>
      isPdfFile(file) ? [{ file, index }] : [],
    );
    if (!pdfs.length) {
      toast.error("PDF/A check accepts PDF files");
      return;
    }
    if (pdfs.length > 1) {
      toast.info("PDF/A check works with one PDF at a time; using the first file");
    }
    const [{ file, index }] = pdfs;
    const resolvedHandles = await Promise.all(handles);
    const handle = resolvedHandles[index] as { kind?: string } | null | undefined;
    const opened = await app.openFile(file, handle?.kind === "file" ? handle : undefined);
    if (opened) app.setScreen("pdfa");
  };
  const { dragOver, dropHandlers } = useToolFileDrop(consumeFiles);

  return (
    <div
      {...dropHandlers}
      className={cn(
        "scrollbar-soft h-full overflow-y-auto p-6 transition-shadow",
        dragOver && "ring-2 ring-inset ring-blue-500/60",
      )}
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">PDF/A check</h1>
        </div>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          {docName ? (
            <>
              Check <span className="font-medium text-foreground">{docName}</span> against PDF/A-2b
              for archival readiness. Runs locally — nothing is uploaded.
            </>
          ) : (
            "Check the open document against PDF/A-2b for archival readiness."
          )}
        </p>
        {children}
      </div>
    </div>
  );
}

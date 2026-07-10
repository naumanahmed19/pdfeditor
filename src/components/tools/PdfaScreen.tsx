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

/**
 * PDF/A-2b preflight for the open document. Presents a checklist of rule
 * results grouped by severity — explicitly a preflight, not certification.
 */
export function PdfaScreen() {
  const app = useApp();
  const [report, setReport] = useState<PdfaReport | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-run automatically when the document (or an edit to it) changes.
  const bytes = app.docBytes;
  const docVersion = app.docVersion;
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        const { checkPdfA } = await import("../../lib/pdfa");
        const r = await checkPdfA(bytes);
        if (!cancelled) setReport(r);
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

      <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="pb-1 font-medium text-foreground">This is a preflight check, not certification.</p>
        It inspects the document's structure against a PDF/A-2b-oriented baseline (encryption,
        font embedding, transparency, JavaScript, attachments, XFA, XMP metadata, OutputIntent,
        annotation rules). It does not validate content streams, color spaces against the
        OutputIntent, or XMP schema conformance — for formal compliance verification use a
        dedicated validator such as veraPDF.
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
  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">PDF/A check</h1>
        </div>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          {docName ? (
            <>
              Preflight <span className="font-medium text-foreground">{docName}</span> against a
              PDF/A-2b baseline for archival readiness. Runs locally — nothing is uploaded.
            </>
          ) : (
            "Preflight the open document against a PDF/A-2b baseline for archival readiness."
          )}
        </p>
        {children}
      </div>
    </div>
  );
}

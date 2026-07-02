import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { formatBytes } from "../../lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface DocInfo {
  title: string;
  author: string;
  subject: string;
  producer: string;
  created: string;
  pageSize: string;
}

export function PropertiesModal({ open, onClose }: Props) {
  const app = useApp();
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  useEffect(() => {
    if (!open || !app.pdf) return;
    let alive = true;
    (async () => {
      const meta = await app.pdf!.getMetadata().catch(() => null);
      const raw = (meta?.info ?? {}) as Record<string, string>;
      const page = await app.pdf!.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const toMm = (pt: number) => Math.round(pt * 0.352778);
      const next: DocInfo = {
        title: raw.Title ?? "",
        author: raw.Author ?? "",
        subject: raw.Subject ?? "",
        producer: raw.Producer ?? "",
        created: raw.CreationDate?.replace(/^D:/, "").slice(0, 8) ?? "",
        pageSize: `${Math.round(vp.width)} × ${Math.round(vp.height)} pt (${toMm(vp.width)} × ${toMm(vp.height)} mm)`,
      };
      if (alive) {
        setInfo(next);
        setTitle(next.title);
        setAuthor(next.author);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, app.pdf]);

  if (!open || !app.pdf) return null;

  const metaChanged = info && (title !== info.title || author !== info.author);

  const applyMeta = () => {
    void app.applyBytesOp(async (bytes) => {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      doc.setTitle(title);
      doc.setAuthor(author);
      return doc.save();
    }, "Metadata updated");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-sm font-semibold">Document properties</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <PropRow label="File" value={app.docName ?? ""} />
          <PropRow label="Pages" value={String(app.numPages)} />
          <PropRow
            label="Size"
            value={app.docBytes ? formatBytes(app.docBytes.length) : ""}
          />
          {info && (
            <>
              <PropRow label="Page size" value={info.pageSize} />
              {info.subject && <PropRow label="Subject" value={info.subject} />}
              {info.producer && <PropRow label="Producer" value={info.producer} />}
              {info.created && (
                <PropRow
                  label="Created"
                  value={`${info.created.slice(0, 4)}-${info.created.slice(4, 6)}-${info.created.slice(6, 8)}`}
                />
              )}
            </>
          )}

          <div className="pt-2">
            <p className="pb-1 text-xs font-medium text-muted-foreground">Title</p>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" />
          </div>
          <div>
            <p className="pb-1 text-xs font-medium text-muted-foreground">Author</p>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Unknown" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" disabled={!metaChanged} onClick={applyMeta}>
            Apply metadata
          </Button>
        </div>
      </div>
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 pb-1.5 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right" title={value}>
        {value || "—"}
      </span>
    </div>
  );
}

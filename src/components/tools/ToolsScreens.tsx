import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Download,
  FileImage,
  FilePlus2,
  FolderOpen,
  Import,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Thumbnail } from "../layout/Sidebar";
import {
  addPageNumbers,
  addWatermark,
  deletePages,
  duplicatePage,
  extractPages,
  insertBlankPage,
  insertPdfPages,
  mergeMixed,
  movePage,
  rotatePage,
  type MergeInput,
} from "../../lib/pdftools";
import { renderPageToCanvas } from "../../lib/pdf";
import {
  downloadBytes,
  downloadZip,
  formatBytes,
  parsePageRanges,
} from "../../lib/utils";
import { cn } from "../../lib/utils";

function ToolShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}

function NeedsDocument() {
  return (
    <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
      Open a PDF first (title bar → Open PDF) to use this tool.
    </div>
  );
}

/* ---------------- Organize ---------------- */

export function OrganizeScreen() {
  const app = useApp();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const insertRef = useRef<HTMLInputElement>(null);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShell title="Organize pages" description="Reorder, rotate, delete and extract pages.">
        <NeedsDocument />
      </ToolShell>
    );
  }

  return (
    <ToolShell
      title="Organize pages"
      description="Drag pages to reorder — or use the buttons to rotate, duplicate, delete and insert. Changes apply to the open document."
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: app.numPages }, (_, i) => (
          <div
            key={`${app.docVersion}-${i}`}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && dragFrom !== i) {
                void app.applyBytesOp(
                  (b) => movePage(b, dragFrom, i),
                  `Moved page ${dragFrom + 1} to position ${i + 1}`,
                );
              }
              setDragFrom(null);
              setDragOver(null);
            }}
            className={cn(
              "flex cursor-grab flex-col gap-1.5 rounded-xl border bg-card p-2 shadow-shell transition-colors active:cursor-grabbing",
              dragOver === i && dragFrom !== i && "border-blue-500 ring-1 ring-blue-500/50",
            )}
          >
            <Thumbnail pdf={app.pdf!} pageIndex={i} width={160} />
            <div className="flex items-center justify-center gap-0.5">
              <IconBtn
                title="Move left"
                disabled={i === 0}
                onClick={() =>
                  void app.applyBytesOp((b) => movePage(b, i, i - 1), `Moved page ${i + 1}`)
                }
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Rotate left"
                onClick={() =>
                  void app.applyBytesOp((b) => rotatePage(b, i, -90), `Rotated page ${i + 1}`)
                }
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Rotate right"
                onClick={() =>
                  void app.applyBytesOp((b) => rotatePage(b, i, 90), `Rotated page ${i + 1}`)
                }
              >
                <RotateCw className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Insert blank page after"
                onClick={() =>
                  void app.applyBytesOp(
                    (b) => insertBlankPage(b, i + 1),
                    "Inserted blank page",
                  )
                }
              >
                <FilePlus2 className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Duplicate page"
                onClick={() =>
                  void app.applyBytesOp(
                    (b) => duplicatePage(b, i),
                    `Duplicated page ${i + 1}`,
                  )
                }
              >
                <Copy className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Delete page"
                disabled={app.numPages <= 1}
                onClick={() =>
                  void app.applyBytesOp((b) => deletePages(b, [i]), `Deleted page ${i + 1}`)
                }
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </IconBtn>
              <IconBtn
                title="Move right"
                disabled={i === app.numPages - 1}
                onClick={() =>
                  void app.applyBytesOp((b) => movePage(b, i, i + 1), `Moved page ${i + 1}`)
                }
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-5">
        <Button onClick={() => void app.downloadCurrent()} className="gap-2">
          <Download className="h-4 w-4" /> Save PDF
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => insertRef.current?.click()}
        >
          <Import className="h-4 w-4" /> Insert pages from PDF…
        </Button>
        <input
          ref={insertRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const other = new Uint8Array(await f.arrayBuffer());
            void app.applyBytesOp(
              (b) => insertPdfPages(b, other, app.numPages),
              `Inserted pages from ${f.name}`,
            );
          }}
        />
      </div>
    </ToolShell>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* ---------------- Merge ---------------- */

interface MergeFile {
  name: string;
  bytes: Uint8Array;
  kind: MergeInput["kind"];
}

export function MergeScreen() {
  const app = useApp();
  const [files, setFiles] = useState<MergeFile[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: MergeFile[] = [];
    for (const f of Array.from(list)) {
      const kind: MergeInput["kind"] =
        f.type === "image/png"
          ? "image/png"
          : f.type === "image/jpeg"
            ? "image/jpeg"
            : "pdf";
      next.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), kind });
    }
    setFiles((prev) => [...prev, ...next]);
  };

  const move = (i: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const doMerge = async (openAfter: boolean) => {
    if (files.length < 1 || (files.length < 2 && files[0].kind === "pdf")) {
      toast.error("Add at least two PDFs, or one or more images");
      return;
    }
    setBusy(true);
    try {
      const merged = await mergeMixed(files);
      if (openAfter) {
        await app.openBytes(merged, "merged.pdf");
        toast.success("Merged document opened");
      } else {
        downloadBytes(merged, "merged.pdf");
        toast.success("Merged PDF downloaded");
      }
    } catch (err) {
      toast.error(`Merge failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Merge PDFs"
      description="Combine PDFs — and PNG/JPG images, each becoming a page — into a single document, in the order listed."
    >
      <div className="flex flex-col gap-2">
        {files.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm"
          >
            <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
            <span className="flex-1 truncate">{f.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(f.bytes.length)}</span>
            <IconBtn title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn title="Move down" disabled={i === files.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn title="Remove" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" />
            </IconBtn>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-4">
        <Button variant="outline" className="gap-2" onClick={() => inputRef.current?.click()}>
          <FolderOpen className="h-4 w-4" /> Add PDFs / images
        </Button>
        <Button disabled={busy || files.length < 1} className="gap-2" onClick={() => void doMerge(false)}>
          <Download className="h-4 w-4" /> Merge & download
        </Button>
        <Button
          variant="secondary"
          disabled={busy || files.length < 1}
          onClick={() => void doMerge(true)}
        >
          Merge & open here
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </ToolShell>
  );
}

/* ---------------- Split ---------------- */

export function SplitScreen() {
  const app = useApp();
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(false);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShell title="Split & extract" description="Extract page ranges or split into single pages.">
        <NeedsDocument />
      </ToolShell>
    );
  }
  const bytes = app.docBytes;
  const name = (app.docName ?? "document.pdf").replace(/\.pdf$/i, "");

  const extract = async (openAfter: boolean) => {
    const idx = parsePageRanges(ranges, app.numPages);
    if (!idx.length) {
      toast.error(`Enter valid pages, e.g. "1-3, 5" (document has ${app.numPages} pages)`);
      return;
    }
    setBusy(true);
    try {
      const out = await extractPages(bytes, idx);
      if (openAfter) {
        await app.openBytes(out, `${name}-extract.pdf`);
        toast.success("Extracted pages opened");
      } else {
        downloadBytes(out, `${name}-pages.pdf`);
        toast.success(`Extracted ${idx.length} page(s)`);
      }
    } finally {
      setBusy(false);
    }
  };

  const splitAll = async () => {
    setBusy(true);
    try {
      const zipFiles: Array<{ name: string; data: Uint8Array }> = [];
      for (let i = 0; i < app.numPages; i++) {
        zipFiles.push({
          name: `${name}-p${i + 1}.pdf`,
          data: await extractPages(bytes, [i]),
        });
      }
      await downloadZip(zipFiles, `${name}-pages.zip`);
      toast.success(`Split into ${app.numPages} files (zip)`);
    } finally {
      setBusy(false);
    }
  };

  const exportImages = async () => {
    setBusy(true);
    try {
      const zipFiles: Array<{ name: string; data: Blob }> = [];
      for (let i = 0; i < app.numPages; i++) {
        const canvas = document.createElement("canvas");
        await renderPageToCanvas(app.pdf!, i, canvas, 2);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/png"),
        );
        zipFiles.push({ name: `${name}-p${i + 1}.png`, data: blob });
      }
      await downloadZip(zipFiles, `${name}-images.zip`);
      toast.success(`Exported ${app.numPages} page image(s)`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Split & extract"
      description={`Extract a selection of pages into a new PDF, or split all ${app.numPages} pages into individual files.`}
    >
      <div className="rounded-xl border bg-card p-4 shadow-shell">
        <p className="pb-2 text-sm font-medium">Extract pages</p>
        <div className="flex gap-2">
          <Input
            value={ranges}
            onChange={(e) => setRanges(e.target.value)}
            placeholder={`e.g. 1-3, 5, 8-${app.numPages}`}
          />
          <Button disabled={busy} onClick={() => void extract(false)}>
            Download
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void extract(true)}>
            Open here
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4 shadow-shell">
        <p className="pb-1 text-sm font-medium">Split into single pages</p>
        <p className="pb-3 text-xs text-muted-foreground">
          Downloads a zip with one PDF per page ({app.numPages} files).
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void splitAll()}>
          Split all pages (zip)
        </Button>
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4 shadow-shell">
        <p className="pb-1 text-sm font-medium">Export pages as images</p>
        <p className="pb-3 text-xs text-muted-foreground">
          Renders every page as a high-resolution PNG and downloads them as a zip.
        </p>
        <Button variant="outline" disabled={busy} className="gap-2" onClick={() => void exportImages()}>
          <FileImage className="h-4 w-4" /> Export PNGs (zip)
        </Button>
      </div>
    </ToolShell>
  );
}

/* ---------------- Watermark & page numbers ---------------- */

export function WatermarkScreen() {
  const app = useApp();
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.15);
  const [size, setSize] = useState(64);
  const [color, setColor] = useState("#dc2626");
  const [diagonal, setDiagonal] = useState(true);
  const [numSize, setNumSize] = useState(10);
  const [numPos, setNumPos] = useState<"bottom-center" | "bottom-right">("bottom-center");

  if (!app.pdf) {
    return (
      <ToolShell title="Watermark & page numbers" description="Stamp every page with a watermark or add page numbers.">
        <NeedsDocument />
      </ToolShell>
    );
  }

  return (
    <ToolShell
      title="Watermark & page numbers"
      description="Stamp every page with a watermark or add page numbers. Applies to the open document."
    >
      <div className="rounded-xl border bg-card p-4 shadow-shell">
        <p className="pb-3 text-sm font-medium">Text watermark</p>
        <div className="flex flex-col gap-3">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Watermark text" />
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              Opacity
              <input
                type="range"
                min={0.05}
                max={0.6}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
              {Math.round(opacity * 100)}%
            </label>
            <label className="flex items-center gap-2">
              Size
              <input
                type="range"
                min={24}
                max={120}
                step={4}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
              {size}pt
            </label>
            <label className="flex items-center gap-2">
              Color
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-6 w-8 cursor-pointer rounded border border-input"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={diagonal}
                onChange={(e) => setDiagonal(e.target.checked)}
              />
              Diagonal
            </label>
          </div>
          <div>
            <Button
              disabled={!text.trim()}
              onClick={() =>
                void app.applyBytesOp(
                  (b) => addWatermark(b, text.trim(), { opacity, fontSize: size, color, diagonal }),
                  "Watermark added",
                )
              }
            >
              Apply watermark
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4 shadow-shell">
        <p className="pb-3 text-sm font-medium">Page numbers</p>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Size
            <Select
              value={numSize}
              onChange={(e) => setNumSize(Number(e.target.value))}
              aria-label="Page number size"
              className="h-7 w-16 px-2 text-xs"
            >
              {[8, 9, 10, 11, 12, 14].map((s) => (
                <option key={s} value={s}>
                  {s}pt
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2">
            Position
            <Select
              value={numPos}
              onChange={(e) => setNumPos(e.target.value as any)}
              aria-label="Page number position"
              className="h-7 w-32 px-2 text-xs"
            >
              <option value="bottom-center">Bottom center</option>
              <option value="bottom-right">Bottom right</option>
            </Select>
          </label>
          <Button
            size="sm"
            onClick={() =>
              void app.applyBytesOp(
                (b) => addPageNumbers(b, { fontSize: numSize, position: numPos }),
                "Page numbers added",
              )
            }
          >
            Add page numbers
          </Button>
        </div>
      </div>

      <div className="pt-5">
        <Button variant="outline" className="gap-2" onClick={() => void app.downloadCurrent()}>
          <Download className="h-4 w-4" /> Save PDF
        </Button>
      </div>
    </ToolShell>
  );
}

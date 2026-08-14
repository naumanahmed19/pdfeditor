import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Crop,
  Download,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  FileType2,
  Import,
  Minimize2,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ColorSwatch } from "../ui/color-swatch";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio";
import { Select } from "../ui/select";
import { Slider } from "../ui/slider";
import { Tip } from "../ui/tooltip";
import { Thumbnail } from "../layout/Sidebar";
import {
  addHeadersFooters,
  addPageNumbers,
  addWatermark,
  cropPages,
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
import { loadPdf, renderPageToCanvas, type PdfDoc } from "../../lib/pdf";
import {
  downloadBytes,
  downloadZip,
  formatBytes,
  parsePageRanges,
} from "../../lib/utils";
import { cn } from "../../lib/utils";
import {
  isJpegFile,
  isPdfFile,
  isPngFile,
  useToolFileDrop,
  type DroppedHandlePromises,
} from "./useToolFileDrop";
import { FileCollectionView } from "./FileCollectionView";
import {
  ToolPageContainer,
  ToolPageHeader,
  type ToolPageWidth,
} from "./ToolPageHeader";
import { ToolFileSidebar, ToolSidebarPortal } from "./ToolFileSidebar";

function ToolShell({
  title,
  description,
  children,
  onFilesDropped,
  headerActions,
  width = "standard",
  showIntro = true,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onFilesDropped?: (files: File[]) => void | Promise<void>;
  headerActions?: React.ReactNode;
  width?: ToolPageWidth;
  showIntro?: boolean;
}) {
  const app = useApp();
  const toolScreen = app.screen;
  const consumeFiles = async (files: File[], handles: DroppedHandlePromises) => {
    if (onFilesDropped) {
      await onFilesDropped(files);
      return;
    }

    const pdfs = files.flatMap((file, index) =>
      isPdfFile(file) ? [{ file, index }] : [],
    );
    const skipped = files.length - pdfs.length;
    if (!pdfs.length) {
      toast.error("This tool accepts PDF files");
      return;
    }
    if (skipped) {
      toast.error(`Skipped ${skipped} non-PDF file${skipped === 1 ? "" : "s"}`);
    }
    if (pdfs.length > 1) {
      toast.info("This tool works with one PDF at a time; using the first file");
    }

    const [{ file, index }] = pdfs;
    const resolvedHandles = await Promise.all(handles);
    const handle = resolvedHandles[index] as { kind?: string } | null | undefined;
    const opened = await app.openFile(file, handle?.kind === "file" ? handle : undefined);
    if (opened) app.setScreen(toolScreen);
  };
  const { dragOver, dropHandlers } = useToolFileDrop(consumeFiles);

  return (
    <div
      {...dropHandlers}
      data-testid="tool-drop-surface"
      className={cn(
        "scrollbar-soft h-full overflow-y-auto p-6 transition-shadow",
        dragOver && "ring-2 ring-inset ring-blue-500/60",
      )}
    >
      <ToolPageContainer width={width}>
        <ToolPageHeader
          title={title}
          description={description}
          actions={headerActions}
          showIntro={showIntro}
        />
        {children}
      </ToolPageContainer>
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
  const [insertAt, setInsertAt] = useState("end");
  const insertRef = useRef<HTMLInputElement>(null);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShell title="Organize pages" description="Reorder, rotate, delete and extract pages.">
        <NeedsDocument />
      </ToolShell>
    );
  }

  const requestedInsertIndex = insertAt === "end" ? app.numPages : Number(insertAt);
  const insertIndex = Number.isFinite(requestedInsertIndex)
    ? Math.max(0, Math.min(Math.floor(requestedInsertIndex), app.numPages))
    : app.numPages;
  const insertValue = insertAt === "end" || insertIndex >= app.numPages ? "end" : String(insertIndex);
  const insertPositionText =
    insertIndex === 0
      ? "at beginning"
      : insertIndex >= app.numPages
        ? "at end"
        : `between pages ${insertIndex} and ${insertIndex + 1}`;
  const insertOptions = [
    { value: "0", label: "At beginning" },
    ...Array.from({ length: Math.max(0, app.numPages - 1) }, (_, i) => ({
      value: String(i + 1),
      label: `Between pages ${i + 1} and ${i + 2}`,
    })),
    { value: "end", label: "At end" },
  ];

  return (
    <ToolShell
      title="Organize pages"
      description="Drag pages to reorder — or use the buttons to rotate, duplicate, delete and insert. Changes apply to the open document."
    >
      <div className="mb-4 rounded-xl border bg-card p-3 shadow-shell">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Insert at</span>
          <Select
            value={insertValue}
            onChange={(e) => setInsertAt(e.target.value)}
            aria-label="Insertion position"
            className="h-8 w-56 px-2 text-xs"
          >
            {insertOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            className="h-8 gap-2"
            onClick={() =>
              void app.applyBytesOp(
                (b) => insertBlankPage(b, insertIndex),
                `Inserted blank page ${insertPositionText}`,
              )
            }
          >
            <FilePlus2 className="h-4 w-4" /> Blank page
          </Button>
          <Button
            variant="outline"
            className="h-8 gap-2"
            onClick={() => insertRef.current?.click()}
          >
            <Import className="h-4 w-4" /> Pages from PDF...
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
                (b) => insertPdfPages(b, other, insertIndex),
                `Inserted pages from ${f.name} ${insertPositionText}`,
              );
            }}
          />
        </div>
      </div>
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
                title={`Insert blank page after page ${i + 1}`}
                onClick={() =>
                  void app.applyBytesOp(
                    (b) => insertBlankPage(b, i + 1),
                    `Inserted blank page after page ${i + 1}`,
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
    <Tip label={title}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        className="h-6 w-6 rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        {children}
      </Button>
    </Tip>
  );
}

/* ---------------- Merge ---------------- */

interface MergeFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  kind: MergeInput["kind"];
  rotation: 0 | 90 | 180 | 270;
  preview:
    | { kind: "pdf"; pdf: PdfDoc }
    | { kind: "image"; url: string };
}

let mergeFileSequence = 0;
const nextMergeFileId = () => `merge-file-${++mergeFileSequence}`;

export function MergeScreen() {
  const app = useApp();
  const [files, setFiles] = useState<MergeFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () => {
      for (const file of filesRef.current) {
        if (file.preview.kind === "image") URL.revokeObjectURL(file.preview.url);
      }
    },
    [],
  );

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    const next: MergeFile[] = [];
    let skipped = 0;
    for (const f of Array.from(list)) {
      if (!isPdfFile(f) && !isPngFile(f) && !isJpegFile(f)) {
        skipped++;
        continue;
      }
      const kind: MergeInput["kind"] =
        isPngFile(f)
          ? "image/png"
          : isJpegFile(f)
            ? "image/jpeg"
            : "pdf";
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const preview: MergeFile["preview"] =
          kind === "pdf"
            ? { kind: "pdf", pdf: await loadPdf(bytes) }
            : { kind: "image", url: URL.createObjectURL(f) };
        next.push({ id: nextMergeFileId(), name: f.name, bytes, kind, rotation: 0, preview });
      } catch (err) {
        skipped++;
        toast.error(
          `Couldn't add ${f.name}: ${err instanceof Error ? err.message : "unreadable file"}`,
        );
      }
    }
    if (next.length) {
      setFiles((prev) => [...prev, ...next]);
      setSelectedFileId((current) => current ?? next[0].id);
    }
    if (skipped) {
      toast.error(
        skipped === list.length
          ? "Merge accepts PDF, PNG, and JPEG files"
          : `Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}`,
      );
    }
  };

  const reorder = (from: number, to: number) => {
    setFiles((prev) => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const duplicate = (index: number) => {
    setFiles((prev) => {
      const source = prev[index];
      if (!source) return prev;
      const preview: MergeFile["preview"] =
        source.preview.kind === "pdf"
          ? source.preview
          : {
              kind: "image",
              url: URL.createObjectURL(
                new Blob([source.bytes.slice().buffer as ArrayBuffer], { type: source.kind }),
              ),
            };
      const copy: MergeFile = { ...source, id: nextMergeFileId(), preview };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const rotate = (index: number) => {
    setFiles((prev) =>
      prev.map((file, itemIndex) =>
        itemIndex === index
          ? { ...file, rotation: ((file.rotation + 90) % 360) as MergeFile["rotation"] }
          : file,
      ),
    );
  };

  const remove = (index: number) => {
    const removedId = files[index]?.id;
    if (removedId && removedId === selectedFileId) {
      setSelectedFileId(files[index + 1]?.id ?? files[index - 1]?.id ?? null);
    }
    setFiles((prev) => {
      const removed = prev[index];
      if (removed?.preview.kind === "image") URL.revokeObjectURL(removed.preview.url);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const renderMergePreview = (file: MergeFile) => (
    <div
      data-testid="merge-file-preview"
      data-rotation={file.rotation}
      className="flex h-full w-full items-center justify-center transition-transform duration-200"
      style={{
        transform: `rotate(${file.rotation}deg) scale(${file.rotation % 180 === 0 ? 1 : 0.75})`,
      }}
    >
      {file.preview.kind === "pdf" ? (
        <Thumbnail pdf={file.preview.pdf} pageIndex={0} width={128} />
      ) : (
        <img
          src={file.preview.url}
          alt=""
          className="max-h-full max-w-full rounded object-contain"
        />
      )}
    </div>
  );
  const getMergeMeta = (file: MergeFile) =>
    `${formatBytes(file.bytes.length)} · ${
      file.kind === "pdf" ? "PDF" : file.kind === "image/png" ? "PNG" : "JPEG"
    }${file.rotation ? ` · ${file.rotation}°` : ""}`;

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
      width="full"
      showIntro={false}
      onFilesDropped={addFiles}
      description="Combine PDFs — and PNG/JPG images, each becoming a page — into a single document, in the order listed."
      headerActions={
        files.length ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              className="h-7"
              onClick={() => void doMerge(true)}
            >
              Merge & open here
            </Button>
            <Button
              size="sm"
              disabled={busy}
              className="h-7 gap-1.5"
              onClick={() => void doMerge(false)}
            >
              <Download className="h-3.5 w-3.5" /> Merge & download
            </Button>
          </>
        ) : undefined
      }
    >
      <ToolSidebarPortal>
        <ToolFileSidebar
          items={files}
          getKey={(file) => file.id}
          getName={(file) => file.name}
          getMeta={getMergeMeta}
          getFileType={(file) =>
            file.kind === "pdf" ? "pdf" : file.kind === "image/png" ? "png" : "jpeg"
          }
          emptyText="No merge files yet. Add or drop PDFs and images to begin."
          addLabel="Add merge files"
          onAdd={() => inputRef.current?.click()}
          onReorder={reorder}
          onDuplicate={duplicate}
          onRotate={rotate}
          onRemove={remove}
          selectedKey={selectedFileId}
          onSelect={(file) => setSelectedFileId(file.id)}
        />
      </ToolSidebarPortal>
      <FileCollectionView
        items={files}
        getKey={(file) => file.id}
        getName={(file) => file.name}
        getMeta={getMergeMeta}
        renderPreview={renderMergePreview}
        emptyTitle="Drop PDFs or images here"
        emptyDescription="Add multiple PDF, PNG, or JPEG files. They will be merged in the order shown."
        emptyActionLabel="Choose files"
        addMoreLabel="Add more PDFs or images"
        onEmptyAction={() => inputRef.current?.click()}
        onReorder={reorder}
        onDuplicate={duplicate}
        onRotate={rotate}
        onRemove={remove}
        selectedKey={selectedFileId}
        onSelect={(file) => setSelectedFileId(file.id)}
      />

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

      <div className="mt-4 rounded-xl border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
        Looking to export as images, text or HTML? Use{" "}
        <button
          className="font-medium text-foreground underline underline-offset-2"
          onClick={() => app.setScreen("export")}
        >
          Tools → Export
        </button>
        .
      </div>
    </ToolShell>
  );
}

/* ---------------- Export (text / HTML / images) ---------------- */

export function ExportScreen() {
  const app = useApp();
  const [busy, setBusy] = useState<null | "text" | "html" | "docx" | "png">(null);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShell title="Export" description="Export the document as text, HTML or page images.">
        <NeedsDocument />
      </ToolShell>
    );
  }
  const bytes = app.docBytes;
  const numPages = app.numPages;
  const name = (app.docName ?? "document.pdf").replace(/\.pdf$/i, "");

  const exportText = async () => {
    setBusy("text");
    try {
      const { toPlainText } = await import("../../lib/export");
      const { downloadText } = await import("../../lib/utils");
      const text = await toPlainText(bytes, numPages);
      if (!text.trim()) {
        toast.error("No extractable text — this may be a scanned PDF. Try Tools → Make searchable (OCR) first.");
        return;
      }
      downloadText(text, `${name}.txt`, "text/plain");
      toast.success("Exported text");
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  };

  const exportHtml = async () => {
    setBusy("html");
    try {
      const { toHtml } = await import("../../lib/export");
      const { downloadText } = await import("../../lib/utils");
      const html = await toHtml(bytes, numPages, name);
      downloadText(html, `${name}.html`, "text/html");
      toast.success("Exported HTML");
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  };

  const exportDocx = async () => {
    setBusy("docx");
    try {
      const { toDocx } = await import("../../lib/export");
      const { downloadBlob } = await import("../../lib/utils");
      const blob = await toDocx(bytes, numPages);
      downloadBlob(blob, `${name}.docx`);
      toast.success("Exported Word document");
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  };

  const exportImages = async () => {
    setBusy("png");
    try {
      const zipFiles: Array<{ name: string; data: Blob }> = [];
      for (let i = 0; i < numPages; i++) {
        const canvas = document.createElement("canvas");
        await renderPageToCanvas(app.pdf!, i, canvas, 2);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/png"),
        );
        zipFiles.push({ name: `${name}-p${i + 1}.png`, data: blob });
      }
      await downloadZip(zipFiles, `${name}-images.zip`);
      toast.success(`Exported ${numPages} page image(s)`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  };

  const card = (
    title: string,
    desc: string,
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    disabled: boolean,
  ) => (
    <div className="rounded-xl border bg-card p-4 shadow-shell">
      <p className="pb-1 text-sm font-medium">{title}</p>
      <p className="pb-3 text-xs text-muted-foreground">{desc}</p>
      <Button variant="outline" disabled={!!busy} className="gap-2" onClick={onClick}>
        {icon} {disabled ? "Working…" : label}
      </Button>
    </div>
  );

  return (
    <ToolShell
      title="Export"
      description="Convert the document to plain text, HTML, a Word document, or page images."
    >
      <div className="flex flex-col gap-4">
        {card(
          "Plain text (.txt)",
          "Extracts the document's text in reading order, one line per line, pages separated by a form feed.",
          <FileText className="h-4 w-4" />,
          "Export text",
          () => void exportText(),
          busy === "text",
        )}
        {card(
          "HTML (.html)",
          "A styled web page with headings and paragraphs detected from font sizes and spacing. Layout is approximate.",
          <FileCode2 className="h-4 w-4" />,
          "Export HTML",
          () => void exportHtml(),
          busy === "html",
        )}
        {card(
          "Word (.docx)",
          "An editable Word document with real Heading 1/2 styles and paragraphs detected from font sizes and spacing; source pages separated by page breaks. Layout is approximate.",
          <FileType2 className="h-4 w-4" />,
          "Export Word",
          () => void exportDocx(),
          busy === "docx",
        )}
        {card(
          "Page images (.png, zip)",
          "Renders every page as a high-resolution PNG and downloads them as a zip.",
          <FileImage className="h-4 w-4" />,
          "Export PNGs (zip)",
          () => void exportImages(),
          busy === "png",
        )}
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
            <div className="flex items-center gap-2">
              Opacity
              <Slider
                value={opacity}
                onValueChange={setOpacity}
                min={0.05}
                max={0.6}
                step={0.05}
                aria-label="Opacity"
                className="w-28"
              />
              <span className="w-8 tabular-nums">{Math.round(opacity * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              Size
              <Slider
                value={size}
                onValueChange={setSize}
                min={24}
                max={120}
                step={4}
                aria-label="Watermark size"
                className="w-28"
              />
              <span className="w-9 tabular-nums">{size}pt</span>
            </div>
            <label className="flex items-center gap-2">
              Color
              <ColorSwatch value={color} onChange={setColor} title="Watermark color" />
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={diagonal} onCheckedChange={(v: boolean) => setDiagonal(v)} />
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

/* ---------------- Compress / optimize ---------------- */

export function CompressScreen() {
  const app = useApp();
  const [quality, setQuality] = useState(0.75);
  const [dpi, setDpi] = useState(150);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    before: number;
    after: number;
    images: number;
  } | null>(null);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShell title="Compress" description="Reduce file size by downsampling and re-encoding images.">
        <NeedsDocument />
      </ToolShell>
    );
  }

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      // The compressor lives in the lazily-loaded PDFium module (~5 MB wasm).
      const { compressImages } = await import("../../lib/pdfium");
      await app.applyBytesOp(async (b) => {
        const res = await compressImages(b, { quality, targetDpi: dpi });
        setResult({ before: res.before, after: res.after, images: res.imagesProcessed });
        return res.bytes;
      }, "Document compressed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Compress"
      description={`Shrink “${app.docName ?? "the document"}” by downsampling oversized images and re-encoding them. Text and vector content stay sharp.`}
    >
      <div className="rounded-xl border bg-card p-4 shadow-shell">
        <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            Image quality
            <Slider
              value={quality}
              onValueChange={setQuality}
              min={0.4}
              max={0.95}
              step={0.05}
              aria-label="Image quality"
              className="w-28"
            />
            <span className="w-8 tabular-nums">{Math.round(quality * 100)}%</span>
          </div>
          <label className="flex items-center gap-2">
            Max resolution
            <Select
              value={dpi}
              onChange={(e) => setDpi(Number(e.target.value))}
              aria-label="Target image resolution"
              className="h-7 w-36 px-2 text-xs"
            >
              <option value={72}>72 dpi (screen)</option>
              <option value={96}>96 dpi</option>
              <option value={150}>150 dpi (ebook)</option>
              <option value={200}>200 dpi</option>
              <option value={300}>300 dpi (print)</option>
            </Select>
          </label>
          <Button size="sm" className="gap-2" disabled={busy} onClick={() => void run()}>
            <Minimize2 className="h-3.5 w-3.5" />
            {busy ? "Compressing…" : "Compress document"}
          </Button>
        </div>
        <p className="pt-3 text-xs text-muted-foreground">
          Current size: {formatBytes(app.docBytes.length)}
        </p>
        {result && (
          <p className="pt-1 text-xs">
            {result.images === 0 ? (
              <span className="text-muted-foreground">
                No images needed recompression at these settings — the file is unchanged.
              </span>
            ) : (
              <span>
                Recompressed {result.images} image{result.images === 1 ? "" : "s"}:{" "}
                {formatBytes(result.before)} → <b>{formatBytes(result.after)}</b>{" "}
                ({result.after < result.before
                  ? `−${Math.round((1 - result.after / result.before) * 100)}%`
                  : "no gain"})
              </span>
            )}
          </p>
        )}
      </div>
      <div className="pt-5">
        <Button variant="outline" className="gap-2" onClick={() => void app.downloadCurrent()}>
          <Download className="h-4 w-4" /> Save PDF
        </Button>
      </div>
    </ToolShell>
  );
}

/* ---------------- Crop pages ---------------- */

export function CropScreen() {
  const app = useApp();
  const [previewPage, setPreviewPage] = useState(0);
  // Crop rectangle as fractions of the page (survives page switches / zoom).
  const [frac, setFrac] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [scope, setScope] = useState<"page" | "all" | "range">("all");
  const [range, setRange] = useState("");
  const [permanent, setPermanent] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "move" | "nw" | "ne" | "sw" | "se";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const pdf = app.pdf;
  const pageCount = app.numPages;
  const page = pdf && previewPage < pageCount ? pdf.page(previewPage) : null;
  const previewScale = page ? Math.min(480 / page.width, 560 / page.height) : 1;

  useEffect(() => {
    if (!pdf || !canvasRef.current || !page) return;
    void renderPageToCanvas(pdf, previewPage, canvasRef.current, previewScale);
  }, [pdf, previewPage, previewScale, app.docVersion, page]);

  if (!pdf || !app.docBytes || !page) {
    return (
      <ToolShell title="Crop pages" description="Trim page margins or cut a page down to a region.">
        <NeedsDocument />
      </ToolShell>
    );
  }

  const previewW = page.width * previewScale;
  const previewH = page.height * previewScale;

  const beginDrag = (e: React.PointerEvent, mode: "move" | "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, orig: { ...frac } };
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / previewW;
      const dy = (ev.clientY - d.startY) / previewH;
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      setFrac(() => {
        const o = d.orig;
        if (d.mode === "move") {
          return {
            ...o,
            x: clamp(o.x + dx, 0, 1 - o.w),
            y: clamp(o.y + dy, 0, 1 - o.h),
          };
        }
        let { x, y, w, h } = o;
        if (d.mode === "nw" || d.mode === "sw") {
          const nx = clamp(o.x + dx, 0, o.x + o.w - 0.05);
          w = o.w + (o.x - nx);
          x = nx;
        } else {
          w = clamp(o.w + dx, 0.05, 1 - o.x);
        }
        if (d.mode === "nw" || d.mode === "ne") {
          const ny = clamp(o.y + dy, 0, o.y + o.h - 0.05);
          h = o.h + (o.y - ny);
          y = ny;
        } else {
          h = clamp(o.h + dy, 0.05, 1 - o.y);
        }
        return { x, y, w, h };
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const apply = () => {
    const pageIndexes =
      scope === "page"
        ? [previewPage]
        : scope === "range"
          ? parsePageRanges(range, pageCount)
          : Array.from({ length: pageCount }, (_, i) => i);
    if (!pageIndexes.length) {
      toast.error(`Enter valid pages, e.g. "1-3, 5" (document has ${pageCount} pages)`);
      return;
    }
    // Fractions → display points of the previewed page (annotation space).
    const rect = {
      x: frac.x * page.width,
      y: frac.y * page.height,
      w: frac.w * page.width,
      h: frac.h * page.height,
    };
    void app.applyBytesOp(
      (b) => cropPages(b, pageIndexes, rect, permanent),
      `Cropped ${pageIndexes.length} page${pageIndexes.length === 1 ? "" : "s"}`,
    );
  };

  const handle = "absolute h-3 w-3 rounded-sm border border-white bg-blue-500";
  return (
    <ToolShell
      title="Crop pages"
      description="Drag the box over the area to keep, then apply it to this page, a range, or the whole document."
    >
      <div className="flex flex-wrap gap-6">
        <div className="relative select-none self-start rounded-lg border bg-card p-2 shadow-shell">
          <div className="relative" style={{ width: previewW, height: previewH }}>
            <canvas ref={canvasRef} className="absolute inset-0" />
            {/* dimmed outside area */}
            <div
              className="absolute inset-0"
              style={{
                background: "rgba(15, 23, 42, 0.45)",
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${frac.y * 100}%, ${frac.x * 100}% ${frac.y * 100}%, ${frac.x * 100}% ${(frac.y + frac.h) * 100}%, ${(frac.x + frac.w) * 100}% ${(frac.y + frac.h) * 100}%, ${(frac.x + frac.w) * 100}% ${frac.y * 100}%, 0 ${frac.y * 100}%)`,
              }}
            />
            <div
              ref={boxRef}
              className="absolute cursor-move border-2 border-blue-500"
              style={{
                left: frac.x * previewW,
                top: frac.y * previewH,
                width: frac.w * previewW,
                height: frac.h * previewH,
                touchAction: "none",
              }}
              onPointerDown={(e) => beginDrag(e, "move")}
            >
              <div className={cn(handle, "-left-1.5 -top-1.5 cursor-nwse-resize")} onPointerDown={(e) => beginDrag(e, "nw")} />
              <div className={cn(handle, "-right-1.5 -top-1.5 cursor-nesw-resize")} onPointerDown={(e) => beginDrag(e, "ne")} />
              <div className={cn(handle, "-bottom-1.5 -left-1.5 cursor-nesw-resize")} onPointerDown={(e) => beginDrag(e, "sw")} />
              <div className={cn(handle, "-bottom-1.5 -right-1.5 cursor-nwse-resize")} onPointerDown={(e) => beginDrag(e, "se")} />
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
            <IconBtn title="Previous page" disabled={previewPage === 0} onClick={() => setPreviewPage((p) => p - 1)}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </IconBtn>
            Page {previewPage + 1} / {pageCount}
            <IconBtn
              title="Next page"
              disabled={previewPage >= pageCount - 1}
              onClick={() => setPreviewPage((p) => p + 1)}
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </IconBtn>
          </div>
        </div>

        <div className="flex min-w-56 flex-1 flex-col gap-3">
          <div className="rounded-xl border bg-card p-4 text-sm shadow-shell">
            <p className="pb-2 font-medium">Apply to</p>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as "all" | "page" | "range")}
              className="text-xs"
            >
              <Radio value="all">All pages</Radio>
              <Radio value="page">This page only</Radio>
              <div className="flex items-center gap-2">
                <Radio value="range">Pages</Radio>
                <Input
                  value={range}
                  onChange={(e) => {
                    setRange(e.target.value);
                    setScope("range");
                  }}
                  placeholder={`e.g. 1-3, 5`}
                  className="h-7 w-32 px-2 text-xs"
                />
              </div>
            </RadioGroup>
            <label className="mt-3 flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Checkbox
                className="mt-0.5"
                checked={permanent}
                onCheckedChange={(v: boolean) => setPermanent(v)}
              />
              <span>
                Rewrite the page boundaries so all viewers show only the cropped area (content
                outside remains in the file either way — cropping never deletes it)
              </span>
            </label>
            <div className="pt-3">
              <Button className="gap-2" onClick={apply}>
                <Crop className="h-4 w-4" /> Apply crop
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Keeping {Math.round(frac.w * page.width)} × {Math.round(frac.h * page.height)} pt of{" "}
            {Math.round(page.width)} × {Math.round(page.height)} pt.
          </p>
        </div>
      </div>
    </ToolShell>
  );
}

/* ---------------- Headers & footers (+ Bates) ---------------- */

const HF_TOKEN_HINT = "Tokens: {page} {pages} {date} {bates}";

export function HeaderFooterScreen() {
  const app = useApp();
  const [slots, setSlots] = useState({
    headerLeft: "",
    headerCenter: "",
    headerRight: "",
    footerLeft: "",
    footerCenter: "{page} / {pages}",
    footerRight: "",
  });
  const [fontSize, setFontSize] = useState(10);
  const [color, setColor] = useState("#404040");
  const [margin, setMargin] = useState(24);
  const [sideMargin, setSideMargin] = useState(36);
  const [range, setRange] = useState("");
  const [batesOn, setBatesOn] = useState(false);
  const [batesPrefix, setBatesPrefix] = useState("");
  const [batesSuffix, setBatesSuffix] = useState("");
  const [batesStart, setBatesStart] = useState(1);
  const [batesDigits, setBatesDigits] = useState(6);

  if (!app.pdf || !app.docBytes) {
    return (
      <ToolShell title="Headers & footers" description="Stamp text, dates, page numbers and Bates numbers.">
        <NeedsDocument />
      </ToolShell>
    );
  }
  const pageCount = app.numPages;

  const apply = () => {
    const anyText = Object.values(slots).some((s) => s.trim());
    if (!anyText) {
      toast.error("Fill in at least one header or footer slot");
      return;
    }
    let pageIndexes: number[] | null = null;
    if (range.trim()) {
      pageIndexes = parsePageRanges(range, pageCount);
      if (!pageIndexes.length) {
        toast.error(`Enter valid pages, e.g. "1-3, 5" (document has ${pageCount} pages)`);
        return;
      }
    }
    let effective = { ...slots };
    if (batesOn && !Object.values(slots).some((s) => s.includes("{bates}"))) {
      // Bates on but no slot uses it — default it into the emptiest footer corner.
      const slot = !slots.footerRight.trim() ? "footerRight" : "footerLeft";
      effective = { ...effective, [slot]: "{bates}" };
    }
    void app.applyBytesOp(
      (b) =>
        addHeadersFooters(b, {
          slots: effective,
          fontSize,
          color,
          margin,
          sideMargin,
          pageIndexes,
          bates: batesOn
            ? { prefix: batesPrefix, suffix: batesSuffix, start: batesStart, digits: batesDigits }
            : undefined,
        }),
      "Headers / footers added",
    );
  };

  const slotInput = (key: keyof typeof slots, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        value={slots[key]}
        onChange={(e) => setSlots((s) => ({ ...s, [key]: e.target.value }))}
        className="h-8 px-2 text-xs"
        placeholder="—"
      />
    </label>
  );

  return (
    <ToolShell
      title="Headers & footers"
      description="Stamp up to six text slots on every page — free text plus {page}, {pages}, {date} and Bates {bates} tokens."
    >
      <div className="rounded-xl border bg-card p-4 shadow-shell">
        <p className="pb-2 text-sm font-medium">Header</p>
        <div className="grid grid-cols-3 gap-3">
          {slotInput("headerLeft", "Left")}
          {slotInput("headerCenter", "Center")}
          {slotInput("headerRight", "Right")}
        </div>
        <p className="pb-2 pt-4 text-sm font-medium">Footer</p>
        <div className="grid grid-cols-3 gap-3">
          {slotInput("footerLeft", "Left")}
          {slotInput("footerCenter", "Center")}
          {slotInput("footerRight", "Right")}
        </div>
        <p className="pt-2 text-[11px] text-muted-foreground">{HF_TOKEN_HINT}</p>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t pt-4 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Size
            <Select
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              aria-label="Font size"
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
            Color
            <ColorSwatch value={color} onChange={setColor} title="Text color" />
          </label>
          <label className="flex items-center gap-2">
            Top/bottom margin
            <Input
              type="number"
              value={margin}
              onChange={(e) => setMargin(Math.max(4, Number(e.target.value) || 24))}
              className="h-7 w-16 px-2 text-xs"
            />
            pt
          </label>
          <label className="flex items-center gap-2">
            Side margin
            <Input
              type="number"
              value={sideMargin}
              onChange={(e) => setSideMargin(Math.max(4, Number(e.target.value) || 36))}
              className="h-7 w-16 px-2 text-xs"
            />
            pt
          </label>
          <label className="flex items-center gap-2">
            Pages
            <Input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="all"
              className="h-7 w-28 px-2 text-xs"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4 shadow-shell">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox checked={batesOn} onCheckedChange={(v: boolean) => setBatesOn(v)} />
          Bates numbering
        </label>
        <p className="pb-3 pt-1 text-xs text-muted-foreground">
          A sequential stamp (e.g. ACME-000001) advancing on every stamped page. Placed where a
          slot contains {"{bates}"} — or in a free footer corner automatically.
        </p>
        {batesOn && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              Prefix
              <Input
                value={batesPrefix}
                onChange={(e) => setBatesPrefix(e.target.value)}
                placeholder="ACME-"
                className="h-7 w-24 px-2 text-xs"
              />
            </label>
            <label className="flex items-center gap-2">
              Start at
              <Input
                type="number"
                min={0}
                value={batesStart}
                onChange={(e) => setBatesStart(Math.max(0, Number(e.target.value) || 0))}
                className="h-7 w-20 px-2 text-xs"
              />
            </label>
            <label className="flex items-center gap-2">
              Digits
              <Select
                value={batesDigits}
                onChange={(e) => setBatesDigits(Number(e.target.value))}
                aria-label="Bates digits"
                className="h-7 w-16 px-2 text-xs"
              >
                {[4, 5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2">
              Suffix
              <Input
                value={batesSuffix}
                onChange={(e) => setBatesSuffix(e.target.value)}
                className="h-7 w-24 px-2 text-xs"
              />
            </label>
            <span>
              Preview:{" "}
              <b className="text-foreground">
                {batesPrefix}
                {String(batesStart).padStart(batesDigits, "0")}
                {batesSuffix}
              </b>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-5">
        <Button onClick={apply}>Apply to document</Button>
        <Button variant="outline" className="gap-2" onClick={() => void app.downloadCurrent()}>
          <Download className="h-4 w-4" /> Save PDF
        </Button>
      </div>
    </ToolShell>
  );
}

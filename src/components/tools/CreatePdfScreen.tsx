import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  FileText,
  ImagePlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn, downloadBytes, formatBytes } from "../../lib/utils";
import { imagesToPdf, type ImagePageSize } from "../../lib/pdftools";
import { docxToPdf, textFileToPdf } from "../../lib/createpdf";
import { Tip } from "../ui/tooltip";

interface ImageEntry {
  name: string;
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  /** Object URL for the thumbnail; revoked on removal/unmount. */
  url: string;
}

const isDocxName = (name: string) => /\.docx$/i.test(name);
const isTextName = (name: string) => /\.(txt|md|markdown)$/i.test(name);

/**
 * Create a new PDF from other file types, split into two dedicated tools:
 * PNG/JPEG images (one page each, with a page-sizing choice) and a basic
 * .docx / plain-text conversion typeset with Helvetica. The result opens as
 * a new document tab.
 */
export function ImagesToPdfScreen() {
  return <CreatePdfBase mode="images" />;
}

export function DocToPdfScreen() {
  return <CreatePdfBase mode="doc" />;
}

function CreatePdfBase({ mode }: { mode: "images" | "doc" }) {
  const app = useApp();
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [pageSize, setPageSize] = useState<ImagePageSize>("fit");
  const [busy, setBusy] = useState<null | "images" | "doc">(null);
  const [dragOver, setDragOver] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Revoke all thumbnail URLs on unmount only — `images` is intentionally not
  // a dependency (per-entry revocation happens in removeImage).
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(
    () => () => {
      for (const img of imagesRef.current) URL.revokeObjectURL(img.url);
    },
    [],
  );

  const addImages = async (files: File[]) => {
    const next: ImageEntry[] = [];
    for (const f of files) {
      const type =
        f.type === "image/png" ? "image/png" : f.type === "image/jpeg" ? "image/jpeg" : null;
      if (!type) continue;
      next.push({
        name: f.name,
        bytes: new Uint8Array(await f.arrayBuffer()),
        type,
        url: URL.createObjectURL(f),
      });
    }
    if (next.length) setImages((prev) => [...prev, ...next]);
  };

  const removeImage = (i: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
  };

  const moveImage = (i: number, dir: -1 | 1) => {
    setImages((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const outputName = () => {
    if (images.length === 1) return images[0].name.replace(/\.(png|jpe?g)$/i, "") + ".pdf";
    return "images.pdf";
  };

  const createFromImages = async (openAfter: boolean) => {
    if (!images.length) return;
    setBusy("images");
    try {
      const bytes = await imagesToPdf(images, pageSize);
      if (openAfter) {
        await app.openBytes(bytes, outputName());
        toast.success(`Created a ${images.length}-page PDF`);
      } else {
        downloadBytes(bytes, outputName());
        toast.success("PDF downloaded");
      }
    } catch (err) {
      toast.error(`Could not create the PDF: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  };

  const convertDocument = async (file: File) => {
    setBusy("doc");
    try {
      const bytes = isDocxName(file.name)
        ? await docxToPdf(await file.arrayBuffer())
        : await textFileToPdf(await file.text());
      await app.openBytes(bytes, file.name.replace(/\.[^.]+$/, "") + ".pdf");
      toast.success(`Converted ${file.name}`);
    } catch (err) {
      toast.error(
        `Could not convert ${file.name}: ${err instanceof Error ? err.message : "unreadable file"}`,
      );
    } finally {
      setBusy(null);
    }
  };

  // Screen-wide drop, scoped to this tool's input type: images stack up in
  // the list, a document converts immediately, anything else gets a pointer.
  const onDrop = async (files: File[]) => {
    if (mode === "images") {
      const imgs = files.filter((f) => f.type === "image/png" || f.type === "image/jpeg");
      if (imgs.length) await addImages(imgs);
      else toast.error("Drop PNG or JPEG images (PDFs open via File → Open)");
      return;
    }
    const doc = files.find((f) => isDocxName(f.name) || isTextName(f.name));
    if (doc) await convertDocument(doc);
    else toast.error("Drop a .docx or .txt file (PDFs open via File → Open)");
  };

  return (
    <div
      className="scrollbar-soft h-full overflow-y-auto p-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void onDrop(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">
          {mode === "images" ? "Images to PDF" : "Word or text to PDF"}
        </h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          {mode === "images"
            ? "Build a new PDF from PNG or JPEG images. Everything is converted locally — files never leave this device."
            : "Convert a Word document or plain text into a PDF. Everything is converted locally — files never leave this device."}
        </p>

        {mode === "images" && (
        <div
          className={cn(
            "rounded-xl border bg-card p-4 shadow-shell transition-colors",
            dragOver && "border-blue-500 ring-1 ring-blue-500/50",
          )}
        >
          <p className="text-sm font-medium">Images to PDF</p>
          <p className="pb-3 pt-1 text-xs text-muted-foreground">
            Each PNG or JPEG becomes one page, in the order listed. Drag files anywhere onto this
            screen or use the button below.
          </p>

          {images.length > 0 && (
            <div className="flex flex-col gap-2 pb-3">
              {images.map((img, i) => (
                <div
                  key={img.url}
                  className="flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm"
                >
                  <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                  <img
                    src={img.url}
                    alt=""
                    className="h-12 w-12 rounded border bg-white object-contain"
                  />
                  <span className="min-w-0 flex-1 truncate">{img.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(img.bytes.length)}
                  </span>
                  <Tip label="Move up"><Button
                    variant="ghost"
                    size="icon"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveImage(i, -1)}
                    className="h-6 w-6 rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button></Tip>
                  <Tip label="Move down"><Button
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    disabled={i === images.length - 1}
                    onClick={() => moveImage(i, 1)}
                    className="h-6 w-6 rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button></Tip>
                  <Tip label="Remove"><Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    onClick={() => removeImage(i)}
                    className="h-6 w-6 rounded text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button></Tip>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" /> Add images
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Page size
              <Select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as ImagePageSize)}
                aria-label="Page size"
                className="h-8 w-44 px-2 text-xs"
              >
                <option value="fit">Fit page to image</option>
                <option value="a4">A4 (portrait)</option>
                <option value="letter">Letter (portrait)</option>
              </Select>
            </label>
            <Button
              disabled={!!busy || images.length === 0}
              className="gap-2"
              onClick={() => void createFromImages(true)}
            >
              <FilePlus2 className="h-4 w-4" />
              {busy === "images" ? "Creating…" : "Create & open"}
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy || images.length === 0}
              className="gap-2"
              onClick={() => void createFromImages(false)}
            >
              <Download className="h-4 w-4" /> Download
            </Button>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            className="hidden"
            onChange={(e) => {
              void addImages(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        )}

        {mode === "doc" && (
        <div
          className={cn(
            "rounded-xl border bg-card p-4 shadow-shell transition-colors",
            dragOver && "border-blue-500 ring-1 ring-blue-500/50",
          )}
        >
          <p className="text-sm font-medium">Word or text document to PDF</p>
          <p className="pb-3 pt-1 text-xs text-muted-foreground">
            Basic conversion for .docx and .txt files: headings, paragraphs, bold/italic and
            lists are kept. Complex layout — tables, images, columns, fonts — is not preserved.
            Drop a file anywhere on this screen or use the button below.
          </p>
          <Button
            variant="outline"
            disabled={!!busy}
            className="gap-2"
            onClick={() => docInputRef.current?.click()}
          >
            <FileText className="h-4 w-4" />
            {busy === "doc" ? "Converting…" : "Choose .docx or .txt file"}
          </Button>
          <input
            ref={docInputRef}
            type="file"
            accept=".docx,.txt,.md,.markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void convertDocument(f);
            }}
          />
        </div>
        )}
      </div>
    </div>
  );
}

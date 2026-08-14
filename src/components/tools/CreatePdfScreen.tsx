import { useEffect, useRef, useState } from "react";
import {
  Download,
  FilePlus2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn, downloadBytes, formatBytes } from "../../lib/utils";
import { imagesToPdf, type ImagePageSize } from "../../lib/pdftools";
import { docxToPdf, textFileToPdf } from "../../lib/createpdf";
import { isJpegFile, isPngFile, useToolFileDrop } from "./useToolFileDrop";
import {
  FileCollectionView,
  FileCollectionViewToggle,
  type FileCollectionViewMode,
} from "./FileCollectionView";
import { ToolPageContainer, ToolPageHeader } from "./ToolPageHeader";
import { ToolFileSidebar, ToolSidebarPortal } from "./ToolFileSidebar";

interface ImageEntry {
  id: string;
  name: string;
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  /** Object URL for the thumbnail; revoked on removal/unmount. */
  url: string;
}

let imageEntrySequence = 0;
const nextImageEntryId = () => `image-file-${++imageEntrySequence}`;

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
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [collectionView, setCollectionView] = useState<FileCollectionViewMode>("grid");
  const [pageSize, setPageSize] = useState<ImagePageSize>("fit");
  const [busy, setBusy] = useState<null | "images" | "doc">(null);
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
        isPngFile(f) ? "image/png" : isJpegFile(f) ? "image/jpeg" : null;
      if (!type) continue;
      next.push({
        id: nextImageEntryId(),
        name: f.name,
        bytes: new Uint8Array(await f.arrayBuffer()),
        type,
        url: URL.createObjectURL(f),
      });
    }
    if (next.length) {
      setImages((prev) => [...prev, ...next]);
      setSelectedImageId((current) => current ?? next[0].id);
    }
  };

  const removeImage = (i: number) => {
    const removedId = images[i]?.id;
    if (removedId && removedId === selectedImageId) {
      setSelectedImageId(images[i + 1]?.id ?? images[i - 1]?.id ?? null);
    }
    setImages((prev) => {
      if (prev[i]) URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
  };

  const reorderImage = (from: number, to: number) => {
    setImages((prev) => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const duplicateImage = (index: number) => {
    setImages((prev) => {
      const source = prev[index];
      if (!source) return prev;
      const copy: ImageEntry = {
        ...source,
        id: nextImageEntryId(),
        url: URL.createObjectURL(
          new Blob([source.bytes.slice().buffer as ArrayBuffer], { type: source.type }),
        ),
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
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
      const imgs = files.filter((f) => isPngFile(f) || isJpegFile(f));
      if (imgs.length) await addImages(imgs);
      else toast.error("Images to PDF accepts PNG and JPEG files");
      return;
    }
    const doc = files.find((f) => isDocxName(f.name) || isTextName(f.name));
    if (doc) await convertDocument(doc);
    else toast.error("Word or text to PDF accepts .docx, .txt, and .md files");
  };
  const { dragOver, dropHandlers } = useToolFileDrop(onDrop);
  const getImageMeta = (image: ImageEntry) =>
    `${formatBytes(image.bytes.length)} · ${image.type === "image/png" ? "PNG" : "JPEG"}`;

  return (
    <div
      {...dropHandlers}
      data-testid="tool-drop-surface"
      className="scrollbar-soft h-full overflow-y-auto p-6"
    >
      {mode === "images" && (
        <ToolSidebarPortal>
          <ToolFileSidebar
            items={images}
            getKey={(image) => image.id}
            getName={(image) => image.name}
            getMeta={getImageMeta}
            emptyText="No images yet. Add or drop PNG and JPEG files to begin."
            addLabel="Add images"
            onAdd={() => imageInputRef.current?.click()}
            onReorder={reorderImage}
            onDuplicate={duplicateImage}
            onRemove={removeImage}
            selectedKey={selectedImageId}
            onSelect={(image) => setSelectedImageId(image.id)}
          />
        </ToolSidebarPortal>
      )}
      <ToolPageContainer width={mode === "images" ? "full" : "standard"}>
        <ToolPageHeader
          title={mode === "images" ? "Images to PDF" : "Word or text to PDF"}
          description={
            mode === "images"
              ? "Build a new PDF from PNG or JPEG images. Everything is converted locally — files never leave this device."
              : "Convert a Word document or plain text into a PDF. Everything is converted locally — files never leave this device."
          }
          actions={
            mode === "images" && images.length > 0 ? (
              <>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Page size
                  <Select
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value as ImagePageSize)}
                    aria-label="Page size"
                    className="h-7 w-36 px-2 text-xs"
                  >
                    <option value="fit">Fit to image</option>
                    <option value="a4">A4 portrait</option>
                    <option value="letter">Letter portrait</option>
                  </Select>
                </label>
                <FileCollectionViewToggle
                  value={collectionView}
                  onValueChange={setCollectionView}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  className="h-7 gap-1.5"
                  onClick={() => void createFromImages(false)}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
                <Button
                  size="sm"
                  disabled={!!busy}
                  className="h-7 gap-1.5"
                  onClick={() => void createFromImages(true)}
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  {busy === "images" ? "Creating…" : "Create & open"}
                </Button>
              </>
            ) : undefined
          }
          showIntro={mode !== "images"}
        />

        {mode === "images" && (
        <div
          className={cn(
            "rounded-xl border bg-card p-4 shadow-shell transition-colors",
            dragOver && "border-blue-500 ring-1 ring-blue-500/50",
          )}
        >
          <FileCollectionView
            items={images}
            view={collectionView}
            getKey={(image) => image.id}
            getName={(image) => image.name}
            getMeta={getImageMeta}
            renderPreview={(image) => (
              <img
                src={image.url}
                alt=""
                className="max-h-full max-w-full rounded object-contain"
              />
            )}
            emptyTitle="Drop images here"
            emptyDescription="Add multiple PNG or JPEG files. Each image becomes one PDF page."
            emptyActionLabel="Choose images"
            addMoreLabel="Add more images"
            onEmptyAction={() => imageInputRef.current?.click()}
            onReorder={reorderImage}
            onDuplicate={duplicateImage}
            onRemove={removeImage}
            selectedKey={selectedImageId}
            onSelect={(image) => setSelectedImageId(image.id)}
          />

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
      </ToolPageContainer>
    </div>
  );
}

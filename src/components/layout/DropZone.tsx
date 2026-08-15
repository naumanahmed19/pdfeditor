import { memo, useEffect } from "react";
import { toast } from "sonner";
import { useAppSelector } from "../../store";

const isPdf = (file: File) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/**
 * Global drag-and-drop target: dropping PDF files anywhere in the window opens
 * them — no overlay, for a seamless feel. Uses HTML5 drag-and-drop, which fires
 * in both the browser and the Tauri desktop shell — the latter only because the
 * window is configured with `dragDropEnabled: false`, so the OS webview no
 * longer swallows file drops.
 */
// Memoized: no props; ignores parent re-renders (only subscribes to openFile).
export const DropZone = memo(DropZoneImpl);

function DropZoneImpl() {
  // Only needs the openFile action — select it so the drop target never
  // re-renders on unrelated store churn.
  const openFile = useAppSelector((s) => s.openFile);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Required so the browser treats this as a valid drop target.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Tool screens consume their own drops. Do not open the same file again
      // through this window-level fallback.
      if (e.defaultPrevented) return;
      e.preventDefault();

      const files = Array.from(e.dataTransfer?.files ?? []);
      // Capture handles synchronously; Chromium clears DataTransfer.items as
      // soon as the event handler yields.
      const handlePromises = Array.from(e.dataTransfer?.items ?? []).map(
        (item) => (item as any).getAsFileSystemHandle?.() ?? null,
      );
      const pdfs = files.flatMap((file, index) =>
        isPdf(file) ? [{ file, index }] : [],
      );
      const skipped = files.length - pdfs.length;
      if (skipped > 0) {
        toast.error(
          skipped === files.length
            ? "Only PDF files can be opened here"
            : `Skipped ${skipped} non-PDF file${skipped > 1 ? "s" : ""}`,
        );
      }
      void (async () => {
        const handles = await Promise.all(handlePromises);
        for (const { file, index } of pdfs) {
          const handle = handles[index];
          await openFile(file, handle?.kind === "file" ? handle : undefined);
        }
      })();
    };

    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFile]);

  return null;
}

import { useEffect } from "react";
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
export function DropZone() {
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
      e.preventDefault();

      const files = Array.from(e.dataTransfer?.files ?? []);
      const pdfs = files.filter(isPdf);
      const skipped = files.length - pdfs.length;
      if (skipped > 0) {
        toast.error(
          skipped === files.length
            ? "Only PDF files can be opened here"
            : `Skipped ${skipped} non-PDF file${skipped > 1 ? "s" : ""}`,
        );
      }
      void (async () => {
        for (const f of pdfs) await openFile(f);
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

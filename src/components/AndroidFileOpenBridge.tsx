import { useEffect } from "react";
import { toast } from "sonner";
import { isTauriAndroid } from "../lib/tauri";
import { useAppSelector } from "../store";

function fileNameFromUri(uri: string, index: number): string {
  try {
    const decoded = decodeURIComponent(uri);
    const candidate = decoded.split(/[/:\\]/).filter(Boolean).pop()?.trim();
    if (candidate) return /\.pdf$/i.test(candidate) ? candidate : `${candidate}.pdf`;
  } catch {
    // Fall through to a stable generic name.
  }
  return `document-${index + 1}.pdf`;
}

export function AndroidFileOpenBridge() {
  const openFile = useAppSelector((app) => app.openFile);

  useEffect(() => {
    if (!isTauriAndroid) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const seen = new Set<string>();

    const openUris = async (payload: unknown) => {
      if (!Array.isArray(payload)) return;
      const uris = payload.filter(
        (value): value is string => typeof value === "string" && !seen.has(value),
      );
      if (!uris.length) return;

      const { readFile } = await import("@tauri-apps/plugin-fs");
      for (const [index, uri] of uris.entries()) {
        seen.add(uri);
        try {
          const bytes = Uint8Array.from(await readFile(uri));
          const file = new File([bytes.buffer], fileNameFromUri(uri, index), {
            type: "application/pdf",
          });
          await openFile(file);
        } catch (error) {
          toast.error("Could not open the shared PDF", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    const start = async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);
      unlisten = await listen<string[]>("pickpdf:opened", (event) => {
        if (!disposed) void openUris(event.payload);
      });
      const initial = await invoke<string[]>("take_opened_urls");
      if (!disposed) await openUris(initial);
    };

    void start().catch((error) => {
      console.error("Could not initialize Android PDF handoff", error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openFile]);

  return null;
}

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppSelector } from "../store";
import {
  fallbackToChromePdfViewer,
  readChromePdfStream,
} from "../lib/chromeExtension";

/** Opens the one-shot stream when Chrome loaded PickPDF as its PDF handler. */
export function ChromeExtensionBridge() {
  const openBytes = useAppSelector((store) => store.openBytes);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const stream = await readChromePdfStream();
        if (!stream || cancelled) return;
        document.title = `${stream.name} — PickPDF`;
        const opened = await openBytes(stream.bytes, stream.name);
        if (!opened && !cancelled) await fallbackToChromePdfViewer();
      } catch (error) {
        if (cancelled) return;
        toast.error("Could not open Chrome's PDF stream", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
        await fallbackToChromePdfViewer();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openBytes]);

  return null;
}

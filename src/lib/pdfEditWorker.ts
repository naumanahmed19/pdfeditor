import type { PdfEditOperation } from "./pdfEditTypes";

interface PendingEdit {
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingEdit>();

function failWorker(error: Error): void {
  const failed = [...pending.values()];
  pending.clear();
  worker?.terminate();
  worker = null;
  for (const request of failed) request.reject(error);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./pdfEdit.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data ?? {};
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(new Uint8Array(data.bytes));
  });
  worker.addEventListener("error", (event: ErrorEvent) => {
    failWorker(new Error(event.message || "The PDF edit worker stopped unexpectedly."));
  });
  return worker;
}

/** Run the expensive PDFium page regeneration away from the UI thread. */
export async function editPdfInBackground(
  bytes: Uint8Array,
  operation: PdfEditOperation,
): Promise<Uint8Array> {
  return editPdfsInBackground(bytes, [operation]);
}

/** Run an edit journal in one worker request. Object mutations are batched into
 * a single page regeneration by the worker-side executor. */
export async function editPdfsInBackground(
  bytes: Uint8Array,
  operations: readonly PdfEditOperation[],
): Promise<Uint8Array> {
  if (!operations.length) return bytes;
  // Vitest/headless callers have no Worker global. The production browser and
  // Tauri webview always take the background path.
  if (typeof Worker === "undefined") {
    const { executePdfEdits } = await import("./pdfEditOperation");
    return executePdfEdits(bytes, operations);
  }

  const requestId = nextRequestId++;
  // Never transfer the store's live byte array: transferring detaches it and
  // would corrupt undo/history while the worker is running.
  const copy = bytes.slice();
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    try {
      getWorker().postMessage(
        { id: requestId, bytes: copy, operations },
        [copy.buffer as ArrayBuffer],
      );
    } catch (error) {
      pending.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Primarily for teardown after a worker crash or in tests. */
export function resetPdfEditWorker(): void {
  failWorker(new Error("PDF edit worker reset."));
}

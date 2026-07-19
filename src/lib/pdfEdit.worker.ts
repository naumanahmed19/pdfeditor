import { executePdfEdits } from "./pdfEditOperation";
import type { PdfEditOperation } from "./pdfEditTypes";

interface EditRequest {
  id: number;
  bytes: Uint8Array;
  operations: PdfEditOperation[];
}

const workerScope = self as unknown as Worker;

// PDFium owns one WASM module inside this worker. Keep mutations serialized so
// two documents can never enter the shared module at the same time.
let queue: Promise<void> = Promise.resolve();

workerScope.addEventListener("message", (event: MessageEvent<EditRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const result = await executePdfEdits(request.bytes, request.operations);
      const output =
        result.byteOffset === 0 && result.byteLength === result.buffer.byteLength
          ? result
          : result.slice();
      workerScope.postMessage(
        { id: request.id, bytes: output },
        [output.buffer as ArrayBuffer],
      );
    } catch (error) {
      workerScope.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

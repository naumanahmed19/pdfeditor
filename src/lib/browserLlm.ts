// Zero-config, fully local AI: Google's Gemma 4 (E2B) running in the browser via
// Transformers.js. No Ollama / LM Studio / API key needed. The model (ONNX)
// downloads once from the Hugging Face hub and is cached; it then works offline.
//
// Generation runs in a dedicated Web Worker (browserLlm.worker.ts) so the heavy
// GPU/CPU work never blocks the UI, and it picks WebGPU when available with an
// automatic CPU (WASM) fallback for machines without a GPU.
import type { ChatMessage } from "../types";

export const BROWSER_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
export const BROWSER_MODEL_LABEL = "Gemma 4 (in-browser)";

/** WebGPU gives the fast path; without it we still run on CPU (WASM), just slower. */
export function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

let worker: Worker | null = null;
let ready = false;

export function browserModelReady(): boolean {
  return ready;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./browserLlm.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/** Drop the worker so the next call reloads (after a GPU crash / OOM). */
export function resetBrowserEngine(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  ready = false;
}

/** Turn a raw WebGPU/ORT failure into an actionable message. */
function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/device is lost|out of memory|mapasync|failed to allocate|oom/i.test(raw)) {
    return new Error(
      "The GPU ran out of memory running Gemma 4. Try again — it should fall back to CPU — or use a local server (Ollama, LM Studio) in Settings.",
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

/** Gemma's chat template accepts system/user/assistant turns directly. */
function toChat(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function fmtBytes(b: number): string {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
}

/** How long without a progress event before we call the download stalled. */
const STALL_MS = 25_000;

/** Stream a chat completion from the in-browser Gemma 4 model (via the worker). */
export function streamBrowserChat(
  messages: ChatMessage[],
  temperature: number,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<string> {
  const w = getWorker();

  return new Promise<string>((resolve, reject) => {
    let full = "";
    let firstToken = true;
    // No status text unless there's something to say (download progress,
    // stalls) — an empty status keeps the chat bubble on its typing dots,
    // consistent with the other providers.
    let genTimer: ReturnType<typeof setTimeout> | undefined;

    // If progress events stop arriving mid-download, say so instead of
    // leaving a frozen percentage on screen.
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let lastDownloadStatus = "";
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        onStatus?.(
          `${lastDownloadStatus} — connection looks stalled. Check your network; finished parts are cached, so Stop + retry resumes quickly.`,
        );
      }, STALL_MS);
    };

    const onMessage = (e: MessageEvent) => {
      const d = e.data || {};
      switch (d.type) {
        case "progress": {
          const loaded = d.loaded ?? 0;
          const total = d.total ?? 0;
          const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          lastDownloadStatus = total
            ? `Downloading Gemma 4 — ${pct}% (${fmtBytes(loaded)} of ${fmtBytes(total)})`
            : `Downloading Gemma 4 — ${fmtBytes(loaded)}…`;
          onStatus?.(`${lastDownloadStatus} · one-time, then cached`);
          armStallTimer();
          break;
        }
        case "status":
          clearTimeout(stallTimer);
          onStatus?.(d.text ?? "");
          break;
        case "ready":
          clearTimeout(stallTimer);
          ready = true;
          // Back to the typing dots; if the first token is slow (prefill /
          // shader warm-up), explain rather than sit silent.
          onStatus?.("");
          clearTimeout(genTimer);
          genTimer = setTimeout(() => {
            if (firstToken) {
              onStatus?.(
                "Still working — the first response after loading the model can take a while…",
              );
            }
          }, 30_000);
          break;
        case "token":
          if (firstToken) {
            firstToken = false;
            clearTimeout(genTimer);
            onStatus?.("");
          }
          full += d.delta ?? "";
          onToken(d.delta ?? "");
          break;
        case "done":
        case "stopped":
          cleanup();
          resolve(full);
          break;
        case "error":
          cleanup();
          resetBrowserEngine();
          if (!full) reject(friendlyError(new Error(d.message)));
          else resolve(full);
          break;
      }
    };

    const onAbort = () => w.postMessage({ type: "stop" });
    const cleanup = () => {
      clearTimeout(stallTimer);
      clearTimeout(genTimer);
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };

    w.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    w.postMessage({
      type: "generate",
      messages: toChat(messages),
      temperature,
      maxTokens: 512,
    });
  });
}

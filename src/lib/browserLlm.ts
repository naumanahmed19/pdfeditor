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

/** Stream a chat completion from the in-browser Gemma 4 model (via the worker). */
export function streamBrowserChat(
  messages: ChatMessage[],
  temperature: number,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<string> {
  const w = getWorker();
  onStatus?.("Preparing the in-browser model…");

  return new Promise<string>((resolve, reject) => {
    let full = "";
    let firstToken = true;

    const onMessage = (e: MessageEvent) => {
      const d = e.data || {};
      switch (d.type) {
        case "progress":
          onStatus?.(
            `Downloading Gemma 4 — ${Math.round(d.progress ?? 0)}% (one-time, then cached)`,
          );
          break;
        case "status":
          onStatus?.(d.text ?? "");
          break;
        case "ready":
          ready = true;
          onStatus?.("Generating…");
          break;
        case "token":
          if (firstToken) {
            firstToken = false;
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

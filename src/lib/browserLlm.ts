// Zero-config, fully local AI running in the browser via Transformers.js. No
// Ollama / LM Studio / API key needed. The chosen model (ONNX) downloads once
// from the Hugging Face hub and is cached; it then works offline. Which model
// runs is decided by the caller (see ./modelConfig) — desktop can pick the
// higher-quality Gemma 4, while phones/tablets are pinned to the lightweight
// Qwen2.5 that fits a mobile memory budget.
//
// Generation runs in a dedicated Web Worker (browserLlm.worker.ts) so the heavy
// GPU/CPU work never blocks the UI, and it picks WebGPU when available with an
// automatic CPU (WASM) fallback for machines without a GPU.
import type { ChatMessage } from "../types";
import type { BrowserModelConfig } from "./modelConfig";
import { isHandheldDevice } from "./device";

// IndexedDB database that ./modelCache streams the download into. Duplicated here
// (rather than imported) because importing ./modelCache would run its fetch patch
// on the main thread — it must only patch the worker.
const MODEL_CACHE_DB = "pickpdf-model-cache";
// Sticky per-model flag: this model finished downloading at least once, so it's
// on disk and loads offline. Keyed by model id so each model tracks separately
// (both can be cached at once). Survives reloads, unlike the session state below.
const DOWNLOADED_PREFIX = "pickpdf-model-downloaded:";
const downloadedKey = (id: string) => `${DOWNLOADED_PREFIX}${id}`;

function markDownloaded(id: string): void {
  try {
    localStorage.setItem(downloadedKey(id), "1");
  } catch {
    /* storage unavailable — status just won't persist across reloads */
  }
}

/** Has this model been fully downloaded before (so it should load without network)? */
export function isBrowserModelDownloaded(id: string): boolean {
  try {
    return localStorage.getItem(downloadedKey(id)) === "1";
  } catch {
    return false;
  }
}

/** WebGPU gives the fast path; without it we still run on CPU (WASM), just slower. */
export function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

let worker: Worker | null = null;
// The model the worker is currently serving, so we know when to reload.
let activeModel: BrowserModelConfig | null = null;
// Which model finished loading this session (in-memory, ready to generate now).
let readyModelId: string | null = null;

/** Is the given model loaded and ready to generate in this session? */
export function browserModelReady(id: string): boolean {
  return readyModelId === id;
}

// Ask the browser to keep the cached model on disk. Best-effort storage can be
// evicted under disk pressure (and Safari wipes it after 7 idle days); a granted
// persistence request exempts the origin from both, so the download stays put
// between visits. Fire once, and never block on it.
let persistenceRequested = false;
function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  void navigator.storage?.persist?.().catch(() => {
    /* unsupported or denied — the cache still works, just evictable */
  });
}

function getWorker(): Worker {
  if (!worker) {
    requestPersistentStorage();
    worker = new Worker(new URL("./browserLlm.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/** Drop the worker so the next call reloads (after a GPU crash / OOM / model switch). */
export function resetBrowserEngine(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  readyModelId = null;
}

/** Point the engine at a model, dropping the worker if it was running a different one. */
function ensureModel(model: BrowserModelConfig): void {
  if (activeModel && activeModel.id !== model.id) resetBrowserEngine();
  activeModel = model;
}

function modelName(): string {
  return activeModel?.name ?? "the model";
}

/** Turn a raw WebGPU/ORT failure into an actionable message. */
function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/device is lost|out of memory|mapasync|failed to allocate|oom/i.test(raw)) {
    return new Error(
      `The GPU ran out of memory running ${modelName()}. Try again — it should fall back to CPU — pick a lighter model, or connect a local/remote server in Settings.`,
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

/** The chat template accepts system/user/assistant turns directly. */
function toChat(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function fmtBytes(b: number): string {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
}

/** Percentage of a download, or null while the total size is still unknown. */
function pctOf(loaded: number, total: number): number | null {
  return total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
}

function downloadStatusText(loaded: number, total: number): string {
  const pct = pctOf(loaded, total);
  return pct !== null
    ? `Downloading ${modelName()} — ${pct}% (${fmtBytes(loaded)} of ${fmtBytes(total)})`
    : `Downloading ${modelName()} — ${fmtBytes(loaded)}…`;
}

/** How long without a progress event before we call the download stalled. */
const STALL_MS = 25_000;

/** Stream a chat completion from the given in-browser model (via the worker). */
export function streamBrowserChat(
  model: BrowserModelConfig,
  messages: ChatMessage[],
  temperature: number,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<string> {
  ensureModel(model);
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
          lastDownloadStatus = downloadStatusText(d.loaded ?? 0, d.total ?? 0);
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
          readyModelId = model.id;
          markDownloaded(model.id);
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
      model,
      // Phones/tablets run on CPU — mobile WebGPU has proven unreliable.
      forceCpu: isHandheldDevice(),
      messages: toChat(messages),
      temperature,
      maxTokens: 512,
    });
  });
}

export interface ModelLoadProgress {
  /** "downloading" while bytes stream in, "preparing" during load/compile. */
  phase: "downloading" | "preparing";
  text: string;
  /** 0–100 when the size is known, else null (indeterminate). */
  pct: number | null;
}

/**
 * Download and load a model without sending a chat message, reporting progress
 * — so Settings can offer a "Download" button with a real progress bar. Resolves
 * once the model is ready; rejects on failure or when `signal` aborts. Aborting
 * terminates the worker, but finished chunks stay cached so a later run resumes.
 */
export function preloadBrowserModel(
  model: BrowserModelConfig,
  onProgress: (p: ModelLoadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  ensureModel(model);
  const w = getWorker();

  return new Promise<void>((resolve, reject) => {
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let lastText = "";
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        onProgress({
          phase: "downloading",
          text: `${lastText} — connection looks stalled. Finished parts are cached, so this resumes if you retry.`,
          pct: null,
        });
      }, STALL_MS);
    };

    const cleanup = () => {
      clearTimeout(stallTimer);
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      // No clean cancel for a load in progress — drop the worker. The resumable
      // cache keeps whatever was downloaded so far.
      resetBrowserEngine();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const onMessage = (e: MessageEvent) => {
      const d = e.data || {};
      switch (d.type) {
        case "progress":
          lastText = downloadStatusText(d.loaded ?? 0, d.total ?? 0);
          onProgress({ phase: "downloading", text: lastText, pct: pctOf(d.loaded ?? 0, d.total ?? 0) });
          armStallTimer();
          break;
        case "status":
          clearTimeout(stallTimer);
          onProgress({ phase: "preparing", text: d.text ?? "Preparing the model…", pct: null });
          break;
        case "ready":
          cleanup();
          readyModelId = model.id;
          markDownloaded(model.id);
          resolve();
          break;
        case "error":
          cleanup();
          resetBrowserEngine();
          reject(friendlyError(new Error(d.message)));
          break;
      }
    };

    if (signal?.aborted) return onAbort();
    w.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    w.postMessage({ type: "load", model, forceCpu: isHandheldDevice() });
  });
}

/**
 * Wipe the cached model weights so the next run downloads fresh — the escape
 * hatch for a corrupted or unwanted download. The cache is a single shared
 * IndexedDB store keyed by URL, so this clears every downloaded model at once;
 * we also reset all per-model "downloaded" flags to match. Terminates the worker
 * first to release its IndexedDB handle so the delete isn't blocked.
 */
export function clearBrowserModelCache(): Promise<void> {
  resetBrowserEngine();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DOWNLOADED_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const req = indexedDB.deleteDatabase(MODEL_CACHE_DB);
    req.onsuccess = finish;
    req.onerror = finish;
    // A stray open handle can leave the delete "blocked"; don't hang the UI.
    req.onblocked = finish;
    setTimeout(finish, 3000);
  });
}

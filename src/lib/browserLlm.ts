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
import {
  EDITOR_TOOL_DEFINITIONS,
  editorToolMessages,
  parseEditorToolCall,
  type EditorToolCall,
} from "./aiTools";

// IndexedDB database that ./modelCache streams the download into. Duplicated here
// (rather than imported) because importing ./modelCache would run its fetch patch
// on the main thread — it must only patch the worker.
const MODEL_CACHE_DB = "pickpdf-model-cache";
const MODEL_CACHE_META_STORE = "meta";
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
let requestSequence = 0;
const pendingOperations = new Map<string, (reason: Error) => void>();

function nextRequestId(): string {
  requestSequence += 1;
  return `browser-llm-${Date.now()}-${requestSequence}`;
}

/** Verify the sticky UI flag against durable model records in IndexedDB. */
export async function verifyBrowserModelDownloaded(
  model: BrowserModelConfig,
): Promise<boolean> {
  if (!isBrowserModelDownloaded(model.id) || typeof indexedDB === "undefined") {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const req = indexedDB.open(MODEL_CACHE_DB);
    req.onerror = () => resolve(false);
    req.onupgradeneeded = () => {
      // A newly-created database cannot contain the model. Close and let the
      // normal worker create its stores on the next download.
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MODEL_CACHE_META_STORE)) {
        db.close();
        resolve(false);
        return;
      }
      const repo = model.repo.toLowerCase();
      let foundLargeCompleteFile = false;
      let foundIncompleteFile = false;
      const tx = db.transaction(MODEL_CACHE_META_STORE, "readonly");
      const cursor = tx.objectStore(MODEL_CACHE_META_STORE).openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const meta = current.value as {
          url?: string;
          total?: number;
          received?: number;
          done?: boolean;
        };
        if ((meta.url ?? "").toLowerCase().includes(repo)) {
          const complete =
            meta.done === true &&
            (meta.total ?? 0) > 0 &&
            meta.received === meta.total;
          if (!complete) foundIncompleteFile = true;
          if (complete && (meta.total ?? 0) >= 10 * 1024 * 1024) {
            foundLargeCompleteFile = true;
          }
        }
        current.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(foundLargeCompleteFile && !foundIncompleteFile);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = tx.onerror;
    };
  });
}

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
    const created = new Worker(new URL("./browserLlm.worker.ts", import.meta.url), {
      type: "module",
    });
    const fail = (event: ErrorEvent | MessageEvent) => {
      if (worker !== created) return;
      if ("preventDefault" in event) event.preventDefault();
      const message =
        event instanceof ErrorEvent && event.message
          ? event.message
          : "The local model worker stopped unexpectedly.";
      resetBrowserEngine(new Error(message));
    };
    created.addEventListener("error", fail);
    created.addEventListener("messageerror", fail);
    worker = created;
  }
  return worker;
}

/** Drop the worker so the next call reloads (after a GPU crash / OOM / model switch). */
export function resetBrowserEngine(
  reason: Error = new Error("The local model was restarted. Please try again."),
): void {
  const current = worker;
  worker = null;
  current?.terminate();
  readyModelId = null;
  const failures = [...pendingOperations.values()];
  pendingOperations.clear();
  for (const fail of failures) fail(reason);
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
  if (/quota|storage.*full|disk.*full|not enough (?:disk )?space/i.test(raw)) {
    return new Error(
      `There is not enough storage space for ${modelName()}. Clear another cached model or free disk space, then retry.`,
    );
  }
  if (/device is lost|out of memory|mapasync|failed to allocate|oom|bad_alloc|failed to call ortrun/i.test(raw)) {
    return new Error(
      `${modelName()} ran out of memory on this device. Choose Gemma 3 1B or Qwen2.5 0.5B in the assistant model menu, then try again.`,
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

/**
 * Browser models apply their own chat templates. Gemma 3 is deliberately
 * strict: after an optional leading system prompt, turns must start with user
 * and alternate user/assistant. PDF context is represented as a user message,
 * so it can otherwise sit immediately before the user's question and trip that
 * validation. Stored conversations may contain the same shape after an
 * interrupted/empty response.
 *
 * Coalesce adjacent equal-role turns at the model boundary. This preserves all
 * context while producing a valid transcript for every built-in model.
 */
export function normalizeBrowserMessages(messages: ChatMessage[]): ChatMessage[] {
  const system: string[] = [];
  const turns: ChatMessage[] = [];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === "system") {
      system.push(content);
      continue;
    }

    // A truncated stored-history window can begin on an assistant response.
    // It has no preceding user turn and cannot be represented validly, so omit
    // it; the current user question remains intact later in the sequence.
    if (!turns.length && message.role === "assistant") continue;

    const previous = turns[turns.length - 1];
    if (previous?.role === message.role) {
      previous.content += `\n\n${content}`;
    } else {
      turns.push({ role: message.role, content });
    }
  }

  return [
    ...(system.length
      ? [{ role: "system" as const, content: system.join("\n\n") }]
      : []),
    ...turns,
  ];
}

function toChat(messages: ChatMessage[]) {
  return normalizeBrowserMessages(messages).map((m) => ({
    role: m.role,
    content: m.content,
  }));
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
const STALL_WARNING_MS = 25_000;
const LOAD_STALL_TIMEOUT_MS = 120_000;
const PREPARE_TIMEOUT_MS = 5 * 60_000;
const STOP_TIMEOUT_MS = 10_000;
const TOOL_TIMEOUT_MS = 90_000;

/** Stream a chat completion from the given on-device model (via the worker). */
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
  const requestId = nextRequestId();

  return new Promise<string>((resolve, reject) => {
    let full = "";
    let firstToken = true;
    // No status text unless there's something to say (download progress,
    // stalls) — an empty status keeps the chat bubble on its typing dots,
    // consistent with the other providers.
    let genTimer: ReturnType<typeof setTimeout> | undefined;

    // If progress events stop arriving mid-download, say so instead of
    // leaving a frozen percentage on screen.
    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let lastDownloadStatus = "";
    const armWatchdog = (phase: "starting" | "downloading" | "preparing") => {
      clearTimeout(warningTimer);
      clearTimeout(hardTimer);
      const preparing = phase === "preparing";
      warningTimer = setTimeout(() => {
        onStatus?.(
          preparing
            ? "Model preparation is taking longer than expected…"
            : `${lastDownloadStatus || "Starting the model"} — no progress yet. Check your connection.`,
        );
      }, STALL_WARNING_MS);
      hardTimer = setTimeout(() => {
        resetBrowserEngine(
          new Error(
            preparing
              ? "Model preparation timed out. Try a lighter model or clear the model cache."
              : "Model download timed out because no progress was received.",
          ),
        );
      }, preparing ? PREPARE_TIMEOUT_MS : LOAD_STALL_TIMEOUT_MS);
    };

    const onMessage = (e: MessageEvent) => {
      const d = e.data || {};
      if (d.requestId !== requestId) return;
      switch (d.type) {
        case "progress": {
          lastDownloadStatus = downloadStatusText(d.loaded ?? 0, d.total ?? 0);
          onStatus?.(`${lastDownloadStatus} · one-time, then cached`);
          armWatchdog("downloading");
          break;
        }
        case "status":
          onStatus?.(d.text ?? "");
          armWatchdog(d.phase === "preparing" ? "preparing" : "downloading");
          break;
        case "ready":
          clearTimeout(warningTimer);
          clearTimeout(hardTimer);
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
          fail(friendlyError(new Error(d.message)));
          resetBrowserEngine(friendlyError(new Error(d.message)));
          break;
      }
    };

    const onAbort = () => {
      if (readyModelId !== model.id) {
        const error = new DOMException("Aborted", "AbortError");
        if (pendingOperations.size > 1) {
          fail(error);
          w.postMessage({ type: "stop", requestId });
        } else {
          resetBrowserEngine(error);
        }
        return;
      }
      w.postMessage({ type: "stop", requestId });
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        resetBrowserEngine(new DOMException("Aborted", "AbortError"));
      }, STOP_TIMEOUT_MS);
    };
    const cleanup = () => {
      clearTimeout(warningTimer);
      clearTimeout(hardTimer);
      clearTimeout(genTimer);
      clearTimeout(stopTimer);
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      pendingOperations.delete(requestId);
    };
    const fail = (reason: Error) => {
      cleanup();
      reject(reason);
    };

    if (signal?.aborted) return fail(new DOMException("Aborted", "AbortError"));
    pendingOperations.set(requestId, fail);
    w.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    armWatchdog("starting");
    w.postMessage({
      type: "generate",
      requestId,
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
  const requestId = nextRequestId();

  return new Promise<void>((resolve, reject) => {
    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let lastText = "";
    const armWatchdog = (phase: "starting" | "downloading" | "preparing") => {
      clearTimeout(warningTimer);
      clearTimeout(hardTimer);
      const preparing = phase === "preparing";
      warningTimer = setTimeout(() => {
        onProgress({
          phase: preparing ? "preparing" : "downloading",
          text: preparing
            ? "Model preparation is taking longer than expected…"
            : `${lastText || "Starting the model"} — no progress yet. Check your connection.`,
          pct: null,
        });
      }, STALL_WARNING_MS);
      hardTimer = setTimeout(() => {
        resetBrowserEngine(
          new Error(
            preparing
              ? "Model preparation timed out. Try a lighter model or clear the model cache."
              : "Model download timed out because no progress was received.",
          ),
        );
      }, preparing ? PREPARE_TIMEOUT_MS : LOAD_STALL_TIMEOUT_MS);
    };

    const cleanup = () => {
      clearTimeout(warningTimer);
      clearTimeout(hardTimer);
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      pendingOperations.delete(requestId);
    };
    const onAbort = () => {
      // No clean cancel for a load in progress — drop the worker. The resumable
      // cache keeps whatever was downloaded so far. If another operation needs
      // the same worker, detach only this caller and let that shared load finish.
      const error = new DOMException("Aborted", "AbortError");
      if (pendingOperations.size > 1) {
        fail(error);
        w.postMessage({ type: "stop", requestId });
      } else {
        resetBrowserEngine(error);
      }
    };
    const fail = (reason: Error) => {
      cleanup();
      reject(reason);
    };

    const onMessage = (e: MessageEvent) => {
      const d = e.data || {};
      if (d.requestId !== requestId) return;
      switch (d.type) {
        case "progress":
          lastText = downloadStatusText(d.loaded ?? 0, d.total ?? 0);
          onProgress({ phase: "downloading", text: lastText, pct: pctOf(d.loaded ?? 0, d.total ?? 0) });
          armWatchdog("downloading");
          break;
        case "status":
          onProgress({ phase: "preparing", text: d.text ?? "Preparing the model…", pct: null });
          armWatchdog(d.phase === "preparing" ? "preparing" : "downloading");
          break;
        case "ready":
          cleanup();
          readyModelId = model.id;
          markDownloaded(model.id);
          resolve();
          break;
        case "error":
          fail(friendlyError(new Error(d.message)));
          resetBrowserEngine(friendlyError(new Error(d.message)));
          break;
      }
    };

    if (signal?.aborted) return fail(new DOMException("Aborted", "AbortError"));
    pendingOperations.set(requestId, fail);
    w.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    armWatchdog("starting");
    w.postMessage({ type: "load", requestId, model, forceCpu: isHandheldDevice() });
  });
}

/** Ask the selected local model to choose a validated editor tool. */
export function routeBrowserEditorTool(
  model: BrowserModelConfig,
  input: string,
  state: { currentPage: number; totalPages: number; zoomPercent: number },
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<EditorToolCall | null> {
  ensureModel(model);
  const w = getWorker();
  const requestId = nextRequestId();

  return new Promise<EditorToolCall | null>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastDownloadStatus = "";
    const cleanup = () => {
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      pendingOperations.delete(requestId);
    };
    const fail = (reason: Error) => {
      cleanup();
      reject(reason);
    };
    const finish = (value: EditorToolCall | null) => {
      cleanup();
      resolve(value);
    };
    const armTimeout = (duration = TOOL_TIMEOUT_MS) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => fail(new Error("The local model took too long to interpret the editor command.")),
        duration,
      );
    };
    const onAbort = () => {
      w.postMessage({ type: "stop", requestId });
      fail(new DOMException("Aborted", "AbortError"));
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.requestId !== requestId) return;
      switch (data.type) {
        case "progress":
          lastDownloadStatus = downloadStatusText(data.loaded ?? 0, data.total ?? 0);
          onStatus?.(`${lastDownloadStatus} · one-time, then cached`);
          armTimeout(LOAD_STALL_TIMEOUT_MS);
          break;
        case "status":
          onStatus?.(data.text ?? "Preparing the model…");
          armTimeout(PREPARE_TIMEOUT_MS);
          break;
        case "ready":
          readyModelId = model.id;
          markDownloaded(model.id);
          onStatus?.("Understanding editor command…");
          armTimeout();
          break;
        case "tool_result":
          finish(parseEditorToolCall(String(data.text ?? "")));
          break;
        case "stopped":
          finish(null);
          break;
        case "error": {
          const error = friendlyError(new Error(data.message));
          fail(error);
          resetBrowserEngine(error);
          break;
        }
      }
    };

    if (signal?.aborted) return fail(new DOMException("Aborted", "AbortError"));
    pendingOperations.set(requestId, fail);
    w.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    onStatus?.("Understanding editor command…");
    armTimeout();
    w.postMessage({
      type: "route_tool",
      requestId,
      model,
      forceCpu: isHandheldDevice(),
      messages: editorToolMessages(model, input, state),
      tools: EDITOR_TOOL_DEFINITIONS,
    });
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
  resetBrowserEngine(new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const clearFlags = () => {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(DOWNLOADED_PREFIX)) localStorage.removeItem(k);
        }
      } catch {
        /* ignore */
      }
    };
    const finish = (error?: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else {
          clearFlags();
          resolve();
        }
      }
    };
    const req = indexedDB.deleteDatabase(MODEL_CACHE_DB);
    req.onsuccess = () => finish();
    req.onerror = () => finish(req.error ?? new Error("Could not clear the model cache."));
    // Do not report success while an open database handle is still blocking
    // deletion. The timeout produces an actionable error instead.
    req.onblocked = () => {};
    const timeout = setTimeout(
      () => finish(new Error("The model cache is still in use. Close other PickPDF windows and try again.")),
      10_000,
    );
  });
}

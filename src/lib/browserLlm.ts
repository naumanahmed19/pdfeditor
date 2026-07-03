// Zero-config, fully local AI: a Gemma model that downloads once and runs in
// the browser via WebLLM (WebGPU). No Ollama / LM Studio / API key needed — for
// users who don't have a local model server. The ~1.4 GB weights are cached by
// the browser after the first download.
import type { ChatMessage } from "../types";

// Newest Gemma runnable in-browser today (Gemma 3/4 aren't available in WebLLM).
export const BROWSER_MODEL_ID = "gemma-2-2b-it-q4f16_1-MLC";
export const BROWSER_MODEL_LABEL = "Gemma 2 (in-browser)";

/** WebLLM needs WebGPU (Chrome/Edge, or the desktop app's WebView2). */
export function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export interface LoadProgress {
  progress: number; // 0..1
  text: string;
}

let enginePromise: Promise<any> | null = null;
let ready = false;

export function browserModelReady(): boolean {
  return ready;
}

/** Lazily create (and download, once) the in-browser engine. */
export async function getBrowserEngine(
  onProgress?: (p: LoadProgress) => void,
): Promise<any> {
  if (!webgpuAvailable()) {
    throw new Error(
      "This browser has no WebGPU support, which the built-in model needs. Use Chrome or Edge (or the desktop app), or switch to Ollama / LM Studio in Settings.",
    );
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(BROWSER_MODEL_ID, {
        initProgressCallback: (r: { progress: number; text: string }) =>
          onProgress?.({ progress: r.progress, text: r.text }),
      });
      ready = true;
      return engine;
    })();
    // Allow a retry if the first load fails (e.g. the download was interrupted).
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

/** Stream a chat completion from the in-browser model (OpenAI-shaped chunks). */
export async function streamBrowserChat(
  messages: ChatMessage[],
  temperature: number,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<string> {
  const engine = await getBrowserEngine((p) => {
    onStatus?.(
      p.progress >= 1
        ? "Loading the model into memory…"
        : `Downloading the Gemma model — ${Math.round(p.progress * 100)}% (one-time, then cached)`,
    );
  });
  onStatus?.("");

  const stream = await engine.chat.completions.create({
    messages,
    temperature,
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    if (signal?.aborted) {
      try {
        await engine.interruptGenerate();
      } catch {
        /* best-effort */
      }
      break;
    }
    const delta: string = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      full += delta;
      onToken(delta);
    }
  }
  return full;
}

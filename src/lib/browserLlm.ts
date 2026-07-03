// Zero-config, fully local AI: Google's Gemma 4 (E2B) running in the browser via
// Transformers.js on WebGPU. No Ollama / LM Studio / API key needed. The model
// (ONNX, q4f16) downloads once from the Hugging Face hub and is cached; it then
// works offline.
import type { ChatMessage } from "../types";

// Gemma 4 E2B, ONNX build for Transformers.js / WebGPU (Google's latest Gemma).
export const BROWSER_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
export const BROWSER_MODEL_LABEL = "Gemma 4 (in-browser)";

/** Transformers.js WebGPU needs WebGPU (Chrome/Edge, or the desktop WebView2). */
export function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export interface LoadProgress {
  progress: number; // 0..1
  text: string;
}

let enginePromise: Promise<{ processor: any; model: any; tf: any }> | null = null;
let ready = false;

export function browserModelReady(): boolean {
  return ready;
}

/** Drop the cached engine so the next call reloads (after a GPU crash / OOM). */
export function resetBrowserEngine(): void {
  enginePromise = null;
  ready = false;
}

/** Turn a raw WebGPU/ORT failure into an actionable message. */
function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/device is lost|out of memory|mapasync|failed to allocate|oom/i.test(raw)) {
    return new Error(
      "The GPU ran out of memory running Gemma 4 (it needs a fair bit of VRAM). Try again, or use a smaller model / a local server (Ollama, LM Studio) in Settings.",
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

/** Lazily load (and download, once) the Gemma 4 processor + model. */
export async function getBrowserEngine(onProgress?: (p: LoadProgress) => void) {
  if (!webgpuAvailable()) {
    throw new Error(
      "This browser has no WebGPU support, which the built-in Gemma 4 model needs. Use Chrome or Edge (or the desktop app), or switch to Ollama / LM Studio in Settings.",
    );
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      const tf = await import("@huggingface/transformers");
      const progress_callback = (info: any) => {
        if (info?.status === "progress" && typeof info.progress === "number") {
          onProgress?.({ progress: info.progress / 100, text: info.file ?? "" });
        }
      };
      const processor = await tf.AutoProcessor.from_pretrained(BROWSER_MODEL_ID, {
        progress_callback,
      });
      const model = await tf.Gemma4ForConditionalGeneration.from_pretrained(
        BROWSER_MODEL_ID,
        { dtype: "q4f16", device: "webgpu", progress_callback },
      );
      ready = true;
      return { processor, model, tf };
    })();
    enginePromise.catch(() => {
      enginePromise = null; // allow retry after a failed / interrupted load
    });
  }
  return enginePromise;
}

/** Gemma's chat template has no "system" role — fold it into the first user turn. */
function foldSystem(messages: ChatMessage[]): ChatMessage[] {
  const sys = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();
  const rest = messages.filter((m) => m.role !== "system");
  if (sys) {
    const i = rest.findIndex((m) => m.role === "user");
    if (i >= 0) rest[i] = { ...rest[i], content: `${sys}\n\n${rest[i].content}` };
    else rest.unshift({ role: "user", content: sys });
  }
  return rest;
}

/** Stream a chat completion from the in-browser Gemma 4 model. */
export async function streamBrowserChat(
  messages: ChatMessage[],
  temperature: number,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Preparing the in-browser model…");
  let engine: { processor: any; model: any; tf: any };
  try {
    engine = await getBrowserEngine((p) => {
      onStatus?.(
        p.progress >= 1
          ? "Loading Gemma 4 into memory…"
          : `Downloading Gemma 4 — ${Math.round(p.progress * 100)}% (one-time, then cached)`,
      );
    });
  } catch (err) {
    resetBrowserEngine();
    throw friendlyError(err);
  }
  const { processor, model, tf } = engine;
  onStatus?.("");

  const chat = foldSystem(messages).map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  }));
  const inputs = await processor.apply_chat_template(chat, {
    add_generation_prompt: true,
    tokenize: true,
    return_dict: true,
  });

  const stopper = new tf.InterruptableStoppingCriteria();
  const onAbort = () => stopper.interrupt();
  signal?.addEventListener("abort", onAbort);

  let full = "";
  const streamer = new tf.TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      full += text;
      onToken(text);
    },
  });

  try {
    await model.generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: temperature > 0,
      temperature: temperature > 0 ? temperature : undefined,
      streamer,
      stopping_criteria: stopper,
    });
  } catch (err) {
    // A lost WebGPU device leaves the engine dead — drop it so a retry reloads.
    resetBrowserEngine();
    if (!full) throw friendlyError(err);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return full;
}

// Web Worker that runs Google's Gemma 4 (E2B) fully in-browser via Transformers.js.
// Generation happens off the main thread so the UI stays responsive. Mirrors the
// proven `pipeline("text-generation", …)` setup: WebGPU when available, with an
// automatic CPU (WASM) fallback so machines without a GPU still work (just slower).
import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
} from "@huggingface/transformers";

const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";

// Download weights from the Hugging Face hub (cached after first use), never local.
env.allowLocalModels = false;
env.allowRemoteModels = true;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends as any).onnx.wasm.proxy = false;

type Role = "system" | "user" | "assistant";
interface Msg {
  role: Role;
  content: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null;
let device: "webgpu" | "wasm" = "webgpu";
let isGenerating = false;
let wasInterrupted = false;
const stopper = new InterruptableStoppingCriteria();

function post(type: string, payload: Record<string, unknown> = {}) {
  (self as unknown as Worker).postMessage({ type, ...payload });
}

const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPipeline(dev: "webgpu" | "wasm"): Promise<any> {
  device = dev;
  return pipeline("text-generation", MODEL_ID, {
    device: dev,
    // q4f16 needs fp16 (WebGPU); plain q4 for the CPU/WASM path.
    dtype: dev === "webgpu" ? "q4f16" : "q4",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (event: any) => {
      if (event?.status === "progress") {
        post("progress", { progress: event.progress ?? 0, file: event.file });
      }
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadModel(): Promise<any> {
  if (!generatorPromise) {
    const preferred = hasWebGPU ? "webgpu" : "wasm";
    generatorPromise = buildPipeline(preferred).catch(async (err) => {
      // WebGPU can be present but fail to init / run out of memory — fall back to CPU.
      if (preferred === "webgpu") {
        post("status", {
          text: "WebGPU unavailable — falling back to CPU (slower)…",
        });
        return buildPipeline("wasm");
      }
      throw err;
    });
    generatorPromise.catch(() => {
      generatorPromise = null; // allow a retry after a failed load
    });
  }
  const generator = await generatorPromise;
  post("ready", { device });
  return generator;
}

async function generate(messages: Msg[], temperature: number, maxTokens: number) {
  const generator = await loadModel();
  isGenerating = true;
  wasInterrupted = false;
  stopper.reset();

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (text) post("token", { delta: text });
    },
  });

  const doSample = temperature > 0;
  await generator(messages, {
    max_new_tokens: maxTokens,
    do_sample: doSample,
    temperature: doSample ? temperature : undefined,
    top_p: 0.9,
    repetition_penalty: 1.08,
    stopping_criteria: stopper,
    streamer,
  });

  post(wasInterrupted ? "stopped" : "done");
  isGenerating = false;
  stopper.reset();
}

self.addEventListener("message", async (event: MessageEvent) => {
  const data = event.data || {};
  try {
    if (data.type === "load") {
      await loadModel();
      return;
    }
    if (data.type === "stop") {
      if (isGenerating) {
        wasInterrupted = true;
        stopper.interrupt();
      }
      return;
    }
    if (data.type === "generate") {
      await generate(
        data.messages || [],
        typeof data.temperature === "number" ? data.temperature : 0.7,
        typeof data.maxTokens === "number" ? data.maxTokens : 512,
      );
    }
  } catch (error) {
    isGenerating = false;
    stopper.reset();
    generatorPromise = null;
    post("error", {
      message:
        (error as Error)?.message ||
        "Could not run Gemma 4 locally. Use Chrome/Edge with WebGPU, or free up memory.",
    });
  }
});

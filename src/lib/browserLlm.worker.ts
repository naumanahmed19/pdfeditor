// Web Worker that runs an in-browser LLM fully client-side via Transformers.js.
// Which model runs is chosen by the main thread and passed in each message, so
// the same worker serves whichever the user picked (Gemma 4 on desktop, the
// lightweight Qwen2.5 on mobile). Generation happens off the main thread so the
// UI stays responsive: `pipeline("text-generation", …)` with WebGPU when
// available and an automatic CPU (WASM) fallback so machines without a GPU still
// work (just slower).
// Import FIRST — this patches `fetch` on import, before Transformers.js captures
// its own reference to it. Our resumable IndexedDB cache streams the model
// download in chunks and picks up where it left off, because Transformers.js's
// own Cache Storage can't persist a partial download (a refresh mid-download
// would otherwise restart the multi-GB weights from zero).
import "./modelCache";
import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
} from "@huggingface/transformers";
import type { BrowserModelConfig } from "./modelConfig";

// Download weights from the Hugging Face hub, never local.
env.allowLocalModels = false;
env.allowRemoteModels = true;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends as any).onnx.wasm.proxy = false;

// Persistence is handled by ./modelCache, so disable the built-in Cache Storage.
env.useBrowserCache = false;

type Role = "system" | "user" | "assistant";
interface Msg {
  role: Role;
  content: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null;
// The model the cached generator was built for — a request for a different one
// drops it and rebuilds (the main thread also terminates us on a model switch).
let loadedModel: BrowserModelConfig | null = null;
let device: "webgpu" | "wasm" = "webgpu";
let isGenerating = false;
let wasInterrupted = false;
const stopper = new InterruptableStoppingCriteria();

function post(type: string, payload: Record<string, unknown> = {}) {
  (self as unknown as Worker).postMessage({ type, ...payload });
}

const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPipeline(dev: "webgpu" | "wasm", model: BrowserModelConfig): Promise<any> {
  device = dev;
  // Aggregate download progress across ALL files (tokenizer + weight shards),
  // otherwise the reported percent is per-file and appears to jump or stall.
  const files = new Map<string, { loaded: number; total: number }>();
  const postAggregate = () => {
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post("progress", { loaded, total });
  };
  return pipeline("text-generation", model.repo, {
    device: dev,
    // WebGPU can use the fp16-friendly variant; CPU/WASM falls back to plain q4.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dtype: (dev === "webgpu" ? model.dtype.webgpu : model.dtype.wasm) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (event: any) => {
      if (!event?.file) return;
      if (event.status === "progress") {
        files.set(event.file, {
          loaded: event.loaded ?? 0,
          total: event.total ?? 0,
        });
        postAggregate();
      } else if (event.status === "done") {
        const f = files.get(event.file);
        if (f) files.set(event.file, { loaded: f.total || f.loaded, total: f.total || f.loaded });
        postAggregate();
        // All files in — the silent load/compile phase begins; say so instead
        // of leaving a stale "Downloading …%" on screen.
        if ([...files.values()].every((x) => x.loaded >= x.total)) {
          post("status", {
            text: "Download complete — preparing the model (first run can take a minute)…",
          });
        }
      }
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadModel(model: BrowserModelConfig): Promise<any> {
  // A request for a different model than the one cached — drop the old generator.
  if (generatorPromise && loadedModel && loadedModel.id !== model.id) {
    generatorPromise = null;
  }
  if (!generatorPromise) {
    loadedModel = model;
    const preferred = hasWebGPU ? "webgpu" : "wasm";
    generatorPromise = buildPipeline(preferred, model).catch(async (err) => {
      // WebGPU can be present but fail to init / run out of memory — fall back to CPU.
      if (preferred === "webgpu") {
        post("status", {
          text: "WebGPU unavailable — falling back to CPU (slower)…",
        });
        return buildPipeline("wasm", model);
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

async function generate(
  model: BrowserModelConfig,
  messages: Msg[],
  temperature: number,
  maxTokens: number,
) {
  const generator = await loadModel(model);
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
      await loadModel(data.model);
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
        data.model,
        data.messages || [],
        typeof data.temperature === "number" ? data.temperature : 0.7,
        typeof data.maxTokens === "number" ? data.maxTokens : 512,
      );
    }
  } catch (error) {
    isGenerating = false;
    stopper.reset();
    generatorPromise = null;
    const name = loadedModel?.name ?? "the model";
    post("error", {
      message:
        (error as Error)?.message ||
        `Could not run ${name} locally. Use Chrome/Edge with WebGPU, or free up memory.`,
    });
  }
});

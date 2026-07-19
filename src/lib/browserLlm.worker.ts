// Web Worker that runs an on-device LLM fully client-side via Transformers.js.
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

type Role = "system" | "developer" | "user" | "assistant" | "tool";
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
let activeRequestId: string | null = null;
let commandQueue: Promise<void> = Promise.resolve();
const cancelledRequests = new Set<string>();
const stopper = new InterruptableStoppingCriteria();

function post(
  type: string,
  requestId: string,
  payload: Record<string, unknown> = {},
) {
  (self as unknown as Worker).postMessage({ type, requestId, ...payload });
}

const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPipeline(
  dev: "webgpu" | "wasm",
  model: BrowserModelConfig,
  requestId: string,
): Promise<any> {
  device = dev;
  // Transformers.js 4.x emits `progress_total`, which already includes every
  // expected file. Prefer it so the bar cannot hit 100% on the tokenizer and
  // then jump backwards when a weight shard starts. The small manual map is a
  // compatibility fallback for older builds that only emit per-file progress.
  const files = new Map<string, { loaded: number; total: number }>();
  let aggregateSeen = false;
  let preparingPosted = false;
  const postAggregate = () => {
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post("progress", requestId, { loaded, total });
  };
  return pipeline("text-generation", model.repo, {
    device: dev,
    // WebGPU can use the fp16-friendly variant; CPU/WASM falls back to plain q4.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dtype: (dev === "webgpu" ? model.dtype.webgpu : model.dtype.wasm) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (event: any) => {
      if (event?.status === "progress_total") {
        aggregateSeen = true;
        const loaded = event.loaded ?? 0;
        const total = event.total ?? 0;
        post("progress", requestId, { loaded, total });
        if (!preparingPosted && total > 0 && loaded >= total) {
          preparingPosted = true;
          post("status", requestId, {
            phase: "preparing",
            text: "Download complete — preparing the model (first run can take a few minutes)…",
          });
        }
        return;
      }
      if (!event?.file || aggregateSeen) return;
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
        if (
          !preparingPosted &&
          files.size > 0 &&
          [...files.values()].every((x) => x.total > 0 && x.loaded >= x.total)
        ) {
          preparingPosted = true;
          post("status", requestId, {
            phase: "preparing",
            text: "Download complete — preparing the model (first run can take a few minutes)…",
          });
        }
      }
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isGpuFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /webgpu|\bgpu\b|device (?:is )?lost|requestadapter|adapter|wgsl|shader|workgroup|command buffer|mapasync|buffer.*usage|out of memory|failed to allocate/i.test(
    message,
  );
}

async function loadModel(
  model: BrowserModelConfig,
  forceCpu: boolean,
  requestId: string,
): Promise<any> {
  // A request for a different model than the one cached — drop the old generator.
  if (generatorPromise && loadedModel && loadedModel.id !== model.id) {
    generatorPromise = null;
  }
  if (!generatorPromise) {
    loadedModel = model;
    // Phones/tablets force the CPU path: mobile WebGPU has crashed or produced
    // garbage across every GPU vendor we've tried, and a GPU crash kills the tab
    // before any fallback can run. CPU is slower but reliable.
    const preferred = !forceCpu && hasWebGPU ? "webgpu" : "wasm";
    generatorPromise = buildPipeline(preferred, model, requestId).catch(async (err) => {
      // Only GPU-specific failures should trigger the expensive CPU variant.
      // Network, quota and corrupt-cache errors must be surfaced as-is instead
      // of unexpectedly starting a second model download.
      if (preferred === "webgpu" && isGpuFailure(err)) {
        post("status", requestId, {
          phase: "preparing",
          text: "WebGPU unavailable — falling back to CPU (slower)…",
        });
        return buildPipeline("wasm", model, requestId);
      }
      throw err;
    });
    generatorPromise.catch(() => {
      generatorPromise = null; // allow a retry after a failed load
    });
  }
  const generator = await generatorPromise;
  post("ready", requestId, { device, modelId: model.id });
  return generator;
}

// Set once the current generation has emitted at least one token — a failure
// after that isn't safe to retry (it would duplicate the streamed output).
let streamedThisRun = false;

// One generation pass, streaming tokens to the main thread as they arrive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runGeneration(
  requestId: string,
  generator: any,
  messages: Msg[],
  temperature: number,
  maxTokens: number,
): Promise<void> {
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (text) {
        streamedThisRun = true;
        post("token", requestId, { delta: text });
      }
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
}

async function generate(
  requestId: string,
  model: BrowserModelConfig,
  messages: Msg[],
  temperature: number,
  maxTokens: number,
  forceCpu = false,
) {
  let generator = await loadModel(model, forceCpu, requestId);
  if (cancelledRequests.has(requestId)) {
    post("stopped", requestId);
    return;
  }
  isGenerating = true;
  activeRequestId = requestId;
  wasInterrupted = false;
  streamedThisRun = false;
  stopper.reset();

  try {
    await runGeneration(requestId, generator, messages, temperature, maxTokens);
  } catch (err) {
    // Some WebGPU failures only surface when generation runs, after a clean
    // load — e.g. a mobile GPU that can't build the attention compute pipeline
    // (workgroup storage over the device limit). If nothing streamed yet, drop
    // to CPU (WASM) and retry once so the answer still comes through, slower.
    if (
      device === "webgpu" &&
      !wasInterrupted &&
      !streamedThisRun &&
      isGpuFailure(err)
    ) {
      post("status", requestId, {
        phase: "preparing",
        text: "This device's GPU can't run the model — switching to CPU (slower)…",
      });
      try {
        await generator?.dispose?.();
      } catch {
        /* best-effort release before allocating the CPU pipeline */
      }
      generatorPromise = null;
      generator = await buildPipeline("wasm", model, requestId); // sets device = "wasm"
      loadedModel = model;
      generatorPromise = Promise.resolve(generator);
      post("ready", requestId, { device, modelId: model.id });
      stopper.reset();
      await runGeneration(requestId, generator, messages, temperature, maxTokens);
    } else {
      throw err;
    }
  }

  post(wasInterrupted ? "stopped" : "done", requestId);
  isGenerating = false;
  activeRequestId = null;
  stopper.reset();
}

// Tool routing is a short, non-streamed pass. Keeping it separate prevents raw
// tool syntax from flashing in the chat bubble before validation/execution.
async function routeTool(
  requestId: string,
  model: BrowserModelConfig,
  messages: Msg[],
  tools: unknown[],
  forceCpu = false,
): Promise<void> {
  const generator = await loadModel(model, forceCpu, requestId);
  if (cancelledRequests.has(requestId)) {
    post("stopped", requestId);
    return;
  }
  isGenerating = true;
  activeRequestId = requestId;
  wasInterrupted = false;
  stopper.reset();
  try {
    const output = await generator(messages, {
      max_new_tokens: 128,
      do_sample: false,
      stopping_criteria: stopper,
      ...(model.toolCalling === "native" ? { tools } : {}),
    });
    const generated = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
    const last = Array.isArray(generated) ? generated[generated.length - 1] : generated;
    const text = typeof last === "string" ? last : String(last?.content ?? "");
    post(wasInterrupted ? "stopped" : "tool_result", requestId, { text });
  } finally {
    isGenerating = false;
    activeRequestId = null;
    stopper.reset();
  }
}

async function handleCommand(data: Record<string, any>): Promise<void> {
  const requestId = String(data.requestId ?? "");
  if (!requestId) return;
  if (cancelledRequests.delete(requestId)) {
    post("stopped", requestId);
    return;
  }
  try {
    if (data.type === "load") {
      await loadModel(data.model, !!data.forceCpu, requestId);
      return;
    }
    if (data.type === "generate") {
      await generate(
        requestId,
        data.model,
        data.messages || [],
        typeof data.temperature === "number" ? data.temperature : 0.7,
        typeof data.maxTokens === "number" ? data.maxTokens : 512,
        data.forceCpu,
      );
      return;
    }
    if (data.type === "route_tool") {
      await routeTool(
        requestId,
        data.model,
        data.messages || [],
        data.tools || [],
        data.forceCpu,
      );
    }
  } catch (error) {
    isGenerating = false;
    activeRequestId = null;
    stopper.reset();
    generatorPromise = null;
    const name = loadedModel?.name ?? "the model";
    post("error", requestId, {
      message:
        (error as Error)?.message ||
        `Could not run ${name} locally. Use Chrome/Edge with WebGPU, or free up memory.`,
    });
  } finally {
    cancelledRequests.delete(requestId);
  }
}

self.addEventListener("message", (event: MessageEvent) => {
  const data = event.data || {};
  const requestId = String(data.requestId ?? "");
  if (data.type === "stop") {
    if (isGenerating && activeRequestId === requestId) {
      wasInterrupted = true;
      stopper.interrupt();
    } else if (requestId) {
      cancelledRequests.add(requestId);
    }
    return;
  }

  // Loading and generation share one pipeline and must not run concurrently.
  // Stop commands bypass the queue above so active generation remains cancellable.
  commandQueue = commandQueue.then(() => handleCommand(data));
});

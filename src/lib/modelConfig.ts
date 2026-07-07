// Single source of truth for the built-in, in-browser AI models.
//
// The assistant can run more than one fully-local model. Desktop defaults to the
// higher-quality Gemma 4; phones and tablets are pinned to a small model that
// fits a mobile memory budget. (Gemma 4's ~3 GB weights are dominated by a 1.3 GB,
// 256K-token embedding table that doesn't shrink with quantization, so it
// OOM-crashes mobile tabs — hence a small model there.)
//
// dtype note: mobile models use plain `q4` (not `q4f16`) on WebGPU. The fp16
// path has produced garbage output on some mobile GPUs (and Gemma 3 specifically
// has a known fp16/q4f16 WebGPU overflow bug); q4 uses fp32 compute and stays
// correct, at a small size/speed cost that's worth it for a usable answer.
//
// Everything downstream keys off these configs: the worker's download +
// quantization, the Settings model picker + download panel, the assistant's
// model dropdown, and every user-facing label and status string.
//
// Keep this module side-effect free (no `navigator`, no DOM) so both the main
// thread and the Web Worker can import it. Device detection lives in ./device.

export interface BrowserModelConfig {
  /** Stable internal key persisted in settings, e.g. "gemma-4". */
  id: string;
  /** Hugging Face repo id (ONNX weights) the worker downloads. */
  repo: string;
  /** Short display name shown to users, e.g. "Gemma 4". */
  name: string;
  /**
   * Quantization dtype per backend. WebGPU uses the fp16-friendly variant; the
   * CPU/WASM path falls back to plain q4. Strings are passed straight to
   * Transformers.js `pipeline({ dtype })`.
   */
  dtype: { webgpu: string; wasm: string };
  /** Rough download size, shown in the Settings note (e.g. "~3 GB"). */
  sizeLabel: string;
  /** Fits within a phone/tablet memory budget without OOM-crashing the tab. */
  mobileSafe: boolean;
  /** One-line description for the Settings model picker. */
  blurb: string;
}

export const BROWSER_MODELS: BrowserModelConfig[] = [
  {
    id: "gemma-4",
    repo: "onnx-community/gemma-4-E2B-it-ONNX",
    name: "Gemma 4",
    dtype: { webgpu: "q4f16", wasm: "q4" },
    sizeLabel: "~3 GB",
    mobileSafe: false,
    blurb: "Higher quality. Needs a desktop with ~8 GB RAM.",
  },
  {
    id: "gemma-3-1b",
    repo: "onnx-community/gemma-3-1b-it-ONNX",
    name: "Gemma 3 1B",
    // q4 (not q4f16) on WebGPU — avoids the fp16 overflow that garbles output.
    dtype: { webgpu: "q4", wasm: "q4" },
    sizeLabel: "~0.9 GB",
    // Desktop only: Gemma 3's large attention head (dim 256) needs 64 KB of GPU
    // workgroup storage, over the 32 KB most mobile GPUs allow, so its attention
    // compute pipeline can't be built on a phone. Runs great on desktop GPUs.
    mobileSafe: false,
    blurb: "Compact and capable — best on desktop.",
  },
  {
    id: "qwen-0.5b",
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen2.5 0.5B",
    // Mobile forces the wasm (CPU) path — see isHandheldDevice usage — because
    // mobile WebGPU has proven unreliable across vendors (garbage output, GPU
    // crashes). q4f16 on CPU is correct and the smallest download (~0.5 GB),
    // easing memory pressure on tablets. Desktop still uses WebGPU q4.
    dtype: { webgpu: "q4", wasm: "q4f16" },
    sizeLabel: "~0.5 GB",
    mobileSafe: true,
    blurb: "Lightweight — runs on phones and tablets.",
  },
];

/** Default in-browser model on desktop/web (the user can switch). */
export const DEFAULT_DESKTOP_MODEL_ID = "gemma-4";
/** The model phones/tablets are pinned to (small enough head dim for mobile GPUs). */
export const MOBILE_MODEL_ID = "qwen-0.5b";

/** Look up a model by id, falling back to the first (desktop default). */
export function getBrowserModel(id: string | undefined): BrowserModelConfig {
  return BROWSER_MODELS.find((m) => m.id === id) ?? BROWSER_MODELS[0];
}

/**
 * The model actually used on this device: phones/tablets are always pinned to
 * the mobile-safe model regardless of the stored preference; desktop honours the
 * user's choice (defaulting to Gemma 4).
 */
export function effectiveBrowserModel(
  browserModelId: string | undefined,
  handheld: boolean,
): BrowserModelConfig {
  if (handheld) return getBrowserModel(MOBILE_MODEL_ID);
  return getBrowserModel(browserModelId ?? DEFAULT_DESKTOP_MODEL_ID);
}

/** Browser models this device may run — every model on desktop, just the pinned
 *  mobile model on phones/tablets (matching effectiveBrowserModel's hard pin). */
export function availableBrowserModels(handheld: boolean): BrowserModelConfig[] {
  return handheld ? [getBrowserModel(MOBILE_MODEL_ID)] : BROWSER_MODELS;
}

/** Picker/status label, e.g. "Gemma 4 (in-browser)". */
export function browserModelLabel(m: BrowserModelConfig): string {
  return `${m.name} (in-browser)`;
}

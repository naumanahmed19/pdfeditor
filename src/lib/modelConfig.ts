// Single source of truth for the built-in, in-browser AI models.
//
// The assistant can run more than one fully-local model. Desktop defaults to the
// higher-quality Gemma 4; phones and tablets are pinned to the lightweight
// Qwen2.5 0.5B, which fits a mobile memory budget. (Gemma 4's ~3 GB weights are
// dominated by a 1.3 GB, 256K-token embedding table that doesn't shrink with
// quantization, so it OOM-crashes mobile tabs — hence a small-vocab model there.)
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
    id: "qwen-0.5b",
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen2.5 0.5B",
    dtype: { webgpu: "q4f16", wasm: "q4" },
    sizeLabel: "~0.5 GB",
    mobileSafe: true,
    blurb: "Lightweight — runs on phones and tablets.",
  },
];

/** Default in-browser model on desktop/web (the user can switch). */
export const DEFAULT_DESKTOP_MODEL_ID = "gemma-4";
/** The only in-browser model offered on phones/tablets. */
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

/** Browser models this device may run — every model on desktop, just the
 *  mobile-safe one on phones/tablets. */
export function availableBrowserModels(handheld: boolean): BrowserModelConfig[] {
  return handheld ? BROWSER_MODELS.filter((m) => m.mobileSafe) : BROWSER_MODELS;
}

/** Picker/status label, e.g. "Gemma 4 (in-browser)". */
export function browserModelLabel(m: BrowserModelConfig): string {
  return `${m.name} (in-browser)`;
}

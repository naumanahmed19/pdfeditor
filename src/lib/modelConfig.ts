// Single source of truth for the built-in, in-browser AI model.
//
// To ship a different model in a future update — Gemma 5, a smaller/larger
// variant, or another family entirely — change the fields below and everything
// else follows: the worker's download + quantization, the Settings download
// panel, the model picker in the assistant, and every user-facing label and
// status string ("Downloading Gemma 4 — 34%", GPU-OOM hints, etc.).
//
// Keep this module side-effect free so both the main thread and the Web Worker
// can import it. Only pure data/types belong here.

export interface BrowserModelConfig {
  /** Hugging Face repo id (ONNX weights) the worker downloads. */
  id: string;
  /** Short display name shown to users, e.g. "Gemma 4". */
  name: string;
  /**
   * Quantization dtype per backend. WebGPU can use the fp16-friendly variant;
   * the CPU/WASM path falls back to plain q4. Strings are passed straight to
   * Transformers.js `pipeline({ dtype })`.
   */
  dtype: { webgpu: string; wasm: string };
  /** Rough download size, shown in the Settings note (e.g. "~3 GB"). */
  sizeLabel: string;
}

export const BROWSER_MODEL: BrowserModelConfig = {
  id: "onnx-community/gemma-4-E2B-it-ONNX",
  name: "Gemma 4",
  dtype: { webgpu: "q4f16", wasm: "q4" },
  sizeLabel: "~3 GB",
};

/** Picker/status label, e.g. "Gemma 4 (in-browser)". */
export const BROWSER_MODEL_LABEL = `${BROWSER_MODEL.name} (in-browser)`;

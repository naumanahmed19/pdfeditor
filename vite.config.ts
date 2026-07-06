/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev-time proxies let the app reach local model servers without CORS issues.
export default defineConfig({
  plugins: [react()],
  // Unit tests (vitest). Pure-logic suites run in the default node environment;
  // suites that need the DOM opt in per-file with `// @vitest-environment jsdom`.
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
  },
  // Worker deps (Transformers.js) are ESM — bundle the worker as ES modules.
  worker: {
    format: "es",
  },
  server: {
    // Cross-origin isolation lets the in-browser LLM use threaded WASM / SharedArrayBuffer.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/proxy/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/ollama/, ""),
      },
      "/proxy/lmstudio": {
        target: "http://localhost:1234",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/lmstudio/, ""),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});

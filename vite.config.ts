/// <reference types="vitest/config" />
import fs from "node:fs";
import path from "node:path";
import type { Connect, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Serve the standalone marketing landing page at the clean `/download` route.
 *
 * The page (public/download/index.html) is a fully self-contained bundled
 * document that must NOT pass through Vite's HTML transform, so we can't rely
 * on it being an app entry point. In production the file is copied verbatim
 * into dist/ and static hosts resolve `/download` via directory-index; the dev
 * and preview servers don't do that (extensionless requests hit the SPA
 * fallback), so this middleware serves the raw file for them.
 */
function landingRoute() {
  const middleware =
    (dir: string): Connect.NextHandleFunction =>
    (req, res, next) => {
      const url = (req.url ?? "").split("?")[0];
      if (url === "/download" || url === "/download/") {
        const file = path.resolve(dir, "download/index.html");
        if (fs.existsSync(file)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(fs.readFileSync(file));
          return;
        }
      }
      next();
    };
  return {
    name: "pickpdf-landing-route",
    // `public/` in dev, built `dist/` in preview — must run before Vite's SPA
    // fallback, so register directly rather than returning a post hook.
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware(path.resolve(process.cwd(), "public")));
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(middleware(path.resolve(process.cwd(), "dist")));
    },
  };
}

// Dev-time proxies let the app reach local model servers without CORS issues.
export default defineConfig({
  plugins: [react(), landingRoute()],
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

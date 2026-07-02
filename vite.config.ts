import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-time proxies let the app reach local model servers without CORS issues.
export default defineConfig({
  plugins: [react()],
  server: {
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

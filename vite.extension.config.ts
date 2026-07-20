import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const extensionDir = path.resolve(process.cwd(), "extension");
const outputDir = path.resolve(process.cwd(), "dist-extension");

function extensionPackage(enableMimeHandler: boolean): Plugin {
  return {
    name: "pickpdf-extension-package",
    apply: "build",
    closeBundle() {
      const packageJson = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
      ) as { version: string };
      const manifest = JSON.parse(
        fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      manifest.version = packageJson.version;
      if (enableMimeHandler) {
        manifest.minimum_chrome_version = "151";
        manifest.mime_types_handler = {
          "application/pdf": {
            handler_url: "index.html",
            can_embed: true,
          },
        };
      } else {
        delete manifest.minimum_chrome_version;
        delete manifest.mime_types_handler;
      }

      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(
        path.join(outputDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      fs.copyFileSync(
        path.join(extensionDir, "service-worker.js"),
        path.join(outputDir, "service-worker.js"),
      );
      fs.copyFileSync(
        path.resolve(process.cwd(), "app-icon.png"),
        path.join(outputDir, "icon.png"),
      );

      const publicDir = path.resolve(process.cwd(), "public");
      fs.cpSync(path.join(publicDir, "fonts"), path.join(outputDir, "fonts"), {
        recursive: true,
      });
      for (const file of ["pickpdf-mark.svg", "pickpdf-mark-light.svg"]) {
        fs.copyFileSync(path.join(publicDir, file), path.join(outputDir, file));
      }

      const tesseractDir = path.join(outputDir, "tesseract");
      fs.mkdirSync(tesseractDir, { recursive: true });
      fs.copyFileSync(
        path.resolve(process.cwd(), "node_modules/tesseract.js/dist/worker.min.js"),
        path.join(tesseractDir, "worker.min.js"),
      );
      for (const file of [
        "tesseract-core-simd-lstm.js",
        "tesseract-core-simd-lstm.wasm",
      ]) {
        fs.copyFileSync(
          path.resolve(process.cwd(), "node_modules/tesseract.js-core", file),
          path.join(tesseractDir, file),
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const enableMimeHandler = mode === "chrome151";
  return {
    base: "./",
    publicDir: false,
    plugins: [react(), extensionPackage(enableMimeHandler)],
    worker: {
      format: "es",
    },
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000,
    },
  };
});

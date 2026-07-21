import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist-extension");
const expectMimeHandler = process.argv.includes("--expect-mime-handler");
const requiredFiles = [
  "manifest.json",
  "index.html",
  "service-worker.js",
  "icon.png",
  "pickpdf-mark.svg",
  "pickpdf-mark-light.svg",
  "fonts/Dongle-Regular.woff2",
  "fonts/Dongle-Bold.woff2",
  "fonts/Dongle-OFL.txt",
  "fonts/Carlito-Regular.ttf",
  "tesseract/worker.min.js",
  "tesseract/tesseract-core-simd-lstm.js",
  "tesseract/tesseract-core-simd-lstm.wasm",
];

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(output, relative))) {
    throw new Error(`Extension package is missing ${relative}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (manifest.version !== packageJson.version) {
  throw new Error("Extension version does not match package.json");
}
if (/\bchrome\b/i.test(manifest.description ?? "")) {
  throw new Error("Extension description must stay browser-neutral");
}
if (expectMimeHandler) {
  if (!manifest.mime_types_handler?.["application/pdf"]) {
    throw new Error("Chrome 151 build does not register the PDF MIME handler");
  }
  if (Number.parseInt(manifest.minimum_chrome_version, 10) < 151) {
    throw new Error("PDF MIME handler builds must require Chrome 151 or newer");
  }
} else if (manifest.mime_types_handler || manifest.minimum_chrome_version) {
  throw new Error("Stable build contains Chrome 151-only manifest keys");
}
if (!manifest.content_security_policy?.extension_pages?.includes("wasm-unsafe-eval")) {
  throw new Error("Extension CSP does not enable packaged WebAssembly");
}

const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
if (/https:\/\/fonts\.(googleapis|gstatic)\.com/i.test(html)) {
  throw new Error("Extension HTML still references remote Google Fonts");
}

const assets = fs.readdirSync(path.join(output, "assets"));
if (!assets.some((name) => name.endsWith(".wasm") && name.startsWith("pdfium-"))) {
  throw new Error("Extension package is missing PDFium WASM");
}
if (
  !assets.some(
    (name) => name.startsWith("ort-wasm-simd-threaded") && name.endsWith(".wasm"),
  )
) {
  throw new Error("Extension package is missing the bundled ONNX Runtime WASM");
}
if (!assets.some((name) => name.includes("pdfEdit.worker"))) {
  throw new Error("Extension package is missing the PDF edit worker");
}

const target = expectMimeHandler ? "Chrome 151+" : "Chrome Stable";
console.log(`Verified ${target} extension ${manifest.version} in ${output}`);

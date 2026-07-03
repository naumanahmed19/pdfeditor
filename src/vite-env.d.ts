/// <reference types="vite/client" />

declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const src: string;
  export default src;
}

declare module "@embedpdf/pdfium/pdfium.wasm?url" {
  const src: string;
  export default src;
}

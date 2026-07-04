/// <reference types="vite/client" />

declare module "@embedpdf/pdfium/pdfium.wasm?url" {
  const src: string;
  export default src;
}

// True when the app is running inside the Tauri desktop shell (vs. a browser tab).
// Tauri v2 injects `__TAURI_INTERNALS__` on the window.
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

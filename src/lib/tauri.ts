// True when the app is running inside the Tauri desktop shell (vs. a browser tab).
// Tauri v2 injects `__TAURI_INTERNALS__` on the window.
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// WKWebView reports a Mac platform for the Tauri desktop shell. Keep this
// separate from isTauri so the website still uses its normal branded header
// when viewed in Safari.
export const isMacOS =
  typeof navigator !== "undefined" &&
  /Mac/i.test(
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform ?? navigator.platform ?? "",
  );

export const isTauriMacOS = isTauri && isMacOS;

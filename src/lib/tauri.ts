// True when the app is running inside the Tauri desktop shell (vs. a browser tab).
// Tauri v2 injects `__TAURI_INTERNALS__` on the window.
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isAndroid =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export const isIOS =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/i.test(navigator.userAgent);

export const isTauriMobile = isTauri && (isAndroid || isIOS);
export const isTauriAndroid = isTauri && isAndroid;
export const isTauriDesktop = isTauri && !isTauriMobile;

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

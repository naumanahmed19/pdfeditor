import { isTauriDesktop } from "./tauri";

export const UPDATE_CHECK_EVENT = "pickpdf:check-for-updates";

export function isAppUpdaterEnabled() {
  return (
    isTauriDesktop &&
    import.meta.env.PROD &&
    import.meta.env.VITE_ENABLE_UPDATER === "true" &&
    import.meta.env.VITE_DISTRIBUTION_CHANNEL !== "microsoft-store"
  );
}

export function requestAppUpdateCheck() {
  window.dispatchEvent(new CustomEvent(UPDATE_CHECK_EVENT));
}

import { isTauri } from "./tauri";

export const UPDATE_CHECK_EVENT = "pickpdf:check-for-updates";

export function isAppUpdaterEnabled() {
  return (
    isTauri &&
    import.meta.env.VITE_DISTRIBUTION_CHANNEL !== "microsoft-store"
  );
}

export function requestAppUpdateCheck() {
  window.dispatchEvent(new CustomEvent(UPDATE_CHECK_EVENT));
}

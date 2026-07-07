// Coarse device-class detection for capability gating — NOT layout.
//
// The store's `isMobile` is viewport-based (<1024px) and flips when a desktop
// window is merely narrowed, which is the wrong question for "what can this
// hardware do". This asks a different one: is this an actual phone or tablet?
// We use it to pin the in-browser AI to the lightweight model and to hide the
// localhost-only providers (Ollama / LM Studio) that a handheld can never reach.

let cached: boolean | null = null;

/** True on phones and tablets (a real touch device), false on desktop/laptop. */
export function isHandheldDevice(): boolean {
  if (cached !== null) return cached;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ masquerades as desktop Safari on macOS; its touch points give it
  // away (a real Mac reports 0).
  const iPadOS =
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  cached =
    /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile|Silk|Kindle/i.test(
      ua,
    ) || iPadOS;
  return cached;
}

/** Shared link-target helpers, used by both the area-link tool and text-box
 *  links so the target model, picker UI, following and baking stay in sync. */

import type { LinkTarget, LinkTargetType } from "../types";

/** Hyperlink blue — linked text is shown (and baked) in this color + underline. */
export const LINK_COLOR = "#1d4ed8";

/** The four target kinds with the labels/placeholders shown in the picker. */
export const LINK_TARGETS: Array<{
  v: LinkTargetType;
  label: string;
  placeholder: string;
  type: string;
}> = [
  { v: "url", label: "Link to external URL", placeholder: "https://example.com", type: "url" },
  { v: "email", label: "Link to email address", placeholder: "you@example.com", type: "email" },
  { v: "phone", label: "Link to phone number", placeholder: "+1234567890", type: "tel" },
  { v: "page", label: "Link to internal page", placeholder: "2", type: "number" },
];

/** True when the target carries a usable value. */
export function hasLinkTarget(t: LinkTarget | undefined | null): t is LinkTarget {
  return !!t && !!t.value.trim();
}

/** Hover-title text describing a target. */
export function linkTitle(t: LinkTarget): string {
  if (!t.value.trim()) return "Link — click to set a target";
  if (t.targetType === "page") return `Go to page ${t.value}`;
  if (t.targetType === "email") return `Email ${t.value}`;
  if (t.targetType === "phone") return `Call ${t.value}`;
  return t.value;
}

/** Resolve a url / email / phone target to a browser href (and the PDF /URI).
 *  Returns null for empty values or for `page` targets (handled separately). */
export function linkHref(t: LinkTarget): string | null {
  if (t.targetType === "page") return null;
  const raw = t.value.trim();
  if (!raw) return null;
  if (t.targetType === "email") return `mailto:${raw}`;
  if (t.targetType === "phone") return `tel:${raw.replace(/\s+/g, "")}`;
  // Bare hostnames get https://; anything already carrying a scheme is kept.
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
}

/** Follow a target: scroll to the page, or open the URL in a new tab. */
export function followLinkTarget(
  t: LinkTarget,
  scrollToPage: (index0: number) => void,
): void {
  if (t.targetType === "page") {
    const n = parseInt(t.value, 10);
    if (n >= 1) scrollToPage(n - 1);
    return;
  }
  const href = linkHref(t);
  if (href) window.open(href, "_blank", "noopener,noreferrer");
}

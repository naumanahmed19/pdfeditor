// Lookup of the user's installed fonts by the exact name a PDF declares.
// A subset-embedded font only carries the glyphs the document already uses,
// but the SAME font installed on this machine is complete — when the PDF
// names e.g. "UniversLTStd-LightUltraCn" and that face exists in the system
// font folders, editing can use the true font instead of any substitute.
// Desktop (Tauri) only: the browser preview has no filesystem access, so
// every call resolves to null there and callers fall through.

import { isTauriDesktop } from "./tauri";

const cache = new Map<string, Promise<Uint8Array | null>>();

/**
 * Full program of the installed font matching a PDF base font name (subset
 * prefix tolerated), or null when not installed / not embeddable. Fonts whose
 * OS/2 fsType forbids embedding are refused — writing them into the PDF
 * would violate their license.
 */
export function findSystemFont(baseFontName: string): Promise<Uint8Array | null> {
  const name = baseFontName.replace(/^[A-Z]{6}\+/, "").trim();
  if (!name || !isTauriDesktop) return Promise.resolve(null);
  let hit = cache.get(name);
  if (!hit) {
    hit = lookup(name);
    cache.set(name, hit);
  }
  return hit;
}

async function lookup(name: string): Promise<Uint8Array | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[] | null>("match_system_font", { name });
    if (!bytes || bytes.length === 0) return null;
    const data = new Uint8Array(bytes);
    return (await embeddable(data)) ? data : null;
  } catch {
    return null;
  }
}

/** OS/2 fsType embedding check: restricted-license fonts must not be baked
 *  into documents. Unparseable programs are refused too — if fontkit can't
 *  read it, neither the preflight nor PDFium can be trusted with it. */
async function embeddable(data: Uint8Array): Promise<boolean> {
  try {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const font = fontkit.create(data) as unknown as {
      "OS/2"?: { fsType?: number };
    };
    const fsType = font["OS/2"]?.fsType ?? 0;
    return (fsType & 0x0002) === 0;
  } catch {
    return false;
  }
}

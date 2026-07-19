/** Stable-enough identity for browser File objects when a filesystem handle
 * is unavailable. Handles are compared separately with isSameEntry(). */
export function fileSourceKey(
  file: Pick<File, "name" | "size" | "lastModified"> & {
    webkitRelativePath?: string;
    path?: string;
  },
): string {
  const path = file.webkitRelativePath || file.path || file.name;
  return `file:${path}\0${file.size}\0${file.lastModified}`;
}

/** Lightweight sampled identity used only to collapse legacy stored records
 * that predate source keys. It avoids hashing an entire large PDF at startup. */
export function legacyBytesSourceKey(name: string, bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  };
  const edge = Math.min(64 * 1024, bytes.length);
  for (let i = 0; i < edge; i++) mix(bytes[i]);
  for (let i = Math.max(edge, bytes.length - edge); i < bytes.length; i++) mix(bytes[i]);
  // Sample the middle so equal-size PDFs with matching wrappers remain distinct.
  const samples = Math.min(64, bytes.length);
  for (let i = 1; i <= samples; i++) {
    mix(bytes[Math.floor((i * bytes.length) / (samples + 1))]);
  }
  return `legacy:${name}\0${bytes.length}\0${hash >>> 0}`;
}

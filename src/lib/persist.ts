/** IndexedDB persistence for open tabs and recent files. */

import type { AnnotationMap } from "../types";

export interface StoredDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  /** Overlay annotations (incl. ones imported out of the PDF's own /Annots —
   *  for those the stored `bytes` are the stripped version, so losing this
   *  map would lose the document's own markup). Never stored for protected
   *  docs: their bytes stay in the protected form and re-import on unlock. */
  annotations?: AnnotationMap;
  lastOpened: number;
  open: boolean;
}

const DB_NAME = "pickpdf";
const STORE = "docs";
const MAX_STORED = 10;
/** Documents above this size are never written to IndexedDB — autosave and
 *  crash recovery are effectively off for them, so callers must be able to
 *  tell the user (see `persistDoc`'s return value). */
export const MAX_PERSIST_BYTES = 80 * 1024 * 1024;

/** Pure size gate for the autosave limit, split out so it's unit-testable
 *  without an IndexedDB shim. */
export function exceedsPersistLimit(byteLength: number): boolean {
  return byteLength > MAX_PERSIST_BYTES;
}

/** Outcome of a persist attempt. `"too-large"` means the document exceeds
 *  `MAX_PERSIST_BYTES` and was intentionally skipped — surface that to the
 *  user; `"error"` is a best-effort storage failure (quota, private mode…). */
export type PersistResult = "stored" | "too-large" | "error";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function persistDoc(doc: StoredDoc): Promise<PersistResult> {
  if (exceedsPersistLimit(doc.bytes.length)) return "too-large";
  try {
    await tx("readwrite", (s) => s.put(doc));
    await pruneOld();
    return "stored";
  } catch {
    /* persistence is best-effort */
    return "error";
  }
}

export async function markDocClosed(id: string): Promise<void> {
  try {
    const doc = await tx<StoredDoc | undefined>("readonly", (s) => s.get(id));
    if (doc) await tx("readwrite", (s) => s.put({ ...doc, open: false }));
  } catch {
    /* ignore */
  }
}

export async function markAllClosed(): Promise<void> {
  try {
    const all = await listStoredDocs();
    for (const d of all.filter((d) => d.open)) {
      await tx("readwrite", (s) => s.put({ ...d, open: false }));
    }
  } catch {
    /* ignore */
  }
}

export async function getStoredDoc(id: string): Promise<StoredDoc | undefined> {
  try {
    return await tx<StoredDoc | undefined>("readonly", (s) => s.get(id));
  } catch {
    return undefined;
  }
}

export async function listStoredDocs(): Promise<StoredDoc[]> {
  try {
    const all = await tx<StoredDoc[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.lastOpened - a.lastOpened);
  } catch {
    return [];
  }
}

async function pruneOld(): Promise<void> {
  const all = await listStoredDocs();
  for (const stale of all.slice(MAX_STORED)) {
    await tx("readwrite", (s) => s.delete(stale.id));
  }
}

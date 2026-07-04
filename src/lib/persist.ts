/** IndexedDB persistence for open tabs and recent files. */

export interface StoredDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  lastOpened: number;
  open: boolean;
}

const DB_NAME = "pickpdf";
const STORE = "docs";
const MAX_STORED = 10;
const MAX_BYTES = 80 * 1024 * 1024;

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

export async function persistDoc(doc: StoredDoc): Promise<void> {
  if (doc.bytes.length > MAX_BYTES) return;
  try {
    await tx("readwrite", (s) => s.put(doc));
    await pruneOld();
  } catch {
    /* persistence is best-effort */
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

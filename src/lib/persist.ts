/**
 * Document persistence.
 *
 * Desktop (Tauri): SQLite stores session/recent metadata while PDF and
 * annotation snapshots live as files in AppLocalData. Browser: IndexedDB is a
 * compatibility fallback. The two backends intentionally do not migrate data
 * between one another.
 */

import type { AnnotationMap } from "../types";
import { isTauri } from "./tauri";

export interface StoredDoc {
  id: string;
  name: string;
  /** Stable source identity used to avoid reopening the same file twice. */
  sourceKey?: string;
  bytes: Uint8Array;
  /** Editable overlay annotations. Omitted for protected documents. */
  annotations?: AnnotationMap;
  lastOpened: number;
  open: boolean;
}

/** Metadata-only list result. Listing a session must never read every PDF. */
export interface StoredDocSummary {
  id: string;
  name: string;
  sourceKey?: string;
  lastOpened: number;
  open: boolean;
  byteLength: number;
}

/** Documents above this size are not written to IndexedDB. Desktop snapshots
 * are ordinary app-data files and do not use this browser quota guard. */
export const MAX_PERSIST_BYTES = 80 * 1024 * 1024;

const DB_NAME = "pickpdf";
const STORE = "docs";
const MAX_WEB_CLOSED_RECENTS = 10;
const MAX_DESKTOP_CLOSED_RECENTS = 20;
const DESKTOP_CACHE_BUDGET = 2 * 1024 * 1024 * 1024;
const SNAPSHOT_DIR = "pickpdf/documents";

/** Pure browser size gate, split out so it remains unit-testable. */
export function exceedsPersistLimit(byteLength: number): boolean {
  return byteLength > MAX_PERSIST_BYTES;
}

export type PersistResult = "stored" | "too-large" | "error";

interface DocumentRepository {
  persist(doc: StoredDoc): Promise<PersistResult>;
  persistAnnotations(
    id: string,
    annotations: AnnotationMap,
    lastOpened: number,
  ): Promise<PersistResult>;
  touch(id: string, lastOpened: number): Promise<void>;
  markClosed(id: string): Promise<void>;
  markAllClosed(): Promise<void>;
  get(id: string): Promise<StoredDoc | undefined>;
  remove(ids: readonly string[]): Promise<boolean>;
  list(): Promise<StoredDocSummary[]>;
}

/* -------------------------------------------------------------------------- */
/* Browser / IndexedDB fallback                                               */
/* -------------------------------------------------------------------------- */

function openBrowserDb(): Promise<IDBDatabase> {
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

function browserTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openBrowserDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

async function browserListFull(): Promise<StoredDoc[]> {
  const all = await browserTx<StoredDoc[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.lastOpened - a.lastOpened);
}

async function pruneBrowser(): Promise<void> {
  const all = await browserListFull();
  // Open session records are never part of the recent-history cap.
  const stale = all.filter((doc) => !doc.open).slice(MAX_WEB_CLOSED_RECENTS);
  for (const doc of stale) {
    await browserTx("readwrite", (store) => store.delete(doc.id));
  }
}

const browserRepository: DocumentRepository = {
  async persist(doc) {
    if (exceedsPersistLimit(doc.bytes.length)) return "too-large";
    try {
      // `annotations: undefined` deliberately clears any previous overlay.
      // Protected documents use that path so cleartext annotation content is
      // never retained after protection is applied.
      await browserTx("readwrite", (store) => store.put(doc));
      await pruneBrowser();
      return "stored";
    } catch {
      return "error";
    }
  },

  async persistAnnotations(id, annotations, lastOpened) {
    try {
      const previous = await browserTx<StoredDoc | undefined>("readonly", (store) =>
        store.get(id),
      );
      if (!previous) return "error";
      await browserTx("readwrite", (store) =>
        store.put({ ...previous, annotations, lastOpened, open: true }),
      );
      return "stored";
    } catch {
      return "error";
    }
  },

  async touch(id, lastOpened) {
    try {
      const previous = await browserTx<StoredDoc | undefined>("readonly", (store) =>
        store.get(id),
      );
      if (previous) {
        await browserTx("readwrite", (store) =>
          store.put({ ...previous, lastOpened, open: true }),
        );
      }
    } catch {
      /* best effort */
    }
  },

  async markClosed(id) {
    try {
      const doc = await browserTx<StoredDoc | undefined>("readonly", (store) =>
        store.get(id),
      );
      if (doc) {
        await browserTx("readwrite", (store) => store.put({ ...doc, open: false }));
      }
      await pruneBrowser();
    } catch {
      /* best effort */
    }
  },

  async markAllClosed() {
    try {
      const all = await browserListFull();
      for (const doc of all.filter((item) => item.open)) {
        await browserTx("readwrite", (store) => store.put({ ...doc, open: false }));
      }
      await pruneBrowser();
    } catch {
      /* best effort */
    }
  },

  async get(id) {
    try {
      return await browserTx<StoredDoc | undefined>("readonly", (store) => store.get(id));
    } catch {
      return undefined;
    }
  },

  async remove(ids) {
    try {
      for (const id of new Set(ids)) {
        await browserTx("readwrite", (store) => store.delete(id));
      }
      return true;
    } catch {
      return false;
    }
  },

  async list() {
    try {
      return (await browserListFull()).map((doc) => ({
        id: doc.id,
        name: doc.name,
        sourceKey: doc.sourceKey,
        lastOpened: doc.lastOpened,
        open: doc.open,
        byteLength: doc.bytes.length,
      }));
    } catch {
      return [];
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Tauri desktop / SQLite metadata + AppLocalData snapshots                    */
/* -------------------------------------------------------------------------- */

interface DesktopRow {
  id: string;
  name: string;
  source_key: string | null;
  pdf_path: string | null;
  annotations_path: string | null;
  byte_length: number;
  last_opened: number;
  is_open: number;
}

type SqlDatabase = import("@tauri-apps/plugin-sql").default;
let desktopDbPromise: Promise<SqlDatabase> | null = null;
let desktopWriteQueue: Promise<unknown> = Promise.resolve();

function queueDesktopWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = desktopWriteQueue.catch(() => undefined).then(task);
  desktopWriteQueue = next;
  return next;
}

async function desktopDb(): Promise<SqlDatabase> {
  if (!desktopDbPromise) {
    desktopDbPromise = (async () => {
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      const db = await Database.load("sqlite:pickpdf.db");
      await db.execute(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          source_key TEXT,
          pdf_path TEXT,
          annotations_path TEXT,
          byte_length INTEGER NOT NULL DEFAULT 0,
          last_opened INTEGER NOT NULL,
          is_open INTEGER NOT NULL DEFAULT 0
        )
      `);
      await db.execute(
        "CREATE INDEX IF NOT EXISTS documents_recent ON documents(last_opened DESC)",
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS documents_open ON documents(is_open, last_opened DESC)",
      );
      await cleanupDesktopOrphans(db);
      return db;
    })().catch((error) => {
      desktopDbPromise = null;
      throw error;
    });
  }
  return desktopDbPromise;
}

async function cleanupDesktopOrphans(db: SqlDatabase): Promise<void> {
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.mkdir(SNAPSHOT_DIR, {
      baseDir: fs.BaseDirectory.AppLocalData,
      recursive: true,
    });
    const rows = await db.select<
      Array<{ pdf_path: string | null; annotations_path: string | null }>
    >("SELECT pdf_path, annotations_path FROM documents");
    const referenced = new Set(
      rows.flatMap((row) => [row.pdf_path, row.annotations_path]).filter(Boolean),
    );
    const entries = await fs.readDir(SNAPSHOT_DIR, {
      baseDir: fs.BaseDirectory.AppLocalData,
    });
    for (const entry of entries) {
      if (!entry.isFile) continue;
      const path = `${SNAPSHOT_DIR}/${entry.name}`;
      if (!referenced.has(path)) {
        await removeDesktopFile(path);
      }
    }
  } catch {
    /* cleanup must never prevent the repository from starting */
  }
}

async function desktopFs() {
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.mkdir(SNAPSHOT_DIR, {
    baseDir: fs.BaseDirectory.AppLocalData,
    recursive: true,
  });
  return fs;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function snapshotPath(id: string, extension: "pdf" | "json"): string {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${SNAPSHOT_DIR}/${safeId(id)}-${nonce}.${extension}`;
}

async function removeDesktopFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.remove(path, { baseDir: fs.BaseDirectory.AppLocalData });
  } catch {
    /* stale/missing cache files are harmless */
  }
}

async function selectDesktopRows(where = "", params: unknown[] = []): Promise<DesktopRow[]> {
  const db = await desktopDb();
  return db.select<DesktopRow[]>(
    `SELECT id, name, source_key, pdf_path, annotations_path, byte_length,
            last_opened, is_open
       FROM documents ${where}`,
    params,
  );
}

async function deleteDesktopRows(rows: DesktopRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await desktopDb();
  for (const row of rows) {
    await db.execute("DELETE FROM documents WHERE id = $1", [row.id]);
    await Promise.all([
      removeDesktopFile(row.pdf_path),
      removeDesktopFile(row.annotations_path),
    ]);
  }
}

async function pruneDesktop(): Promise<void> {
  const closed = await selectDesktopRows(
    "WHERE is_open = 0 ORDER BY last_opened DESC",
  );
  const all = await selectDesktopRows("ORDER BY last_opened DESC");
  let total = all.reduce((sum, row) => sum + Number(row.byte_length || 0), 0);
  const stale = new Map<string, DesktopRow>();

  for (const row of closed.slice(MAX_DESKTOP_CLOSED_RECENTS)) stale.set(row.id, row);
  for (const row of [...closed].reverse()) {
    if (total <= DESKTOP_CACHE_BUDGET) break;
    stale.set(row.id, row);
    total -= Number(row.byte_length || 0);
  }
  await deleteDesktopRows([...stale.values()]);
}

const desktopRepository: DocumentRepository = {
  persist(doc) {
    return queueDesktopWrite(async () => {
      let newPdfPath: string | null = null;
      let newAnnotationsPath: string | null = null;
      try {
        const db = await desktopDb();
        const fs = await desktopFs();
        const previous = (
          await selectDesktopRows("WHERE id = $1 LIMIT 1", [doc.id])
        )[0];

        newPdfPath = snapshotPath(doc.id, "pdf");
        await fs.writeFile(newPdfPath, doc.bytes, {
          baseDir: fs.BaseDirectory.AppLocalData,
        });

        if (doc.annotations !== undefined) {
          newAnnotationsPath = snapshotPath(doc.id, "json");
          await fs.writeFile(
            newAnnotationsPath,
            new TextEncoder().encode(JSON.stringify(doc.annotations)),
            { baseDir: fs.BaseDirectory.AppLocalData },
          );
        }

        const annotationsPath = newAnnotationsPath;
        await db.execute(
          `INSERT INTO documents (
             id, name, source_key, pdf_path, annotations_path,
             byte_length, last_opened, is_open
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             source_key = excluded.source_key,
             pdf_path = excluded.pdf_path,
             annotations_path = excluded.annotations_path,
             byte_length = excluded.byte_length,
             last_opened = excluded.last_opened,
             is_open = excluded.is_open`,
          [
            doc.id,
            doc.name,
            doc.sourceKey ?? null,
            newPdfPath,
            annotationsPath,
            doc.bytes.length,
            doc.lastOpened,
            doc.open ? 1 : 0,
          ],
        );

        await removeDesktopFile(previous?.pdf_path);
        if (previous?.annotations_path !== newAnnotationsPath) {
          await removeDesktopFile(previous?.annotations_path);
        }
        await pruneDesktop();
        return "stored" as const;
      } catch {
        await Promise.all([
          removeDesktopFile(newPdfPath),
          removeDesktopFile(newAnnotationsPath),
        ]);
        return "error" as const;
      }
    });
  },

  persistAnnotations(id, annotations, lastOpened) {
    return queueDesktopWrite(async () => {
      let newAnnotationsPath: string | null = null;
      try {
        const db = await desktopDb();
        const fs = await desktopFs();
        const previous = (
          await selectDesktopRows("WHERE id = $1 LIMIT 1", [id])
        )[0];
        if (!previous) return "error" as const;

        newAnnotationsPath = snapshotPath(id, "json");
        await fs.writeFile(
          newAnnotationsPath,
          new TextEncoder().encode(JSON.stringify(annotations)),
          { baseDir: fs.BaseDirectory.AppLocalData },
        );
        await db.execute(
          `UPDATE documents
             SET annotations_path = $1, last_opened = $2, is_open = 1
           WHERE id = $3`,
          [newAnnotationsPath, lastOpened, id],
        );
        await removeDesktopFile(previous.annotations_path);
        return "stored" as const;
      } catch {
        await removeDesktopFile(newAnnotationsPath);
        return "error" as const;
      }
    });
  },

  touch(id, lastOpened) {
    return queueDesktopWrite(async () => {
      try {
        const db = await desktopDb();
        await db.execute(
          "UPDATE documents SET last_opened = $1, is_open = 1 WHERE id = $2",
          [lastOpened, id],
        );
      } catch {
        /* best effort */
      }
    });
  },

  markClosed(id) {
    return queueDesktopWrite(async () => {
      try {
        const db = await desktopDb();
        await db.execute("UPDATE documents SET is_open = 0 WHERE id = $1", [id]);
        await pruneDesktop();
      } catch {
        /* best effort */
      }
    });
  },

  markAllClosed() {
    return queueDesktopWrite(async () => {
      try {
        const db = await desktopDb();
        await db.execute("UPDATE documents SET is_open = 0");
        await pruneDesktop();
      } catch {
        /* best effort */
      }
    });
  },

  async get(id) {
    try {
      await desktopWriteQueue.catch(() => undefined);
      const row = (await selectDesktopRows("WHERE id = $1 LIMIT 1", [id]))[0];
      if (!row?.pdf_path) return undefined;
      const fs = await import("@tauri-apps/plugin-fs");
      const bytes = await fs.readFile(row.pdf_path, {
        baseDir: fs.BaseDirectory.AppLocalData,
      });
      let annotations: AnnotationMap | undefined;
      if (row.annotations_path) {
        try {
          const encoded = await fs.readFile(row.annotations_path, {
            baseDir: fs.BaseDirectory.AppLocalData,
          });
          annotations = JSON.parse(new TextDecoder().decode(encoded)) as AnnotationMap;
        } catch {
          annotations = undefined;
        }
      }
      return {
        id: row.id,
        name: row.name,
        sourceKey: row.source_key ?? undefined,
        bytes,
        annotations,
        lastOpened: Number(row.last_opened),
        open: !!row.is_open,
      };
    } catch {
      return undefined;
    }
  },

  remove(ids) {
    return queueDesktopWrite(async () => {
      try {
        const unique = [...new Set(ids)];
        for (const id of unique) {
          const rows = await selectDesktopRows("WHERE id = $1", [id]);
          await deleteDesktopRows(rows);
        }
        return true;
      } catch {
        return false;
      }
    });
  },

  async list() {
    try {
      await desktopWriteQueue.catch(() => undefined);
      const rows = await selectDesktopRows("ORDER BY last_opened DESC");
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sourceKey: row.source_key ?? undefined,
        lastOpened: Number(row.last_opened),
        open: !!row.is_open,
        byteLength: Number(row.byte_length),
      }));
    } catch {
      return [];
    }
  },
};

function repository(): DocumentRepository {
  return isTauri ? desktopRepository : browserRepository;
}

export function persistDoc(doc: StoredDoc): Promise<PersistResult> {
  return repository().persist(doc);
}

/** Persist overlay changes without rewriting an unchanged desktop PDF file. */
export function persistAnnotations(
  id: string,
  annotations: AnnotationMap,
  lastOpened = Date.now(),
): Promise<PersistResult> {
  return repository().persistAnnotations(id, annotations, lastOpened);
}

export function markDocClosed(id: string): Promise<void> {
  return repository().markClosed(id);
}

export function touchStoredDoc(id: string, lastOpened = Date.now()): Promise<void> {
  return repository().touch(id, lastOpened);
}

export function markAllClosed(): Promise<void> {
  return repository().markAllClosed();
}

export function getStoredDoc(id: string): Promise<StoredDoc | undefined> {
  return repository().get(id);
}

/** Remove PickPDF history/cache records only. Original files are untouched. */
export function removeStoredDocs(ids: readonly string[]): Promise<boolean> {
  return repository().remove(ids);
}

/** Metadata-only and sorted most-recent-first. */
export function listStoredDocs(): Promise<StoredDocSummary[]> {
  return repository().list();
}

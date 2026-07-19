// Resumable, offline cache for the on-device LLM's model files.
//
// Transformers.js normally stores whole files in the browser's Cache Storage,
// but the Cache API can only persist a *complete* response — so refreshing the
// page mid-download throws away the in-flight bytes and the (multi-GB) weight
// file restarts from zero.
//
// Instead we intercept the worker's model-file fetches and stream them through
// IndexedDB in chunks. Finished files load straight from disk (offline, no
// network); an interrupted download resumes from the last flushed byte via an
// HTTP `Range` request. Because we key everything by URL we don't depend on any
// Transformers.js internals or the exact weight-shard filenames.
//
// This module runs inside the Web Worker (browserLlm.worker.ts). IndexedDB,
// fetch and ReadableStream are all available there.

const DB_NAME = "pickpdf-model-cache";
const DB_VERSION = 1;
const META_STORE = "meta";
const CHUNK_STORE = "chunks";
/** Persist roughly this many bytes per IndexedDB write (bounds write churn). */
const FLUSH_BYTES = 8 * 1024 * 1024;

interface Meta {
  url: string;
  /** Full file size in bytes (0 when the server didn't report a length). */
  total: number;
  /** Bytes durably written to IndexedDB so far — the byte to resume from. */
  received: number;
  /** Number of chunk records stored for this URL (chunk keys are 0…count-1). */
  chunkCount: number;
  done: boolean;
  etag?: string;
  lastModified?: string;
}

/** Only model files come from the Hugging Face hub — leave everything else alone. */
function isModelUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "huggingface.co" || h.endsWith(".huggingface.co") || h === "hf.co";
  } catch {
    return false;
  }
}

// ---- IndexedDB plumbing ----------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(META_STORE)) {
          d.createObjectStore(META_STORE, { keyPath: "url" });
        }
        if (!d.objectStoreNames.contains(CHUNK_STORE)) {
          d.createObjectStore(CHUNK_STORE, { keyPath: ["url", "seq"] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getMeta(url: string): Promise<Meta | undefined> {
  const d = await db();
  return reqP<Meta | undefined>(
    d.transaction(META_STORE, "readonly").objectStore(META_STORE).get(url),
  );
}

async function putMeta(m: Meta): Promise<void> {
  const d = await db();
  const tx = d.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(m);
  await txDone(tx);
}

/** Write one chunk and advance the meta record in a single atomic transaction. */
async function writeChunk(seq: number, data: ArrayBuffer, meta: Meta): Promise<void> {
  const d = await db();
  const tx = d.transaction([CHUNK_STORE, META_STORE], "readwrite");
  tx.objectStore(CHUNK_STORE).put({ url: meta.url, seq, data });
  tx.objectStore(META_STORE).put(meta);
  await txDone(tx);
}

async function getChunk(url: string, seq: number): Promise<ArrayBuffer | undefined> {
  const d = await db();
  const rec = await reqP<{ data: ArrayBuffer } | undefined>(
    d.transaction(CHUNK_STORE, "readonly").objectStore(CHUNK_STORE).get([url, seq]),
  );
  return rec?.data;
}

async function clearUrl(url: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([CHUNK_STORE, META_STORE], "readwrite");
  tx.objectStore(META_STORE).delete(url);
  tx.objectStore(CHUNK_STORE).delete(
    IDBKeyRange.bound([url, 0], [url, Number.MAX_SAFE_INTEGER]),
  );
  await txDone(tx);
}

// ---- Streaming -------------------------------------------------------------

function concat(parts: Uint8Array[], len: number): Uint8Array {
  const out = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Adapt an async byte iterator into a ReadableStream body. */
function streamFrom(it: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await it.return?.(undefined as never);
    },
  });
}

/** Yield the bytes already saved to IndexedDB, in order. */
async function* replayStored(url: string, chunkCount: number): AsyncGenerator<Uint8Array> {
  for (let seq = 0; seq < chunkCount; seq++) {
    const buf = await getChunk(url, seq);
    if (buf) yield new Uint8Array(buf);
  }
}

/**
 * Emit the stored prefix, then pump the network body — persisting each chunk to
 * IndexedDB so a later refresh resumes from here rather than restarting.
 */
async function* downloadAndPersist(
  meta: Meta,
  netBody: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const prefixChunks = meta.chunkCount;
  yield* replayStored(meta.url, prefixChunks);

  const reader = netBody.getReader();
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  let completed = false;
  const flush = async (done = false) => {
    if (!pendingLen) {
      if (done) {
        meta.done = true;
        if (!meta.total) meta.total = meta.received;
        await putMeta(meta);
      }
      return;
    }
    const merged = concat(pending, pendingLen);
    pending = [];
    pendingLen = 0;
    meta.chunkCount += 1;
    meta.received += merged.length;
    meta.done = done;
    if (done && !meta.total) meta.total = meta.received;
    await writeChunk(meta.chunkCount - 1, merged.buffer as ArrayBuffer, meta);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
      pending.push(value);
      pendingLen += value.length;
      if (pendingLen >= FLUSH_BYTES) await flush();
    }
    // The final bytes and the `done` bit commit atomically whenever possible.
    // If the last regular flush landed exactly on EOF, resume recovery below
    // also recognizes received === total as complete.
    await flush(true);
    completed = true;
  } finally {
    if (!completed) {
      // Preserve bytes already delivered to the model before cancellation.
      await flush(false).catch(() => {});
      await reader.cancel().catch(() => {});
    }
  }
}

function responseFrom(
  it: AsyncGenerator<Uint8Array>,
  total: number,
  contentType: string,
): Response {
  const headers: Record<string, string> = { "Content-Type": contentType };
  // Content-Length lets Transformers.js compute an accurate download percentage.
  if (total > 0) headers["Content-Length"] = String(total);
  return new Response(streamFrom(it), { status: 200, headers });
}

// ---- Public entry point ----------------------------------------------------

/** Serve a model file from IndexedDB, resuming or starting the download as needed. */
async function cachedModelFetch(url: string, netFetch: typeof fetch): Promise<Response> {
  let meta = await getMeta(url);

  if (meta && meta.total > 0 && meta.received > meta.total) {
    await clearUrl(url);
    meta = undefined;
  }

  // A worker can be terminated after the final chunk transaction but before a
  // separate completion update. Treat an exact durable byte count as complete.
  if (meta && !meta.done && meta.total > 0 && meta.received === meta.total) {
    meta.done = true;
    await putMeta(meta);
  }

  // Already fully downloaded — serve straight from disk, no network at all.
  if (meta?.done) {
    return responseFrom(
      replayStored(url, meta.chunkCount),
      meta.total,
      "application/octet-stream",
    );
  }

  let start = meta?.received ?? 0;
  const headers: Record<string, string> = {};
  if (start > 0) {
    headers.Range = `bytes=${start}-`;
    const validator = meta?.etag ?? meta?.lastModified;
    if (validator) headers["If-Range"] = validator;
  }
  const init: RequestInit = { headers };
  let res = await netFetch(url, init);

  // Range-at-EOF is the common crash window described above. If metadata does
  // not prove completeness, discard the partial rather than returning a 416
  // that will poison every subsequent retry.
  if (start > 0 && res.status === 416) {
    if (meta && meta.total > 0 && meta.received === meta.total) {
      meta.done = true;
      await putMeta(meta);
      return responseFrom(
        replayStored(url, meta.chunkCount),
        meta.total,
        "application/octet-stream",
      );
    }
    await clearUrl(url);
    meta = undefined;
    start = 0;
    res = await netFetch(url, {});
  }

  // Server ignored our Range and sent the whole file (200, not 206) — the
  // partial can't be trusted as a prefix, so start over cleanly.
  if (start > 0 && res.status === 200) {
    await clearUrl(url);
    meta = undefined;
    start = 0;
  }

  // Not a cacheable success (e.g. 404) — hand the raw response back untouched.
  if (!res.ok || !res.body) return res;

  // Resume sanity check: if the server's total no longer matches what we saved,
  // the file changed under us — discard and re-download from scratch.
  if (meta && res.status === 206) {
    const match = res.headers
      .get("content-range")
      ?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    const serverStart = Number(match?.[1] ?? -1);
    const serverTotal = match?.[3] === "*" ? 0 : Number(match?.[3] ?? 0);
    if (
      !match ||
      serverStart !== start ||
      (serverTotal > 0 && meta.total > 0 && serverTotal !== meta.total)
    ) {
      await clearUrl(url);
      meta = undefined;
      start = 0;
      res = await netFetch(url, {});
      if (!res.ok || !res.body) return res;
    } else if (!meta.total && serverTotal > 0) {
      meta.total = serverTotal;
      await putMeta(meta);
    }
  }

  // Establish the full size and a meta record for a fresh download.
  let total: number;
  if (meta) {
    total = meta.total;
  } else {
    const len = Number(res.headers.get("content-length") ?? 0);
    const rangeTotal = Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
    total = rangeTotal || len;
    meta = {
      url,
      total,
      received: 0,
      chunkCount: 0,
      done: false,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
    await putMeta(meta);
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return responseFrom(downloadAndPersist(meta, res.body), total, contentType);
}

/**
 * Route the worker's Hugging Face model-file GETs through the resumable cache.
 * Everything else falls through to the platform fetch untouched. Idempotent.
 */
export function installResumableModelCache(): void {
  const scope = self as unknown as { __modelCacheInstalled?: boolean; fetch: typeof fetch };
  if (scope.__modelCacheInstalled) return;
  scope.__modelCacheInstalled = true;

  const original = self.fetch.bind(self);
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (method === "GET" && isModelUrl(url)) return cachedModelFetch(url, original);
    } catch {
      /* fall through to the platform fetch */
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}

// Install immediately on import. This module is imported before
// @huggingface/transformers in the worker so the patch is in place before that
// library captures a reference to `fetch`.
installResumableModelCache();

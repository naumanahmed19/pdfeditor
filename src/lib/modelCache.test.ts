// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DB_NAME = "pickpdf-model-cache";
const URL = "https://huggingface.co/test/model/resolve/main/model.onnx";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function markStoredFileIncomplete(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        const get = store.get(URL);
        get.onsuccess = () => store.put({ ...get.result, done: false });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

describe("resumable model cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("recovers a final chunk whose completion bit was not committed", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const networkFetch = vi.fn(async () =>
      new Response(bytes, {
        status: 200,
        headers: {
          "Content-Length": String(bytes.length),
          "Content-Type": "application/octet-stream",
          ETag: '"revision-1"',
        },
      }),
    );
    vi.stubGlobal("fetch", networkFetch);
    await import("./modelCache");

    expect(new Uint8Array(await (await fetch(URL)).arrayBuffer())).toEqual(bytes);
    expect(networkFetch).toHaveBeenCalledTimes(1);

    // Simulate termination after all durable bytes landed but before `done`.
    await markStoredFileIncomplete();
    networkFetch.mockClear();

    expect(new Uint8Array(await (await fetch(URL)).arrayBuffer())).toEqual(bytes);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});

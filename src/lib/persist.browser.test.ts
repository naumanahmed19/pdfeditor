import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoredDoc,
  listStoredDocs,
  markDocClosed,
  persistAnnotations,
  persistDoc,
  type StoredDoc,
} from "./persist";

function resetDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("pickpdf");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB reset was blocked"));
  });
}

function doc(index: number): StoredDoc {
  return {
    id: `doc-${index}`,
    name: `document-${index}.pdf`,
    sourceKey: `source-${index}`,
    bytes: new Uint8Array([index]),
    lastOpened: index,
    open: true,
  };
}

beforeEach(async () => {
  await resetDb();
});

describe("browser document repository", () => {
  it("never applies the closed-recent cap to open documents", async () => {
    for (let index = 0; index < 12; index += 1) {
      await expect(persistDoc(doc(index))).resolves.toBe("stored");
    }

    expect(await listStoredDocs()).toHaveLength(12);

    for (let index = 0; index < 12; index += 1) {
      await markDocClosed(`doc-${index}`);
    }

    const remaining = await listStoredDocs();
    expect(remaining).toHaveLength(10);
    expect(remaining.map((item) => item.id)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `doc-${11 - offset}`),
    );
  });

  it("updates annotations without replacing the PDF snapshot", async () => {
    await persistDoc(doc(1));
    const annotations = {
      0: [
        {
          id: "note-1",
          kind: "note" as const,
          x: 10,
          y: 20,
          w: 24,
          h: 24,
          text: "Remember this",
          color: "#facc15",
        },
      ],
    };

    await expect(persistAnnotations("doc-1", annotations, 99)).resolves.toBe(
      "stored",
    );
    const stored = await getStoredDoc("doc-1");
    expect(stored?.bytes).toEqual(new Uint8Array([1]));
    expect(stored?.annotations).toEqual(annotations);
    expect(stored?.lastOpened).toBe(99);
  });
});

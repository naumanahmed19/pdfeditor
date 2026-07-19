import { afterEach, describe, expect, it, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: unknown[] = [];
  terminated = false;
  private messageListeners = new Set<(event: MessageEvent) => void>();
  private errorListeners = new Set<(event: ErrorEvent) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
    } else if (type === "error") {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  postMessage(message: { id: number }, _transfer: Transferable[]): void {
    this.messages.push(message);
    const output = new Uint8Array([9, 8, 7]);
    queueMicrotask(() => {
      const event = { data: { id: message.id, bytes: output } } as MessageEvent;
      for (const listener of this.messageListeners) listener(event);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(async () => {
  const module = await import("./pdfEditWorker");
  module.resetPdfEditWorker();
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("PDF edit worker client", () => {
  it("runs a mutation in a worker without detaching the store bytes", async () => {
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    const { editPdfInBackground } = await import("./pdfEditWorker");
    const input = new Uint8Array([1, 2, 3]);

    const output = await editPdfInBackground(input, {
      type: "transformObject",
      pageIndex: 0,
      objectIndex: 4,
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 12, f: -3 },
    });

    expect([...output]).toEqual([9, 8, 7]);
    expect([...input]).toEqual([1, 2, 3]);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].messages).toMatchObject([
      {
        operations: [
          {
            type: "transformObject",
            pageIndex: 0,
            objectIndex: 4,
          },
        ],
      },
    ]);
  });

  it("sends a journal in one worker request", async () => {
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    const { editPdfsInBackground } = await import("./pdfEditWorker");

    await editPdfsInBackground(new Uint8Array([1]), [
      {
        type: "transformObject",
        pageIndex: 0,
        objectIndex: 2,
        matrix: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 },
      },
      {
        type: "setObjectStyle",
        pageIndex: 0,
        objectIndex: 2,
        style: { fill: [1, 2, 3, 255] },
      },
    ]);

    expect(FakeWorker.instances[0].messages).toMatchObject([
      { operations: [{ type: "transformObject" }, { type: "setObjectStyle" }] },
    ]);
  });
});

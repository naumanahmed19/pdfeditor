// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserModelConfig } from "./modelConfig";

const model: BrowserModelConfig = {
  id: "test-model",
  repo: "test/model",
  name: "Test Model",
  dtype: { webgpu: "q4", wasm: "q4" },
  sizeLabel: "1 MB",
  mobileSafe: true,
  toolCalling: "prompted",
  blurb: "test",
};

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  messages: Array<Record<string, unknown>> = [];
  terminated = false;

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

describe("browser LLM worker lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("routes progress and completion by request id", async () => {
    const { preloadBrowserModel } = await import("./browserLlm");
    const progress = vi.fn();
    const pending = preloadBrowserModel(model, progress);
    const worker = FakeWorker.instances[0];
    const requestId = String(worker.messages[0].requestId);

    worker.emit({ type: "progress", requestId: "another-request", loaded: 5, total: 10 });
    expect(progress).not.toHaveBeenCalled();

    worker.emit({ type: "progress", requestId, loaded: 5, total: 10 });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "downloading", pct: 50 }),
    );

    worker.emit({ type: "ready", requestId, modelId: model.id, device: "wasm" });
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects pending work when the worker crashes", async () => {
    const { preloadBrowserModel } = await import("./browserLlm");
    const pending = preloadBrowserModel(model, vi.fn());
    const worker = FakeWorker.instances[0];

    worker.dispatchEvent(new ErrorEvent("error", { message: "worker crashed" }));

    await expect(pending).rejects.toThrow("worker crashed");
    expect(worker.terminated).toBe(true);
  });

  it("rejects pending work when the engine is reset", async () => {
    const { preloadBrowserModel, resetBrowserEngine } = await import("./browserLlm");
    const pending = preloadBrowserModel(model, vi.fn());

    resetBrowserEngine(new Error("model changed"));

    await expect(pending).rejects.toThrow("model changed");
  });

  it("turns ONNX allocation failures into an actionable lighter-model error", async () => {
    const { preloadBrowserModel } = await import("./browserLlm");
    const pending = preloadBrowserModel(model, vi.fn());
    const worker = FakeWorker.instances[0];
    const requestId = String(worker.messages[0].requestId);

    worker.emit({
      type: "error",
      requestId,
      message: "failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc",
    });

    await expect(pending).rejects.toThrow(/Choose Gemma 3 1B or Qwen2\.5 0\.5B/);
  });

  it("routes and validates a local editor tool call", async () => {
    const { routeBrowserEditorTool } = await import("./browserLlm");
    const pending = routeBrowserEditorTool(model, "go to page 3", {
      currentPage: 1,
      totalPages: 10,
      zoomPercent: 100,
    });
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];
    const requestId = String(request.requestId);

    expect(request.type).toBe("route_tool");
    expect(request.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "navigate_to_page" }) }),
    ]));

    worker.emit({ type: "ready", requestId, modelId: model.id, device: "wasm" });
    worker.emit({
      type: "tool_result",
      requestId,
      text: '{"name":"navigate_to_page","arguments":{"page":3}}',
    });

    await expect(pending).resolves.toEqual({
      name: "navigate_to_page",
      arguments: { page: 3 },
    });
  });
});

import { describe, expect, it } from "vitest";
import { mayBeEditorCommand, parseEditorToolCall } from "./aiTools";

describe("editor tool routing", () => {
  it("parses Qwen/OpenAI-style tool calls", () => {
    expect(
      parseEditorToolCall(
        '<tool_call>{"name":"navigate_to_page","arguments":{"page":3}}</tool_call>',
      ),
    ).toEqual({ name: "navigate_to_page", arguments: { page: 3 } });
  });

  it("parses Gemma-native calls", () => {
    expect(parseEditorToolCall("call:fit_view{mode:<escape>width<escape>}")).toEqual({
      name: "fit_view",
      arguments: { mode: "width" },
    });
  });

  it("parses and bounds document searches", () => {
    expect(
      parseEditorToolCall(
        '<tool_call>{"name":"search_document","arguments":{"query":"annual revenue"}}</tool_call>',
      ),
    ).toEqual({ name: "search_document", arguments: { query: "annual revenue" } });
  });

  it("rejects unknown tools and unsafe arguments", () => {
    expect(parseEditorToolCall('{"name":"delete_document","arguments":{}}')).toBeNull();
    expect(
      parseEditorToolCall('{"name":"set_zoom","arguments":{"percent":9999}}'),
    ).toBeNull();
  });

  it("gates commands without treating document questions as actions", () => {
    expect(mayBeEditorCommand("zoom to 150 percent")).toBe(true);
    expect(mayBeEditorCommand("nevigate to 50")).toBe(true);
    expect(mayBeEditorCommand("highlight every invoice number")).toBe(true);
    expect(mayBeEditorCommand("what does page 3 say?")).toBe(false);
  });
});

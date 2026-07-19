import type { BrowserModelConfig } from "./modelConfig";

export type EditorToolCall =
  | { name: "navigate_to_page"; arguments: { page: number } }
  | { name: "set_zoom"; arguments: { percent: number } }
  | { name: "fit_view"; arguments: { mode: "page" | "width" } }
  | { name: "search_document"; arguments: { query: string } };

export const EDITOR_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "navigate_to_page",
      description:
        "Move the PDF viewer to a specific page. Use for go, jump, open, show, next, or previous page commands.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "integer", description: "One-based destination page number." },
        },
        required: ["page"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_zoom",
      description: "Set the PDF viewer zoom percentage.",
      parameters: {
        type: "object",
        properties: {
          percent: { type: "number", description: "Zoom from 25 through 500 percent." },
        },
        required: ["percent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fit_view",
      description: "Fit either the whole page or the page width in the viewer.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["page", "width"] },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_document",
      description:
        "Search the open PDF and temporarily highlight every matching occurrence. Use for find, search, locate, or highlight occurrences. This does not modify the PDF.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Exact text or phrase to find." },
        },
        required: ["query"],
      },
    },
  },
] as const;

/** Normalize common command typos before routing, without altering PDF questions. */
export function normalizeEditorCommand(input: string): string {
  return input
    .replace(/\b(?:nevigate|naviagte|nagivate|navigete)\b/gi, "navigate")
    .replace(/\bzoon\b/gi, "zoom");
}

/** Cheap gate that avoids a second model pass for ordinary document questions. */
export function mayBeEditorCommand(input: string): boolean {
  return /\b(?:go|jump|navigate|open|show|take me|next|previous|zoom|fit|actual size|search|find|locate|highlight)\b/i.test(
    normalizeEditorCommand(input),
  );
}

export function editorToolMessages(
  model: BrowserModelConfig,
  input: string,
  state: { currentPage: number; totalPages: number; zoomPercent: number },
): Array<{ role: "system" | "user"; content: string }> {
  const stateJson = JSON.stringify(state);
  const base =
    "You route commands for a PDF editor. Call exactly one supplied tool only when the user asks the application to perform an action. " +
    "Questions about PDF content are not actions. Never invent tools or arguments. " +
    `Current editor state: ${stateJson}.`;
  const prompted =
    model.toolCalling === "prompted"
      ? ` Return only {"name":"tool_name","arguments":{...}} or {"name":"none","arguments":{}}. Available tools: ${JSON.stringify(EDITOR_TOOL_DEFINITIONS)}.`
      : " If no tool applies, reply with NONE.";
  return [
    { role: "system", content: base + prompted },
    { role: "user", content: normalizeEditorCommand(input) },
  ];
}

function parseJsonCall(text: string): { name?: unknown; arguments?: unknown } | null {
  const candidates = [
    text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i)?.[1],
    text.match(/\{[\s\S]*\}/)?.[0],
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the model-native Gemma syntax next */
    }
  }
  return null;
}

function parseGemmaCall(text: string): { name: string; arguments: Record<string, unknown> } | null {
  const match = text.match(/call:([a-z_]\w*)\s*\{([\s\S]*?)\}/i);
  if (!match) return null;
  const args: Record<string, unknown> = {};
  const argumentPattern = /(\w+)\s*:\s*(?:<escape>(.*?)<escape>|"([^"]*)"|(-?\d+(?:\.\d+)?)|([a-z_]+))/gi;
  for (const part of match[2].matchAll(argumentPattern)) {
    const value = part[2] ?? part[3] ?? part[4] ?? part[5] ?? "";
    args[part[1]] = part[4] !== undefined ? Number(value) : value;
  }
  return { name: match[1], arguments: args };
}

/** Parse and schema-check model output before it reaches editor state. */
export function parseEditorToolCall(raw: string): EditorToolCall | null {
  const parsed = parseJsonCall(raw) ?? parseGemmaCall(raw);
  if (!parsed || typeof parsed.name !== "string") return null;
  const args =
    parsed.arguments && typeof parsed.arguments === "object"
      ? (parsed.arguments as Record<string, unknown>)
      : {};

  if (parsed.name === "navigate_to_page") {
    const page = Number(args.page);
    return Number.isSafeInteger(page) && page > 0
      ? { name: parsed.name, arguments: { page } }
      : null;
  }
  if (parsed.name === "set_zoom") {
    const percent = Number(args.percent);
    return Number.isFinite(percent) && percent >= 25 && percent <= 500
      ? { name: parsed.name, arguments: { percent } }
      : null;
  }
  if (parsed.name === "fit_view") {
    return args.mode === "page" || args.mode === "width"
      ? { name: parsed.name, arguments: { mode: args.mode } }
      : null;
  }
  if (parsed.name === "search_document") {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
    return query ? { name: parsed.name, arguments: { query } } : null;
  }
  return null;
}

import {
  Check,
  Circle,
  Cloud,
  Eraser,
  Hand,
  Highlighter,
  LandPlot,
  Link2,
  MessageSquare,
  MessageSquareQuote,
  Minus,
  MousePointer2,
  Move,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Pentagon,
  Route,
  Ruler,
  Spline,
  Square,
  SquareSlash,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { ToolKind } from "../../types";

export type EditorToolGroupId =
  | "basic"
  | "text"
  | "markup"
  | "shapes"
  | "measure"
  | "cleanup";

export type EditorToolDefinition = {
  key: ToolKind;
  group: EditorToolGroupId;
  icon: LucideIcon;
  name: string;
  description: string;
  shortcut?: string;
  aliases?: string[];
};

export const EDITOR_TOOL_GROUPS: ReadonlyArray<{
  id: EditorToolGroupId;
  label: string;
}> = [
  { id: "basic", label: "Basic" },
  { id: "text", label: "Text" },
  { id: "markup", label: "Markup" },
  { id: "shapes", label: "Shapes" },
  { id: "measure", label: "Measure" },
  { id: "cleanup", label: "Cleanup" },
];

export const EDITOR_TOOLS: ReadonlyArray<EditorToolDefinition> = [
  { key: "read", group: "basic", icon: MousePointer2, name: "Read", description: "Select and copy text, and follow links", shortcut: "V", aliases: ["view", "browse"] },
  { key: "pan", group: "basic", icon: Hand, name: "Pan", description: "Drag to scroll the page", aliases: ["hand"] },
  { key: "select", group: "basic", icon: Move, name: "Move / select", description: "Select and move annotations, page objects, or form fields", shortcut: "M", aliases: ["move", "objects"] },
  { key: "text", group: "text", icon: Type, name: "Add text", description: "Place a new text box on the page", shortcut: "T" },
  { key: "edittext", group: "text", icon: TextCursorInput, name: "Edit text", description: "Retype existing PDF text", shortcut: "E" },
  { key: "highlight", group: "markup", icon: Highlighter, name: "Highlight", description: "Highlight selected text or an area", shortcut: "H" },
  { key: "underline", group: "markup", icon: Underline, name: "Underline text", description: "Underline existing PDF text", shortcut: "U" },
  { key: "strikeout", group: "markup", icon: Strikethrough, name: "Strike through text", description: "Strike out existing PDF text", shortcut: "S", aliases: ["strikethrough"] },
  { key: "squiggly", group: "markup", icon: Waves, name: "Squiggly underline", description: "Add a squiggly underline to text" },
  { key: "note", group: "markup", icon: MessageSquare, name: "Comment", description: "Add a sticky note comment", shortcut: "C", aliases: ["note"] },
  { key: "ink", group: "markup", icon: Pencil, name: "Draw freehand", description: "Draw freehand ink strokes", shortcut: "D", aliases: ["draw", "pen"] },
  { key: "mark", group: "markup", icon: Check, name: "Check / cross", description: "Stamp a checkmark or cross", shortcut: "Y", aliases: ["tick"] },
  { key: "link", group: "markup", icon: Link2, name: "Link", description: "Draw a clickable link area", shortcut: "N" },
  { key: "rect", group: "shapes", icon: Square, name: "Rectangle", description: "Draw a rectangle", shortcut: "R" },
  { key: "ellipse", group: "shapes", icon: Circle, name: "Ellipse", description: "Draw an ellipse", shortcut: "O" },
  { key: "line", group: "shapes", icon: Minus, name: "Line", description: "Draw a straight line", shortcut: "L" },
  { key: "arrow", group: "shapes", icon: MoveUpRight, name: "Arrow", description: "Draw an arrow", shortcut: "A" },
  { key: "polygon", group: "shapes", icon: Pentagon, name: "Polygon", description: "Place corners, then press Enter or double-click to close", shortcut: "P" },
  { key: "polyline", group: "shapes", icon: Spline, name: "Polyline", description: "Place points, then press Enter or double-click to finish", aliases: ["path"] },
  { key: "cloud", group: "shapes", icon: Cloud, name: "Cloud", description: "Draw a scalloped review cloud", aliases: ["revision"] },
  { key: "callout", group: "shapes", icon: MessageSquareQuote, name: "Callout", description: "Draw a callout note with a pointer", shortcut: "K" },
  { key: "measuredist", group: "measure", icon: Ruler, name: "Distance", description: "Measure a straight-line distance", aliases: ["measure", "length", "calibrate"] },
  { key: "measureperim", group: "measure", icon: Route, name: "Perimeter", description: "Measure along a multi-point path", aliases: ["measure"] },
  { key: "measurearea", group: "measure", icon: LandPlot, name: "Area", description: "Measure an enclosed area", aliases: ["measure", "surface"] },
  { key: "whiteout", group: "cleanup", icon: PaintBucket, name: "Whiteout", description: "Cover page content with a filled box", shortcut: "W" },
  { key: "eraser", group: "cleanup", icon: Eraser, name: "Eraser", description: "Delete annotations by clicking or dragging over them" },
  { key: "redact", group: "cleanup", icon: SquareSlash, name: "Redact", description: "Mark content for permanent removal", shortcut: "X" },
];

export const BASIC_EDITOR_TOOLS = EDITOR_TOOLS.filter(
  (tool) => tool.group === "basic",
);

const TOOL_BY_KEY = new Map(EDITOR_TOOLS.map((tool) => [tool.key, tool]));

export function getEditorTool(key: ToolKind): EditorToolDefinition {
  const tool = findEditorTool(key);
  if (!tool) throw new Error(`Unknown editor tool: ${key}`);
  return tool;
}

export function findEditorTool(
  key: ToolKind,
): EditorToolDefinition | undefined {
  return TOOL_BY_KEY.get(key);
}

type EditorToolSelectionActions = {
  setTool: (tool: ToolKind) => void;
  setPendingStamp: (stamp: null) => void;
  setSelected: (selected: null) => void;
};

export function selectEditorTool(
  actions: EditorToolSelectionActions,
  key: ToolKind,
): void {
  if (
    key === "highlight" ||
    key === "underline" ||
    key === "strikeout" ||
    key === "squiggly"
  ) {
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode?.parentElement?.closest(".textLayer")
    ) {
      window.dispatchEvent(
        new CustomEvent("pdfwb:highlight-selection", { detail: { style: key } }),
      );
      return;
    }
  }

  actions.setTool(key);
  actions.setPendingStamp(null);
  if (key !== "select") actions.setSelected(null);
}

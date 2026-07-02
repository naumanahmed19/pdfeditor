export type ToolKind =
  | "select"
  | "text"
  | "edittext"
  | "highlight"
  | "ink"
  | "rect"
  | "ellipse"
  | "line"
  | "whiteout"
  | "image"
  | "signature";

export interface BaseAnnotation {
  id: string;
  /** Coordinates in PDF points, origin top-left of the unrotated page at scale 1. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Annotations sharing a groupId are deleted together (e.g. whiteout + retyped text). */
  groupId?: string;
  /** Locked annotations can't be selected or moved (clicks pass through). */
  locked?: boolean;
}

export type FontFamilyKind =
  | "helvetica"
  | "times"
  | "courier"
  | "carlito" // metric-compatible with Calibri (bundled)
  | "caladea"; // metric-compatible with Cambria (bundled)

export interface TextAnnotation extends BaseAnnotation {
  kind: "text";
  text: string;
  fontSize: number;
  color: string;
  fontFamily?: FontFamilyKind;
  bold?: boolean;
  italic?: boolean;
  /** Exact CSS font-family for on-screen display (e.g. the embedded PDF font). */
  displayFontCss?: string;
}

export interface HighlightAnnotation extends BaseAnnotation {
  kind: "highlight";
  color: string;
}

export interface WhiteoutAnnotation extends BaseAnnotation {
  kind: "whiteout";
}

export interface ShapeAnnotation extends BaseAnnotation {
  kind: "rect" | "ellipse" | "line";
  color: string;
  strokeWidth: number;
}

export interface InkAnnotation extends BaseAnnotation {
  kind: "ink";
  /** Points relative to the annotation box, in PDF points. */
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth: number;
}

export interface ImageAnnotation extends BaseAnnotation {
  kind: "image";
  /** PNG or JPEG data URL. */
  dataUrl: string;
}

export type Annotation =
  | TextAnnotation
  | HighlightAnnotation
  | WhiteoutAnnotation
  | ShapeAnnotation
  | InkAnnotation
  | ImageAnnotation;

/** Annotations keyed by 0-based page index. */
export type AnnotationMap = Record<number, Annotation[]>;

export type ProviderKind = "ollama" | "lmstudio" | "openai_compatible";

export interface AppSettings {
  provider: ProviderKind;
  model: string;
  ollamaBaseUrl: string;
  lmStudioBaseUrl: string;
  customBaseUrl: string;
  customApiKey: string;
  temperature: number;
  contextChars: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SearchMatch {
  page: number; // 0-based
  itemIndex: number;
  snippet: string;
}

export interface OutlineNode {
  title: string;
  pageIndex: number | null;
  children: OutlineNode[];
}

export interface SavedSignature {
  id: string;
  dataUrl: string;
  createdAt: number;
}

export type Screen =
  | "viewer"
  | "organize"
  | "merge"
  | "split"
  | "watermark"
  | "settings";

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
  | "signature"
  | "formtext"
  | "formcheckbox"
  | "formdropdown"
  | "formradio";

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
  /** Patch color — defaults to white; edit-text samples the page background. */
  color?: string;
}

export interface ShapeAnnotation extends BaseAnnotation {
  kind: "rect" | "ellipse" | "line";
  color: string;
  strokeWidth: number;
  /** Fill color for rect/ellipse; omitted = no fill (outline only). */
  fill?: string;
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

/** A form field to be CREATED in the PDF when saving (form designer). */
export type FieldBorderStyle =
  | "solid"
  | "dashed"
  | "beveled"
  | "inset"
  | "underline";

export type FieldAlign = "left" | "center" | "right";

export interface FormFieldAnnotation extends BaseAnnotation {
  kind: "formfield";
  fieldType: "text" | "checkbox" | "dropdown" | "radio";
  fieldName: string;
  /** Dropdown choices. */
  options?: string[];
  /** Radio widget export value; widgets sharing a fieldName form one group. */
  optionValue?: string;

  // --- Form-builder properties ---
  /** Hover tooltip (/TU). */
  tooltip?: string;
  /** Prefilled value (text) or checked state (checkbox). */
  defaultValue?: string;
  required?: boolean;
  readOnly?: boolean;
  /** Text font size in pt; 0 or undefined = auto-size. */
  fontSize?: number;
  align?: FieldAlign;
  multiline?: boolean;
  maxLength?: number;
  /** Widget appearance. */
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderStyle?: FieldBorderStyle;
}

/** A pending edit to an EXISTING AcroForm field (move/rename/delete). */
export interface ExistingFieldOp {
  key: string;
  fieldName: string;
  pageIndex: number;
  /** Original widget rect in display points (top-left origin, scale 1). */
  origRect: { x: number; y: number; w: number; h: number };
  newRect?: { x: number; y: number; w: number; h: number };
  deleted?: boolean;
  newName?: string;
}

export type Annotation =
  | TextAnnotation
  | HighlightAnnotation
  | WhiteoutAnnotation
  | ShapeAnnotation
  | InkAnnotation
  | ImageAnnotation
  | FormFieldAnnotation;

/** Annotations keyed by 0-based page index. */
export type AnnotationMap = Record<number, Annotation[]>;

export type ProviderKind =
  | "browser"
  | "ollama"
  | "lmstudio"
  | "openai_compatible";

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

/** A node in the opened-folder tree (directories and PDF files only). */
export interface FolderNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: FolderNode[];
  /** FileSystemFileHandle when opened via the File System Access API. */
  handle?: unknown;
  /** File when opened via a <input webkitdirectory> fallback. */
  file?: File;
}

export type Screen =
  | "viewer"
  | "templates"
  | "organize"
  | "merge"
  | "split"
  | "watermark"
  | "settings";

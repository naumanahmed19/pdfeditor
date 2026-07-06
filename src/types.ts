export type ToolKind =
  | "read"
  | "pan"
  | "select"
  | "text"
  | "edittext"
  | "editobject"
  | "note"
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "ink"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "callout"
  | "whiteout"
  | "eraser"
  | "redact"
  | "image"
  | "signature"
  | "formtext"
  | "formcheckbox"
  | "formdropdown"
  | "formradio"
  | "formdate"
  | "formsignature"
  | "formbutton";

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
  /** Rotation in degrees, clockwise on screen, about the box center. */
  rotation?: number;
}

export type FontFamilyKind =
  | "helvetica"
  | "times"
  | "courier"
  | "carlito" // metric-compatible with Calibri (bundled)
  | "caladea"; // metric-compatible with Cambria (bundled)

/** A styled span of a rich text box. Unset style fields inherit the box's. */
export interface TextRun {
  text: string;
  color?: string;
  fontSize?: number;
  fontFamily?: FontFamilyKind;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface TextAnnotation extends BaseAnnotation {
  kind: "text";
  /** Plain text (concatenation of `runs` when present) — for search/extract. */
  text: string;
  /** Rich runs; when absent the whole `text` uses the box-level style below. */
  runs?: TextRun[];
  fontSize: number;
  color: string;
  fontFamily?: FontFamilyKind;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Paragraph alignment for the whole box. */
  align?: "left" | "center" | "right";
  /** Exact CSS font-family for on-screen display (e.g. the embedded PDF font). */
  displayFontCss?: string;
}

export interface HighlightAnnotation extends BaseAnnotation {
  kind: "highlight";
  color: string;
}

export type MarkupStyle = "underline" | "strikeout" | "squiggly";

/** Text markup (underline / strikethrough / squiggly) over existing document
 *  text — created from a text selection like highlight, or by dragging a box. */
export interface MarkupAnnotation extends BaseAnnotation {
  kind: "markup";
  style: MarkupStyle;
  color: string;
}

/** Sticky-note comment — a compact marker with popup text. Baked into the
 *  saved PDF as a standard /Text popup annotation (Acrobat-compatible). */
export interface NoteAnnotation extends BaseAnnotation {
  kind: "note";
  text: string;
  color: string;
}

export interface WhiteoutAnnotation extends BaseAnnotation {
  kind: "whiteout";
  /** Patch color — defaults to white; edit-text samples the page background. */
  color?: string;
}

/** A pending redaction region. Unlike whiteout (a cosmetic cover), applying it
 *  destructively removes the underlying text/content via PDFium — the redacted
 *  content no longer exists in the saved file. Rendered as a solid black box. */
export interface RedactAnnotation extends BaseAnnotation {
  kind: "redact";
}

export interface ShapeAnnotation extends BaseAnnotation {
  kind: "rect" | "ellipse" | "line" | "arrow";
  color: string;
  strokeWidth: number;
  /** Fill color for rect/ellipse; omitted = no fill (outline only). */
  fill?: string;
  /** Line direction within its box: true = top-left → bottom-right ("\"),
   *  false/unset = bottom-left → top-right ("/"). Lines only. */
  down?: boolean;
  /** Arrow only: endpoints as fractions of the box (0–1), so they survive
   *  moves and resizes. Tail at (ax, ay), head at (bx, by). */
  ax?: number;
  ay?: number;
  bx?: number;
  by?: number;
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

export type FormFieldType =
  | "text"
  | "checkbox"
  | "dropdown"
  | "radio"
  | "date"
  | "signature"
  | "button";

export interface FormFieldAnnotation extends BaseAnnotation {
  kind: "formfield";
  fieldType: FormFieldType;
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
  /** Value text color (hex); applied via the field's /DA. */
  textColor?: string;
  align?: FieldAlign;
  multiline?: boolean;
  maxLength?: number;
  /** Text field laid out as fixed comb cells (needs maxLength; /Comb flag). */
  comb?: boolean;
  /** Text field that masks its value (/Password flag). */
  password?: boolean;
  /** Widget appearance. */
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderStyle?: FieldBorderStyle;

  /** Checkbox export value (/AP on-state name); defaults to "Yes". */
  exportValue?: string;
  /** Dropdown: user can type a custom value (combo /Edit flag). */
  editable?: boolean;
  /** Choice field shown as a list box (non-combo) instead of a dropdown. */
  listBox?: boolean;
  /** List box: allow selecting multiple options (/MultiSelect flag). */
  multiSelect?: boolean;
  /** Date field display format (AFDate picture, e.g. "mm/dd/yyyy"). */
  dateFormat?: string;
  /** Text field format/validation preset (Acrobat AF actions). */
  format?: "none" | "number" | "currency" | "percent" | "phone" | "ssn" | "zip" | "email";
  /** Push-button caption. */
  buttonCaption?: string;
  /** Push-button action run on click (none = a plain visual button). */
  buttonAction?: "none" | "reset" | "submit";
  /** Target URL when buttonAction === "submit". */
  submitUrl?: string;
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
  | MarkupAnnotation
  | NoteAnnotation
  | WhiteoutAnnotation
  | RedactAnnotation
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
  | "compress"
  | "crop"
  | "headerfooter"
  | "export"
  | "compare"
  | "settings";

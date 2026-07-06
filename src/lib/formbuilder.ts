import type {
  AnnotationMap,
  FormFieldAnnotation,
  FormFieldType,
  ToolKind,
} from "../types";
import { uid } from "./utils";

/* ------------------------------------------------------------------ */
/* Field-type metadata (palette, placement defaults, auto-naming)      */
/* ------------------------------------------------------------------ */

export interface FieldTypeMeta {
  type: FormFieldType;
  label: string;
  /** Auto-name prefix (text_1, date_2, …). */
  prefix: string;
  defaultSize: { w: number; h: number };
  /** Small widgets (checkbox/radio) keep the tool armed for a run of them. */
  small: boolean;
}

export const FIELD_TYPES: FieldTypeMeta[] = [
  { type: "text", label: "Text field", prefix: "text", defaultSize: { w: 150, h: 24 }, small: false },
  { type: "date", label: "Date", prefix: "date", defaultSize: { w: 110, h: 24 }, small: false },
  { type: "checkbox", label: "Checkbox", prefix: "check", defaultSize: { w: 16, h: 16 }, small: true },
  { type: "radio", label: "Radio button", prefix: "choice", defaultSize: { w: 16, h: 16 }, small: true },
  { type: "dropdown", label: "Dropdown", prefix: "select", defaultSize: { w: 150, h: 24 }, small: false },
  { type: "signature", label: "Signature", prefix: "sig", defaultSize: { w: 180, h: 50 }, small: false },
  { type: "button", label: "Button", prefix: "btn", defaultSize: { w: 110, h: 28 }, small: false },
];

export const FIELD_META: Record<FormFieldType, FieldTypeMeta> = Object.fromEntries(
  FIELD_TYPES.map((m) => [m.type, m]),
) as Record<FormFieldType, FieldTypeMeta>;

export const TOOL_FOR_FIELD: Record<FormFieldType, ToolKind> = {
  text: "formtext",
  checkbox: "formcheckbox",
  dropdown: "formdropdown",
  radio: "formradio",
  date: "formdate",
  signature: "formsignature",
  button: "formbutton",
};

export const FIELD_FOR_TOOL: Partial<Record<ToolKind, FormFieldType>> = {
  formtext: "text",
  formcheckbox: "checkbox",
  formdropdown: "dropdown",
  formradio: "radio",
  formdate: "date",
  formsignature: "signature",
  formbutton: "button",
};

/** AFDate picture strings understood by Acrobat's format action. */
export const DATE_FORMATS = [
  "mm/dd/yyyy",
  "dd/mm/yyyy",
  "yyyy-mm-dd",
  "mmm d, yyyy",
  "d-mmm-yy",
];

/** MIME type carried by a palette drag; also mirrored in `paletteDrag` so
 *  dragover (which can't read dataTransfer data) knows a field is in flight. */
export const FIELD_DND_MIME = "application/x-pdf-form-field";

/** The field type currently being dragged from the palette (null = none).
 *  A plain module holder — no re-render churn while dragging. */
export const paletteDrag: { type: FormFieldType | null } = { type: null };

/**
 * Build a fresh placed form field of `type` at the given rect, auto-named and
 * seeded with sensible per-type defaults. Shared by click-to-place (drag on
 * page) and drag-from-palette so both behave identically.
 */
export function buildFormField(
  annotations: AnnotationMap,
  type: FormFieldType,
  rect: { x: number; y: number; w?: number; h?: number },
): FormFieldAnnotation {
  const meta = FIELD_META[type];
  const count = allFormFields(annotations).length + 1;
  return {
    id: uid(),
    kind: "formfield",
    fieldType: type,
    x: rect.x,
    y: rect.y,
    w: rect.w && rect.w > 8 ? rect.w : meta.defaultSize.w,
    h: rect.h && rect.h > 8 ? rect.h : meta.defaultSize.h,
    fieldName: type === "radio" ? "choice_1" : nextFieldName(annotations, type),
    options: type === "dropdown" ? ["Option 1", "Option 2"] : undefined,
    optionValue: type === "radio" ? `option${count}` : undefined,
    dateFormat: type === "date" ? DATE_FORMATS[0] : undefined,
    buttonCaption: type === "button" ? "Submit" : undefined,
  };
}

/** The subset of a read AcroForm field the promote step needs. */
export interface ExistingFieldSpec {
  fieldType: "Tx" | "Btn" | "Ch";
  checkBox: boolean;
  radioButton: boolean;
  combo: boolean;
  multiSelect: boolean;
  comb: boolean;
  multiLine: boolean;
  maxLen?: number;
  readOnly: boolean;
  fieldValue: unknown;
  options: string[];
}

/**
 * Convert an existing AcroForm field into an editable placeholder so it can be
 * edited with the full properties panel and recreated on save. Returns null for
 * kinds we can't round-trip yet (radio groups, signatures). Styling we can't
 * read (font/border/color) defaults; the user re-sets it in the panel.
 */
export function existingFieldToFormField(
  annotations: AnnotationMap,
  name: string,
  rect: { x: number; y: number; w: number; h: number },
  spec: ExistingFieldSpec,
): FormFieldAnnotation | null {
  let type: FormFieldType;
  if (spec.fieldType === "Tx") type = "text";
  else if (spec.fieldType === "Btn" && spec.checkBox) type = "checkbox";
  else if (spec.fieldType === "Btn" && spec.radioButton) return null;
  else if (spec.fieldType === "Btn") type = "button";
  else if (spec.fieldType === "Ch") type = "dropdown";
  else return null;

  const value =
    typeof spec.fieldValue === "string"
      ? spec.fieldValue
      : Array.isArray(spec.fieldValue)
        ? String(spec.fieldValue[0] ?? "")
        : "";
  const ann: FormFieldAnnotation = {
    ...buildFormField(annotations, type, rect),
    fieldName: name,
    readOnly: spec.readOnly || undefined,
  };
  if (type === "text") {
    ann.multiline = spec.multiLine || undefined;
    ann.comb = spec.comb || undefined;
    ann.maxLength = spec.maxLen;
    ann.defaultValue = value || undefined;
  } else if (type === "dropdown") {
    ann.options = spec.options.length ? spec.options : ["Option 1"];
    ann.listBox = !spec.combo || undefined;
    ann.multiSelect = (!spec.combo && spec.multiSelect) || undefined;
    ann.defaultValue = value || undefined;
  } else if (type === "checkbox") {
    ann.defaultValue = value && value !== "Off" ? "true" : undefined;
  } else if (type === "button") {
    ann.buttonCaption = name;
  }
  return ann;
}

/** Every placed (not-yet-saved) form field, in page + tab order. */
export function allFormFields(
  annotations: AnnotationMap,
): Array<{ page: number; ann: FormFieldAnnotation }> {
  const out: Array<{ page: number; ann: FormFieldAnnotation }> = [];
  const pages = Object.keys(annotations)
    .map(Number)
    .sort((a, b) => a - b);
  for (const p of pages) {
    for (const a of annotations[p] ?? []) {
      if (a.kind === "formfield") out.push({ page: p, ann: a });
    }
  }
  return out;
}

/** Next free auto-name for a field type (text_1, text_2, …). */
export function nextFieldName(
  annotations: AnnotationMap,
  type: FormFieldType,
): string {
  const prefix = FIELD_META[type].prefix;
  const used = new Set(
    allFormFields(annotations).map(({ ann }) => ann.fieldName),
  );
  for (let n = used.size + 1; ; n++) {
    const name = `${prefix}_${n}`;
    if (!used.has(name)) return name;
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface FormIssue {
  severity: "error" | "warning";
  message: string;
  /** 0-based page of the first offending field (jump target). */
  page?: number;
  /** Offending annotation ids (first one is focused on click). */
  ids?: string[];
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Design-time checks: duplicate/empty names, empty option lists, overlaps. */
export function validateForm(annotations: AnnotationMap): FormIssue[] {
  const issues: FormIssue[] = [];
  const fields = allFormFields(annotations);
  if (!fields.length) return issues;

  const byName = new Map<string, Array<{ page: number; ann: FormFieldAnnotation }>>();
  for (const f of fields) {
    const name = f.ann.fieldName.trim();
    if (!name) {
      issues.push({
        severity: "error",
        message: "A field has an empty name",
        page: f.page,
        ids: [f.ann.id],
      });
      continue;
    }
    const list = byName.get(name) ?? [];
    list.push(f);
    byName.set(name, list);
  }

  for (const [name, group] of byName) {
    const types = new Set(group.map((f) => f.ann.fieldType));
    if (types.size > 1) {
      issues.push({
        severity: "error",
        message: `"${name}" is used by fields of different types (${[...types].join(", ")})`,
        page: group[0].page,
        ids: group.map((f) => f.ann.id),
      });
      continue;
    }
    const type = group[0].ann.fieldType;
    if (type === "radio") {
      if (group.length < 2) {
        issues.push({
          severity: "warning",
          message: `Radio group "${name}" has only one option`,
          page: group[0].page,
          ids: group.map((f) => f.ann.id),
        });
      }
      const exports = group.map((f) => f.ann.optionValue ?? "");
      if (new Set(exports).size !== exports.length) {
        issues.push({
          severity: "error",
          message: `Radio group "${name}" has duplicate option values`,
          page: group[0].page,
          ids: group.map((f) => f.ann.id),
        });
      }
    } else if (group.length > 1) {
      issues.push({
        severity: "warning",
        message: `${group.length} fields share the name "${name}" — they will mirror each other's value`,
        page: group[0].page,
        ids: group.map((f) => f.ann.id),
      });
    }
  }

  for (const f of fields) {
    const { ann, page } = f;
    if (ann.fieldType === "dropdown") {
      const opts = (ann.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (!opts.length) {
        issues.push({
          severity: "error",
          message: `Dropdown "${ann.fieldName}" has no options`,
          page,
          ids: [ann.id],
        });
      } else if (new Set(opts).size !== opts.length) {
        issues.push({
          severity: "warning",
          message: `Dropdown "${ann.fieldName}" has duplicate options`,
          page,
          ids: [ann.id],
        });
      }
    }
    if (
      ann.fieldType === "text" &&
      ann.maxLength &&
      (ann.defaultValue?.length ?? 0) > ann.maxLength
    ) {
      issues.push({
        severity: "warning",
        message: `"${ann.fieldName}": default text is longer than its max length`,
        page,
        ids: [ann.id],
      });
    }
  }

  // Overlaps: pairwise per page (field counts are small).
  const pages = new Map<number, Array<{ page: number; ann: FormFieldAnnotation }>>();
  for (const f of fields) {
    const list = pages.get(f.page) ?? [];
    list.push(f);
    pages.set(f.page, list);
  }
  for (const [page, list] of pages) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (rectsOverlap(list[i].ann, list[j].ann)) {
          issues.push({
            severity: "warning",
            message: `"${list[i].ann.fieldName}" and "${list[j].ann.fieldName}" overlap`,
            page,
            ids: [list[i].ann.id, list[j].ann.id],
          });
        }
      }
    }
  }

  return issues.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );
}

/* ------------------------------------------------------------------ */
/* Snapping & alignment guides                                         */
/* ------------------------------------------------------------------ */

export interface SnapOptions {
  /** Snap to other fields' edges/centers and the page center. */
  snap: boolean;
  /** Snap to the grid. */
  grid: boolean;
  gridSize: number;
  /** Max distance (in PDF points) at which a guide attracts. */
  threshold: number;
}

export interface SnapMove {
  x: number;
  y: number;
  /** Vertical guide x-positions to draw (page points). */
  v: number[];
  /** Horizontal guide y-positions to draw (page points). */
  h: number[];
}

function nearest(
  values: number[],
  candidates: number[],
  threshold: number,
): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null;
  for (const v of values) {
    for (const c of candidates) {
      const d = c - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, guide: c };
      }
    }
  }
  return best;
}

/**
 * Snap a rect being MOVED. Guide candidates are the other fields' edges and
 * centers plus the page's center; the grid (when on) is a fallback that
 * doesn't draw guides. Returns the adjusted position and guides to render.
 */
export function snapMovingRect(
  rect: { x: number; y: number; w: number; h: number },
  others: Array<{ x: number; y: number; w: number; h: number }>,
  page: { w: number; h: number },
  opts: SnapOptions,
): SnapMove {
  let { x, y } = rect;
  const v: number[] = [];
  const h: number[] = [];

  if (opts.snap) {
    const candX: number[] = [page.w / 2];
    const candY: number[] = [page.h / 2];
    for (const o of others) {
      candX.push(o.x, o.x + o.w / 2, o.x + o.w);
      candY.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    const sx = nearest([x, x + rect.w / 2, x + rect.w], candX, opts.threshold);
    if (sx) {
      x += sx.delta;
      v.push(sx.guide);
    }
    const sy = nearest([y, y + rect.h / 2, y + rect.h], candY, opts.threshold);
    if (sy) {
      y += sy.delta;
      h.push(sy.guide);
    }
  }
  if (opts.grid) {
    const g = opts.gridSize;
    if (!v.length) x = Math.round(x / g) * g;
    if (!h.length) y = Math.round(y / g) * g;
  }
  return { x, y, v, h };
}

/** Snap the bottom-right corner while RESIZING (right + bottom edges only). */
export function snapResizingRect(
  rect: { x: number; y: number; w: number; h: number },
  others: Array<{ x: number; y: number; w: number; h: number }>,
  page: { w: number; h: number },
  opts: SnapOptions,
): { w: number; h: number; v: number[]; h2: number[] } {
  let { w, h } = rect;
  const v: number[] = [];
  const hg: number[] = [];

  if (opts.snap) {
    const candX: number[] = [page.w / 2];
    const candY: number[] = [page.h / 2];
    for (const o of others) {
      candX.push(o.x, o.x + o.w, o.x + o.w / 2);
      candY.push(o.y, o.y + o.h, o.y + o.h / 2);
    }
    const sx = nearest([rect.x + w], candX, opts.threshold);
    if (sx) {
      w += sx.delta;
      v.push(sx.guide);
    }
    const sy = nearest([rect.y + h], candY, opts.threshold);
    if (sy) {
      h += sy.delta;
      hg.push(sy.guide);
    }
  }
  if (opts.grid) {
    const g = opts.gridSize;
    if (!v.length) w = Math.max(g, Math.round((rect.x + w) / g) * g - rect.x);
    if (!hg.length) h = Math.max(g, Math.round((rect.y + h) / g) * g - rect.y);
  }
  return { w: Math.max(8, w), h: Math.max(8, h), v, h2: hg };
}

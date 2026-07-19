import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pencil, PenLine } from "lucide-react";
import type { PdfDoc } from "../../lib/pdf";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import {
  DATE_FORMATS,
  type ExistingFieldSpec,
  existingFieldToFormField,
} from "../../lib/formbuilder";
import { useFormFieldTheme } from "./formFieldTheme";
import { type FieldFormat, fieldValueError, formatFieldValue } from "../../lib/fieldFormat";
import type { FormFieldAnnotation } from "../../types";
import { AlignmentButtons } from "./AlignTools";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ColorSwatch } from "../ui/color-swatch";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { canMoveExistingFormField } from "../../lib/selectionPolicy";

interface FormFieldSpec {
  key: string;
  name: string;
  kind: "text" | "multiline" | "checkbox" | "radio" | "dropdown" | "listbox" | "button";
  left: number;
  top: number;
  width: number;
  height: number;
  options?: Array<{ value: string; label: string }>;
  /** Export value of this radio widget. */
  buttonValue?: string;
  initial: unknown;
  readOnly: boolean;
  maxLen?: number;
  /** Text field with the Comb flag: value laid out across `maxLen` fixed cells. */
  comb?: boolean;
  /** List box (choice field, non-combo) allowing more than one selection. */
  multiSelect?: boolean;
  /** Text field format preset (from /AA AF actions). */
  format?: FieldFormat;
}

/** Renders the PDF's AcroForm fields as fillable inputs. */
export function FormLayer({
  pdf,
  pageIndex,
  scale,
  visible,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  visible: boolean;
}) {
  const app = useApp();
  const theme = useFormFieldTheme();
  const [fields, setFields] = useState<FormFieldSpec[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const annots = await page.getAnnotations();
        const vp = page.getViewport({ scale: 1 });
        const out: FormFieldSpec[] = [];
        for (const a of annots as any[]) {
          if (a.subtype !== "Widget" || !a.fieldName || a.hidden) continue;
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          const base = {
            key: a.id ?? `${a.fieldName}-${out.length}`,
            name: a.fieldName as string,
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
            readOnly: !!a.readOnly,
          };
          if (a.fieldType === "Tx") {
            out.push({
              ...base,
              kind: a.multiLine ? "multiline" : "text",
              initial: a.fieldValue ?? "",
              maxLen: a.maxLen || undefined,
              comb: !a.multiLine && !!a.comb && !!a.maxLen,
              format: a.format as FieldFormat | undefined,
            });
          } else if (a.fieldType === "Btn" && a.checkBox) {
            out.push({
              ...base,
              kind: "checkbox",
              initial: !!a.fieldValue && a.fieldValue !== "Off",
            });
          } else if (a.fieldType === "Btn" && a.radioButton) {
            out.push({
              ...base,
              kind: "radio",
              buttonValue: a.buttonValue ?? "",
              initial: a.fieldValue ?? "",
            });
          } else if (a.fieldType === "Btn") {
            // Pushbutton (Reset / Submit / JavaScript). Rendered as a click
            // target whose action is delegated to PDFium's form engine.
            out.push({ ...base, kind: "button", initial: "" });
          } else if (a.fieldType === "Ch") {
            // A choice field is a dropdown when the Combo flag is set, otherwise
            // a list box (several options visible at once, optionally multi-select).
            const isCombo = !!a.combo;
            const options = (a.options ?? []).map((o: any) => ({
              value: String(o.exportValue ?? o.displayValue ?? ""),
              label: String(o.displayValue ?? o.exportValue ?? ""),
            }));
            out.push({
              ...base,
              kind: isCombo ? "dropdown" : "listbox",
              options,
              multiSelect: !isCombo && !!a.multiSelect,
              initial: isCombo
                ? Array.isArray(a.fieldValue)
                  ? a.fieldValue[0]
                  : a.fieldValue ?? ""
                : Array.isArray(a.fieldValue)
                  ? a.fieldValue
                  : a.fieldValue != null && a.fieldValue !== ""
                    ? [a.fieldValue]
                    : [],
            });
          }
        }
        if (alive) setFields(out);
      } catch {
        /* no form */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, pageIndex, visible]);

  if (!fields.length) return null;

  // Run a pushbutton's action (Reset/Submit/JS) via PDFium, then pull the
  // resulting field values back into the app so the overlays update.
  const runFieldAction = async (f: FormFieldSpec) => {
    try {
      const page = await pdf.getPage(pageIndex + 1);
      page.clickWidget(f.left + f.width / 2, f.top + f.height / 2);
      const annots = await page.getAnnotations();
      for (const a of annots as any[]) {
        if (a.subtype !== "Widget" || !a.fieldName) continue;
        if (a.fieldType === "Btn" && !a.checkBox && !a.radioButton) continue;
        app.setFormValue(a.fieldName, formValueFromAnnot(a));
      }
    } catch {
      /* button had no runnable action */
    }
  };

  const inputCls = theme.input;

  // Edit mode: existing fields become selectable designer objects — except
  // in the form builder's live preview, where everything stays fillable.
  if (app.editMode && !(app.formBuilder && app.formPreview)) {
    return (
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {fields.map((f) => (
          <FieldDesigner key={f.key} field={f} pageIndex={pageIndex} scale={scale} />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {fields.map((f) => {
        const opKey = fieldOpKey(f, pageIndex);
        const op = app.fieldOps[opKey];
        if (op?.deleted) return null;
        const rect = op?.newRect ?? {
          x: f.left,
          y: f.top,
          w: f.width,
          h: f.height,
        };
        const style: React.CSSProperties = {
          left: rect.x * scale,
          top: rect.y * scale,
          width: rect.w * scale,
          height: rect.h * scale,
          pointerEvents: "auto",
          fontSize: Math.min(24, Math.max(9, rect.h * scale * 0.55)),
        };
        const current = app.formValues[f.name];

        if (f.kind === "button") {
          // Transparent hit target over the button baked into the page; the
          // action (Reset/Submit/JS) is delegated to PDFium on click.
          return (
            <button
              key={f.key}
              type="button"
              disabled={f.readOnly}
              onClick={() => void runFieldAction(f)}
              title={f.name}
              className="absolute cursor-pointer bg-transparent"
              style={{
                left: rect.x * scale,
                top: rect.y * scale,
                width: rect.w * scale,
                height: rect.h * scale,
                pointerEvents: "auto",
              }}
            />
          );
        }

        if (f.kind === "checkbox") {
          const checked = current !== undefined ? !!current : !!f.initial;
          return (
            <input
              key={f.key}
              type="checkbox"
              checked={checked}
              disabled={f.readOnly}
              onChange={(e) => app.setFormValue(f.name, e.target.checked)}
              className={cn(inputCls, theme.accent)}
              style={style}
            />
          );
        }
        if (f.kind === "radio") {
          const groupValue = current !== undefined ? current : f.initial;
          return (
            <input
              key={f.key}
              type="radio"
              name={`pdf-radio-${pageIndex}-${f.name}`}
              checked={groupValue === f.buttonValue}
              disabled={f.readOnly}
              onChange={() => app.setFormValue(f.name, f.buttonValue)}
              className={cn(inputCls, theme.accent)}
              style={style}
            />
          );
        }
        if (f.kind === "dropdown") {
          const value = String(current !== undefined ? current : f.initial ?? "");
          return (
            <select
              key={f.key}
              value={value}
              disabled={f.readOnly}
              onChange={(e) => app.setFormValue(f.name, e.target.value)}
              className={inputCls}
              style={style}
            >
              <option value="" />
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        }
        if (f.kind === "listbox") {
          const selected: string[] = Array.isArray(current)
            ? current.map(String)
            : current != null && current !== ""
              ? [String(current)]
              : Array.isArray(f.initial)
                ? (f.initial as unknown[]).map(String)
                : f.initial != null && f.initial !== ""
                  ? [String(f.initial)]
                  : [];
          return (
            <select
              key={f.key}
              multiple={f.multiSelect}
              size={Math.max(2, f.options?.length ?? 2)}
              value={f.multiSelect ? selected : selected[0] ?? ""}
              disabled={f.readOnly}
              onChange={(e) =>
                f.multiSelect
                  ? app.setFormValue(
                      f.name,
                      Array.from(e.target.selectedOptions).map((o) => o.value),
                    )
                  : app.setFormValue(f.name, e.target.value)
              }
              className={cn(inputCls, "overflow-auto p-0")}
              style={{
                ...style,
                fontSize: Math.min(14, Math.max(9, 11 * scale)),
                // Opaque so the baked list-box appearance on the canvas beneath
                // doesn't show through and double the option labels.
                background: theme.fill,
              }}
            >
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value} className="px-1">
                  {o.label}
                </option>
              ))}
            </select>
          );
        }
        const value = String(current !== undefined ? current : f.initial ?? "");
        if (f.kind === "multiline") {
          return (
            <textarea
              key={f.key}
              value={value}
              disabled={f.readOnly}
              maxLength={f.maxLen}
              onChange={(e) => app.setFormValue(f.name, e.target.value)}
              className={cn(inputCls, "resize-none p-1")}
              // Height-based sizing suits single-line fields; a multi-line box is
              // many lines tall, so use a normal per-line font instead.
              style={{ ...style, fontSize: Math.min(14, Math.max(9, 11 * scale)) }}
            />
          );
        }
        if (f.comb && f.maxLen) {
          return (
            <CombField
              key={f.key}
              n={f.maxLen}
              value={value}
              readOnly={f.readOnly}
              className={cn(inputCls, "overflow-hidden p-0")}
              // Opaque so PDFium's baked comb appearance beneath doesn't show
              // through and double the glyphs; our grid is the only thing drawn.
              style={{ ...style, background: theme.fill }}
              onChange={(v) => app.setFormValue(f.name, v)}
            />
          );
        }
        if (f.format && f.format !== "none") {
          return (
            <FormatTextField
              key={f.key}
              value={value}
              format={f.format}
              readOnly={f.readOnly}
              maxLength={f.maxLen}
              className={cn(inputCls, "px-1")}
              style={style}
              onChange={(v) => app.setFormValue(f.name, v)}
            />
          );
        }
        return (
          <input
            key={f.key}
            type="text"
            value={value}
            disabled={f.readOnly}
            maxLength={f.maxLen}
            onChange={(e) => app.setFormValue(f.name, e.target.value)}
            className={cn(inputCls, "px-1")}
            style={style}
          />
        );
      })}
    </div>
  );
}

/**
 * Text fill-input for a field with a format preset. Shows the raw value while
 * focused (so editing is unfiltered) and the Acrobat-style formatted value once
 * blurred, mirroring what the baked /AA actions produce in Acrobat/Chrome.
 * A failing validation (e.g. a malformed email) gets a red ring + message.
 */
function FormatTextField({
  value,
  format,
  readOnly,
  maxLength,
  className,
  style,
  onChange,
}: {
  value: string;
  format: FieldFormat;
  readOnly?: boolean;
  maxLength?: number;
  className?: string;
  style?: React.CSSProperties;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const error = fieldValueError(format, value);
  const display = focused ? value : formatFieldValue(format, value);
  return (
    <input
      type="text"
      value={display}
      disabled={readOnly}
      maxLength={maxLength}
      title={error ?? undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
      className={cn(className, error && "ring-1 ring-red-500")}
      style={style}
    />
  );
}

let combMeasureCanvas: HTMLCanvasElement | null = null;

/**
 * Comb text field: one glyph per fixed cell (like Chrome's PDF viewer). It's a
 * REAL native <input> — visible monospace text spread across the cells with
 * measured letter-spacing, and cell dividers painted as a background — so the
 * native caret (blinking, correctly positioned) and selection just work. Only
 * editing is customised: a keystroke OVERWRITES the active cell instead of
 * inserting and shoving the rest of the value sideways.
 */
function CombField({
  n,
  value,
  readOnly,
  className,
  style,
  onChange,
}: {
  n: number;
  value: string;
  readOnly: boolean;
  className: string;
  style: React.CSSProperties;
  onChange: (v: string) => void;
}) {
  const theme = useFormFieldTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  // Caret to restore after an overwrite edit re-renders the controlled input.
  const pending = useRef<number | null>(null);
  const [layout, setLayout] = useState<{ ls: number; indent: number; cellW: number } | null>(null);

  // Measure so each glyph sits centred in its own cell: cellW is the field
  // width / n, letter-spacing pads each monospace glyph out to a full cell, and
  // text-indent shifts the row by half a cell to centre the first glyph.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const cellW = el.clientWidth / n;
    combMeasureCanvas ??= document.createElement("canvas");
    const ctx = combMeasureCanvas.getContext("2d");
    let charW = cellW * 0.6;
    if (ctx) {
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      charW = ctx.measureText("0").width || charW;
    }
    setLayout({ ls: cellW - charW, indent: (cellW - charW) / 2, cellW });
  }, [n, style.width, style.height, style.fontSize]);

  useLayoutEffect(() => {
    if (pending.current == null || !inputRef.current) return;
    const p = pending.current;
    pending.current = null;
    inputRef.current.setSelectionRange(p, p);
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return;
    const el = inputRef.current;
    if (!el) return;
    const p = el.selectionStart ?? value.length;
    const move = (q: number) => {
      const c = Math.max(0, Math.min(n, q));
      el.setSelectionRange(c, c);
    };
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        move(p - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        move(Math.min(value.length, p + 1));
        return;
      case "Home":
        e.preventDefault();
        move(0);
        return;
      case "End":
        e.preventDefault();
        move(value.length);
        return;
      case "Backspace":
        e.preventDefault();
        if (p < value.length) {
          // Caret on a filled cell — remove THAT glyph (what looks selected).
          onChange(value.slice(0, p) + value.slice(p + 1));
          pending.current = p;
        } else if (p > 0) {
          onChange(value.slice(0, p - 1) + value.slice(p));
          pending.current = p - 1;
        }
        return;
      case "Delete":
        e.preventDefault();
        onChange(value.slice(0, p) + value.slice(p + 1));
        pending.current = p;
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (p >= n) return;
      onChange((value.slice(0, p) + e.key + value.slice(p + 1)).slice(0, n));
      pending.current = p + 1;
    }
  };

  const dividers = layout
    ? `repeating-linear-gradient(to right, transparent 0, transparent ${layout.cellW - 1}px, ${theme.divider} ${layout.cellW - 1}px, ${theme.divider} ${layout.cellW}px)`
    : undefined;

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      maxLength={n}
      disabled={readOnly}
      onKeyDown={onKeyDown}
      // Native path handles paste/IME; single keystrokes are handled above.
      onChange={(e) => {
        onChange(e.target.value.slice(0, n));
        pending.current = Math.min(e.target.selectionStart ?? n, n);
      }}
      className={className}
      style={{
        ...style,
        boxSizing: "border-box",
        padding: 0,
        background: theme.fill,
        backgroundImage: dividers,
        color: theme.text,
        fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
        letterSpacing: layout ? `${layout.ls}px` : undefined,
        textIndent: layout ? `${layout.indent}px` : undefined,
        textAlign: "left",
      }}
    />
  );
}

function fieldOpKey(f: FormFieldSpec, pageIndex: number): string {
  return `${f.name}|${pageIndex}|${Math.round(f.left)},${Math.round(f.top)}`;
}

/** Map a re-read engine annotation to the app's formValues representation
 *  (same shape the initial parse produces) — used after a button action. */
function formValueFromAnnot(a: any): unknown {
  if (a.fieldType === "Tx") return a.fieldValue ?? "";
  if (a.fieldType === "Btn" && a.checkBox) return !!a.fieldValue && a.fieldValue !== "Off";
  if (a.fieldType === "Btn" && a.radioButton) return a.fieldValue ?? "";
  if (a.fieldType === "Ch") {
    if (a.combo) return Array.isArray(a.fieldValue) ? a.fieldValue[0] ?? "" : a.fieldValue ?? "";
    return Array.isArray(a.fieldValue)
      ? a.fieldValue
      : a.fieldValue != null && a.fieldValue !== ""
        ? [a.fieldValue]
        : [];
  }
  return "";
}

/** Selectable/movable/deletable overlay for an EXISTING form field (edit mode). */
function FieldDesigner({
  field,
  pageIndex,
  scale,
}: {
  field: FormFieldSpec;
  pageIndex: number;
  scale: number;
}) {
  const app = useApp();
  const key = fieldOpKey(field, pageIndex);
  const base = {
    key,
    fieldName: field.name,
    pageIndex,
    origRect: { x: field.left, y: field.top, w: field.width, h: field.height },
  };
  const op = app.fieldOps[key];
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const rect = live ?? op?.newRect ?? base.origRect;
  const isSelected = app.selectedField?.key === key;
  const displayName = op?.newName ?? field.name;
  // Read mode fills fields; Move/select edits their geometry. Existing fields
  // take pointer priority over native page objects, so selecting a widget can
  // never accidentally grab the text or border painted underneath it. A
  // read-only or permission-locked widget passes clicks through.
  const canEdit = canMoveExistingFormField(
    app.tool,
    app.docPermissions,
    field.readOnly,
  );

  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent("pdfwb:object-selection", { detail: null }),
    );
    app.setSelectedField(base);
    app.setSelected(null);
    const start = { x: e.clientX, y: e.clientY };
    const orig = op?.newRect ?? base.origRect;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      setLive(
        mode === "move"
          ? { ...orig, x: orig.x + dx, y: orig.y + dy }
          : { ...orig, w: Math.max(10, orig.w + dx), h: Math.max(10, orig.h + dy) },
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLive((finalRect) => {
        if (finalRect) app.upsertFieldOp(base, { newRect: finalRect });
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Delete key removes the selected existing field.
  useEffect(() => {
    if (!isSelected) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        app.upsertFieldOp(base, { deleted: true });
        app.setSelectedField(null);
      }
      if (e.key === "Escape") app.setSelectedField(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected]);

  // Convert this existing field into a fully editable one (same flow as the
  // sidebar's Edit action): promote to a placeholder, delete the original.
  const canPromote = app.formBuilder && field.kind !== "radio";
  const promote = () => {
    const spec: ExistingFieldSpec = {
      fieldType:
        field.kind === "checkbox" || field.kind === "button"
          ? "Btn"
          : field.kind === "dropdown" || field.kind === "listbox"
            ? "Ch"
            : "Tx",
      checkBox: field.kind === "checkbox",
      radioButton: false,
      combo: field.kind === "dropdown",
      multiSelect: !!field.multiSelect,
      comb: !!field.comb,
      multiLine: field.kind === "multiline",
      maxLen: field.maxLen,
      readOnly: field.readOnly,
      fieldValue: field.initial,
      options: (field.options ?? []).map((o) => o.value),
    };
    const ann = existingFieldToFormField(app.annotations, field.name, rect, spec);
    if (!ann) return;
    app.upsertFieldOp(base, { deleted: true });
    app.addAnnotation(pageIndex, ann);
    app.setSelectedField(null);
    app.setSelected({ page: pageIndex, id: ann.id });
  };

  // Hidden once deleted — checked after all hooks so the hook order is stable.
  if (op?.deleted) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.w * scale,
        height: rect.h * scale,
        pointerEvents: canEdit ? "auto" : "none",
        cursor: canEdit ? "move" : "default",
        touchAction: canEdit ? "none" : "auto",
      }}
      className={cn(
        "group",
        isSelected && "ring-2 ring-blue-500 ring-offset-1",
        !isSelected && canEdit && "hover:ring-1 hover:ring-blue-400/60",
      )}
      onPointerDown={(e) => beginDrag(e, "move")}
    >
      <div
        className={cn(
          "relative h-full w-full border border-sky-500/70 bg-sky-400/10",
          field.kind === "radio" ? "rounded-full" : "rounded-[2px]",
        )}
      >
        {/* Field name — hidden by default so it doesn't overlap the form's own
            labels; revealed on hover or when the field is selected. */}
        <span
          className={cn(
            "pointer-events-none absolute -top-[15px] left-0 z-10 whitespace-nowrap rounded-sm bg-sky-600 px-1 text-[9px] font-medium leading-[1.4] text-white opacity-0 transition-opacity",
            isSelected ? "opacity-100" : "group-hover:opacity-100",
          )}
        >
          {displayName}
          {op?.newName && op.newName !== field.name ? " (renamed)" : ""}
        </span>
      </div>
      {isSelected && canPromote && (
        <button
          type="button"
          title="Edit this field"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={promote}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-sm border border-white bg-blue-500 text-white shadow-sm hover:bg-blue-600"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
      )}
      {isSelected && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          onPointerDown={(e) => beginDrag(e, "resize")}
        />
      )}
    </div>
  );
}


const FIELD_TYPE_LABEL: Record<FormFieldAnnotation["fieldType"], string> = {
  text: "Text",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio",
  date: "Date",
  signature: "Signature",
  button: "Button",
};

const BORDER_STYLES: Array<{ v: NonNullable<FormFieldAnnotation["borderStyle"]>; label: string }> = [
  { v: "solid", label: "Solid" },
  { v: "dashed", label: "Dashed" },
  { v: "beveled", label: "Beveled" },
  { v: "inset", label: "Inset" },
  { v: "underline", label: "Underline" },
];

/**
 * The widget appearance a field will have in the SAVED PDF (border color /
 * width / style + background, defaults matching createFormFields), as CSS —
 * so the designer box, read-mode box and live preview all show what the
 * properties panel configures. Beveled/inset map to CSS outset/inset.
 */
export function fieldWidgetCss(
  ann: FormFieldAnnotation,
  scale: number,
): React.CSSProperties {
  const bw = (ann.borderWidth ?? 1) * scale;
  const color = ann.borderColor ?? "#9ca8c8";
  const style = ann.borderStyle ?? "solid";
  const css: React.CSSProperties = { backgroundColor: ann.backgroundColor };
  if (bw > 0) {
    if (style === "underline") {
      css.borderBottom = `${bw}px solid ${color}`;
    } else {
      const cssStyle =
        style === "beveled" ? "outset" : style === "inset" ? "inset" : style;
      css.border = `${bw}px ${cssStyle} ${color}`;
    }
  }
  return css;
}

/**
 * Live-preview rendering of a NEW form field (form builder → Preview): a real
 * input bound to the transient preview values, keyed by field name so fields
 * sharing a name mirror each other exactly like the saved AcroForm will.
 */
export function FieldPreviewInput({
  ann,
  scale,
}: {
  ann: FormFieldAnnotation;
  scale: number;
}) {
  const app = useApp();
  const name = ann.fieldName;
  const stored = app.previewValues[name];
  const fontSize = Math.min(
    24,
    Math.max(9, (ann.fontSize && ann.fontSize > 0 ? ann.fontSize : ann.h * 0.55) * scale),
  );
  // The field's OWN border/background (from the properties panel) fully own
  // the look — including "no border" (width 0). Everything else here is
  // neutral editor chrome that never persists to the saved PDF: a faint
  // guide for a field that defines neither border nor fill (so it stays
  // findable in the builder) and a focus cue below.
  const hasOwnBorder = (ann.borderWidth ?? 1) > 0;
  const hasOwnFill = !!ann.backgroundColor;
  const base = cn(
    "h-full w-full rounded-[2px] text-slate-900 outline-none disabled:opacity-60",
    !hasOwnBorder && !hasOwnFill && "bg-white/40 ring-1 ring-inset ring-slate-300/70",
  );
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  // The configured widget appearance (border/background) previews too.
  const widgetCss = fieldWidgetCss(ann, scale);

  // Focus cue: PDF has no per-field focus color (the viewer that opens the
  // finished form owns focus highlighting), so on-screen we just echo the
  // field's OWN border color — neutral slate when it has none — instead of a
  // fixed blue that ignores the chosen styling. Inline so it can't be
  // overridden by the cascade.
  const [focused, setFocused] = useState(false);
  const focusColor = ann.borderColor ?? "#64748b";
  const focusStyle: React.CSSProperties = focused
    ? { boxShadow: `0 0 0 2px ${focusColor}59`, borderRadius: 2 }
    : {};
  const focusHandlers = {
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };

  switch (ann.fieldType) {
    case "checkbox": {
      const checked = stored !== undefined ? !!stored : ann.defaultValue === "true";
      return (
        <input
          type="checkbox"
          className={cn(base, "accent-slate-600")}
          style={{ ...widgetCss, ...focusStyle }}
          checked={checked}
          disabled={ann.readOnly}
          onChange={(e) => app.setPreviewValue(name, e.target.checked)}
          onPointerDown={stop}
          {...focusHandlers}
        />
      );
    }
    case "radio": {
      const group = stored !== undefined ? stored : ann.defaultValue;
      return (
        <input
          type="radio"
          className={cn(base, "rounded-full accent-slate-600")}
          style={{ ...widgetCss, ...focusStyle, borderRadius: focused ? "9999px" : undefined }}
          checked={group === (ann.optionValue ?? "")}
          disabled={ann.readOnly}
          onChange={() => app.setPreviewValue(name, ann.optionValue ?? "")}
          onPointerDown={stop}
          {...focusHandlers}
        />
      );
    }
    case "dropdown": {
      if (ann.listBox) {
        const sel = Array.isArray(stored)
          ? stored.map(String)
          : stored != null && stored !== ""
            ? [String(stored)]
            : ann.defaultValue
              ? [ann.defaultValue]
              : [];
        return (
          <select
            className={cn(base, "overflow-auto")}
            style={{ fontSize, color: ann.textColor, ...widgetCss, ...focusStyle }}
            multiple={!!ann.multiSelect}
            size={Math.max(2, (ann.options ?? []).length)}
            value={ann.multiSelect ? sel : sel[0] ?? ""}
            disabled={ann.readOnly}
            onChange={(e) =>
              ann.multiSelect
                ? app.setPreviewValue(
                    name,
                    Array.from(e.target.selectedOptions).map((o) => o.value),
                  )
                : app.setPreviewValue(name, e.target.value)
            }
            onPointerDown={stop}
            {...focusHandlers}
          >
            {(ann.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      }
      const value = String(stored ?? ann.defaultValue ?? "");
      return (
        <select
          className={base}
          style={{ fontSize, color: ann.textColor, ...widgetCss, ...focusStyle }}
          value={value}
          disabled={ann.readOnly}
          onChange={(e) => app.setPreviewValue(name, e.target.value)}
          onPointerDown={stop}
          {...focusHandlers}
        >
          <option value="" />
          {(ann.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case "signature":
      return (
        <div
          className={cn(
            base,
            "flex items-center justify-center gap-1 bg-white/70 text-[10px] text-slate-400",
          )}
          style={widgetCss}
          onPointerDown={stop}
        >
          <PenLine className="h-3 w-3" />
          signed after saving
        </div>
      );
    case "button":
      return (
        <button
          className="h-full w-full truncate rounded-[3px] border border-slate-400 bg-slate-200 px-1 text-slate-800 shadow-sm active:translate-y-px"
          style={{ fontSize, ...widgetCss, ...focusStyle }}
          onPointerDown={stop}
          {...focusHandlers}
        >
          {ann.buttonCaption ?? ann.fieldName}
        </button>
      );
    default: {
      // text & date
      const value = String(stored ?? ann.defaultValue ?? "");
      if (ann.fieldType === "text" && ann.comb && !ann.multiline && ann.maxLength && ann.maxLength > 0) {
        return (
          <CombField
            n={ann.maxLength}
            value={value}
            readOnly={!!ann.readOnly}
            className={cn(base, "overflow-hidden p-0")}
            style={{ fontSize, ...widgetCss, ...focusStyle }}
            onChange={(v) => app.setPreviewValue(name, v)}
          />
        );
      }
      const common = {
        value,
        disabled: ann.readOnly,
        maxLength: ann.maxLength,
        onPointerDown: stop,
        ...focusHandlers,
        style: {
          fontSize,
          textAlign: ann.align,
          color: ann.textColor,
          ...widgetCss,
          ...focusStyle,
        } as React.CSSProperties,
      };
      if (ann.fieldType === "text" && ann.multiline) {
        return (
          <textarea
            {...common}
            className={cn(base, "resize-none p-1")}
            onChange={(e) => app.setPreviewValue(name, e.target.value)}
          />
        );
      }
      // Format preset (currency/phone/…): show the formatted value when the
      // field isn't focused, and flag validation errors — mirroring the baked
      // Acrobat AF actions so the builder preview is WYSIWYG.
      const fmt = ann.fieldType === "text" ? ann.format : undefined;
      const fmtError = fmt && fmt !== "none" ? fieldValueError(fmt, value) : null;
      const displayValue = fmt && fmt !== "none" && !focused ? formatFieldValue(fmt, value) : value;
      return (
        <input
          {...common}
          type={ann.fieldType === "text" && ann.password ? "password" : "text"}
          value={displayValue}
          title={fmtError ?? undefined}
          placeholder={ann.fieldType === "date" ? ann.dateFormat ?? "mm/dd/yyyy" : undefined}
          className={cn(base, "px-1", fmtError && "ring-1 ring-inset ring-red-500")}
          onChange={(e) => app.setPreviewValue(name, e.target.value)}
        />
      );
    }
  }
}

/** Alignment / distribution tools shown when several fields are selected. */
export function MultiFieldTools({ page }: { page: number }) {
  const app = useApp();
  const ms = app.multiSelected;
  if (!ms || ms.ids.length < 2) return null;

  return (
    <>
      <div className="text-[11px] font-semibold">{ms.ids.length} fields selected</div>
      <AlignmentButtons page={page} />
      <div className="flex gap-1.5 border-t pt-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={() => app.duplicateSelectedAnnotation()}
        >
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => app.removeAnnotations(page, ms.ids)}
        >
          Delete
        </Button>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Drag any selected field to move them together; Shift-click adds or
        removes fields; arrow keys nudge.
      </p>
    </>
  );
}

/**
 * The form-builder properties panel — anchored beside a selected form field, it
 * exposes every field property (name, behavior, text, border/background, style,
 * options) and patches the annotation live. Baked into a real AcroForm field on
 * save via createFormFields.
 */
export function FieldProperties({
  ann,
  onPatch,
}: {
  ann: FormFieldAnnotation;
  onPatch: (p: Partial<FormFieldAnnotation>) => void;
}) {
  const isText = ann.fieldType === "text";
  const isDate = ann.fieldType === "date";
  const isTexty = isText || isDate;
  const isChoice = ann.fieldType === "dropdown" || ann.fieldType === "radio";
  const isCheck = ann.fieldType === "checkbox";
  const isBtn = ann.fieldType === "button";
  const isSig = ann.fieldType === "signature";
  const sm = "h-7 text-xs px-2";
  const lbl = "text-[10px] font-medium text-muted-foreground";

  return (
    <>
      <div className="text-[11px] font-semibold">{FIELD_TYPE_LABEL[ann.fieldType]} field</div>

      <div className="space-y-0.5">
        <div className={lbl}>Name</div>
        <Input
          key={`name-${ann.id}`}
          className={sm}
          defaultValue={ann.fieldName}
          onBlur={(e) => onPatch({ fieldName: e.target.value.trim() || ann.fieldName })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>

      <div className="space-y-0.5">
        <div className={lbl}>Tooltip</div>
        <Input
          key={`tip-${ann.id}`}
          className={sm}
          defaultValue={ann.tooltip ?? ""}
          placeholder="shown on hover"
          onBlur={(e) => onPatch({ tooltip: e.target.value || undefined })}
        />
      </div>

      {!isCheck && !isBtn && !isSig && (
        <div className="space-y-0.5">
          <div className={lbl}>{isChoice ? "Default value" : "Default text"}</div>
          <Input
            key={`def-${ann.id}`}
            className={sm}
            defaultValue={ann.defaultValue ?? ""}
            placeholder={isDate ? ann.dateFormat ?? "mm/dd/yyyy" : undefined}
            onBlur={(e) => onPatch({ defaultValue: e.target.value || undefined })}
          />
        </div>
      )}

      {isBtn && (
        <>
          <div className="space-y-0.5">
            <div className={lbl}>Caption</div>
            <Input
              key={`cap-${ann.id}`}
              className={sm}
              defaultValue={ann.buttonCaption ?? ""}
              placeholder={ann.fieldName}
              onBlur={(e) => onPatch({ buttonCaption: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-0.5">
            <div className={lbl}>Action</div>
            <Select
              className={sm}
              value={ann.buttonAction ?? "none"}
              onChange={(e) =>
                onPatch({
                  buttonAction: e.target.value as FormFieldAnnotation["buttonAction"],
                })
              }
            >
              <option value="none">None</option>
              <option value="reset">Reset form</option>
              <option value="submit">Submit form</option>
            </Select>
          </div>
          {ann.buttonAction === "submit" && (
            <div className="space-y-0.5">
              <div className={lbl}>Submit URL</div>
              <Input
                key={`url-${ann.id}`}
                className={sm}
                defaultValue={ann.submitUrl ?? ""}
                placeholder="https://…"
                onBlur={(e) => onPatch({ submitUrl: e.target.value || undefined })}
              />
            </div>
          )}
        </>
      )}

      {!isBtn && (
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-[11px]">
            <Checkbox
              checked={!!ann.required}
              onCheckedChange={(v: boolean) => onPatch({ required: v })}
            />
            Required
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <Checkbox
              checked={!!ann.readOnly}
              onCheckedChange={(v: boolean) => onPatch({ readOnly: v })}
            />
            Read-only
          </label>
        </div>
      )}

      {isCheck && (
        <label className="flex items-center gap-1.5 text-[11px]">
          <Checkbox
            checked={ann.defaultValue === "true"}
            onCheckedChange={(v: boolean) => onPatch({ defaultValue: v ? "true" : undefined })}
          />
          Checked by default
        </label>
      )}

      {isCheck && (
        <div className="space-y-0.5">
          <div className={lbl}>Export value</div>
          <Input
            key={`exp-${ann.id}`}
            className={sm}
            defaultValue={ann.exportValue ?? "Yes"}
            title="The value submitted when the box is checked"
            onBlur={(e) => onPatch({ exportValue: e.target.value.trim() || undefined })}
          />
        </div>
      )}

      {isDate && (
        <div className="space-y-0.5">
          <div className={lbl}>Date format</div>
          <Select
            className={sm}
            value={ann.dateFormat ?? DATE_FORMATS[0]}
            onChange={(e) => onPatch({ dateFormat: e.target.value })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
      )}

      {ann.fieldType === "dropdown" && (
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-[11px]">
            <Checkbox
              checked={!!ann.listBox}
              onCheckedChange={(v: boolean) => onPatch({ listBox: v })}
            />
            Show as list box
          </label>
          {ann.listBox ? (
            <label className="flex items-center gap-1.5 text-[11px]">
              <Checkbox
                checked={!!ann.multiSelect}
                onCheckedChange={(v: boolean) => onPatch({ multiSelect: v })}
              />
              Multi-select
            </label>
          ) : (
            <label className="flex items-center gap-1.5 text-[11px]">
              <Checkbox
                checked={!!ann.editable}
                onCheckedChange={(v: boolean) => onPatch({ editable: v })}
              />
              Allow custom text
            </label>
          )}
        </div>
      )}

      {(isTexty || isChoice || isBtn) && (
        <div className="space-y-1.5">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className={lbl}>Font size</div>
              <Select
                className={sm}
                value={String(ann.fontSize ?? 0)}
                onChange={(e) => onPatch({ fontSize: Number(e.target.value) })}
              >
                <option value="0">Auto</option>
                {[8, 9, 10, 11, 12, 14, 16, 18].map((s) => (
                  <option key={s} value={s}>
                    {s}pt
                  </option>
                ))}
              </Select>
            </div>
            {(isTexty || isChoice) && (
              <div className="space-y-0.5">
                <div className={lbl}>Color</div>
                <ColorSwatch
                  value={ann.textColor ?? "#000000"}
                  onChange={(v) => onPatch({ textColor: v })}
                />
              </div>
            )}
          </div>
          <div className="space-y-0.5">
            <div className={lbl}>Align</div>
            <ToggleGroup
              value={[ann.align ?? "left"]}
              onValueChange={(v: string[]) => v[0] && onPatch({ align: v[0] as FormFieldAnnotation["align"] })}
              aria-label="Text alignment"
            >
              {(["left", "center", "right"] as const).map((a) => (
                <ToggleGroupItem key={a} value={a} title={a} className="text-[11px] capitalize">
                  {a[0].toUpperCase()}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      )}

      {isText && (
        <div className="space-y-1.5">
          <div className="space-y-0.5">
            <div className={lbl}>Max length</div>
            <Input
              key={`max-${ann.id}`}
              type="number"
              min={0}
              className={sm}
              defaultValue={ann.maxLength ?? ""}
              placeholder="∞"
              onBlur={(e) =>
                onPatch({ maxLength: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="flex items-center gap-1.5 text-[11px]">
              <Checkbox
                checked={!!ann.multiline}
                onCheckedChange={(v: boolean) => onPatch({ multiline: v, comb: false })}
              />
              Multiline
            </label>
            {!ann.multiline && (
              <>
                <label
                  className="flex items-center gap-1.5 text-[11px]"
                  title="Fixed character cells — requires a max length"
                >
                  <Checkbox
                    checked={!!ann.comb}
                    onCheckedChange={(v: boolean) => onPatch({ comb: v, password: v ? false : ann.password })}
                  />
                  Comb (fixed cells)
                  {ann.comb && !ann.maxLength && (
                    <span className="text-[10px] text-amber-600">needs max length</span>
                  )}
                </label>
                <label className="flex items-center gap-1.5 text-[11px]" title="Masks the value with dots">
                  <Checkbox
                    checked={!!ann.password}
                    onCheckedChange={(v: boolean) => onPatch({ password: v, comb: v ? false : ann.comb })}
                  />
                  Password
                </label>
              </>
            )}
          </div>
        </div>
      )}

      {isText && !ann.multiline && !ann.comb && !ann.password && (
        <div className="space-y-0.5">
          <div className={lbl}>Format</div>
          <Select
            className={sm}
            value={ann.format ?? "none"}
            onChange={(e) => onPatch({ format: e.target.value as FormFieldAnnotation["format"] })}
          >
            <option value="none">None</option>
            <option value="number">Number</option>
            <option value="currency">Currency ($)</option>
            <option value="percent">Percentage</option>
            <option value="phone">Phone</option>
            <option value="ssn">SSN</option>
            <option value="zip">ZIP code</option>
            <option value="email">Email</option>
          </Select>
        </div>
      )}

      {isChoice && (
        <div className="space-y-0.5">
          <div className={lbl}>
            {ann.fieldType === "radio" ? "This option's value" : "Options (one per line)"}
          </div>
          {ann.fieldType === "dropdown" ? (
            <Textarea
              key={`opt-${ann.id}`}
              className="min-h-16 px-2 py-1 text-xs"
              defaultValue={(ann.options ?? []).join("\n")}
              onBlur={(e) =>
                onPatch({
                  options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean),
                })
              }
            />
          ) : (
            <Input
              key={`rv-${ann.id}`}
              className={sm}
              defaultValue={ann.optionValue ?? ""}
              onBlur={(e) => onPatch({ optionValue: e.target.value || undefined })}
            />
          )}
        </div>
      )}

      {/* Appearance */}
      <div className="space-y-1.5 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className={lbl}>Border</span>
          <div className="flex items-center gap-1">
            <ColorSwatch
              value={ann.borderColor ?? "#9ca8c8"}
              onChange={(v) => onPatch({ borderColor: v })}
              title="Border color"
            />
            <Select
              className="h-7 w-[4.5rem] px-2 text-xs"
              value={String(ann.borderWidth ?? 1)}
              onChange={(e) => onPatch({ borderWidth: Number(e.target.value) })}
            >
              {[0, 1, 2, 3].map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Select
          className={sm}
          value={ann.borderStyle ?? "solid"}
          onChange={(e) =>
            onPatch({ borderStyle: e.target.value as FormFieldAnnotation["borderStyle"] })
          }
        >
          {BORDER_STYLES.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </Select>
        <div className="flex items-center justify-between gap-2">
          <span className={lbl}>Background</span>
          {ann.backgroundColor ? (
            <div className="flex items-center gap-1">
              <ColorSwatch
                value={ann.backgroundColor}
                onChange={(v) => onPatch({ backgroundColor: v })}
                title="Background color"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onPatch({ backgroundColor: undefined })}
              >
                None
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => onPatch({ backgroundColor: "#eef2fb" })}
            >
              Add fill
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Contextual properties popover for a selected annotation (everything except
 * form fields, which have their own richer panel). Shows the controls relevant
 * to the kind — color, fill, stroke width, font — plus delete.
 */
/** Comment editor shown in the note's popover. Commits on blur (clicking
 *  outside moves focus out of the popup first); an empty comment is removed
 *  by AnnotationItem when the note is deselected. NOTE: no unmount-commit —
 *  StrictMode runs effect cleanups on mount and would delete fresh notes. */

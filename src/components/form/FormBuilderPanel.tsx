import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  CircleDot,
  Eye,
  List,
  MousePointerClick,
  PenLine,
  Plus,
  SquareCheck,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "../../store";
import { cn, uid } from "../../lib/utils";
import {
  FIELD_DND_MIME,
  FIELD_TYPES,
  TOOL_FOR_FIELD,
  allFormFields,
  nextFieldName,
  paletteDrag,
  validateForm,
} from "../../lib/formbuilder";
import type {
  Annotation,
  FormFieldAnnotation,
  FormFieldType,
  TextAnnotation,
} from "../../types";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

export const TYPE_ICON: Record<FormFieldType, LucideIcon> = {
  text: TextCursorInput,
  date: Calendar,
  checkbox: SquareCheck,
  radio: CircleDot,
  dropdown: List,
  signature: PenLine,
  button: MousePointerClick,
};

/** The form-builder sidebar: palette, snapping options, field outline
 *  (tab order), existing-field list and live validation. */
export function FormBuilderSidebar() {
  const app = useApp();
  const [radioDialog, setRadioDialog] = useState(false);

  const issues = useMemo(() => validateForm(app.annotations), [app.annotations]);

  return (
    <div className="scrollbar-soft flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      {/* Mode header */}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={app.formPreview ? "default" : "outline"}
          className="h-7 flex-1 gap-1.5 text-xs"
          onClick={() => app.setFormPreview(!app.formPreview)}
          title="Try the form without leaving the builder"
        >
          <Eye className="h-3.5 w-3.5" />
          {app.formPreview ? "Previewing — click to design" : "Preview"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => app.setFormBuilder(false)}
          title="Leave the form builder"
        >
          <X className="h-3.5 w-3.5" />
          Done
        </Button>
      </div>

      {/* Palette */}
      <section>
        <PanelHeading>Add fields</PanelHeading>
        <div className="grid grid-cols-2 gap-1">
          {FIELD_TYPES.map((m) => {
            const Icon = TYPE_ICON[m.type];
            const armed = app.tool === TOOL_FOR_FIELD[m.type];
            return (
              <button
                key={m.type}
                draggable
                onDragStart={(e) => {
                  paletteDrag.type = m.type;
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(FIELD_DND_MIME, m.type);
                }}
                onDragEnd={() => {
                  paletteDrag.type = null;
                }}
                onClick={() =>
                  app.setTool(armed ? "select" : TOOL_FOR_FIELD[m.type])
                }
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                  armed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-foreground hover:bg-muted",
                )}
                title={`Drag onto the page, or click then click/drag to place${m.small ? " (stays armed)" : ""}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {m.label}
              </button>
            );
          })}
          <button
            onClick={() => setRadioDialog(true)}
            className="col-span-2 flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Create a whole radio group with labeled options at once"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            Radio group…
          </button>
        </div>
      </section>

      {/* Placement aids */}
      <section>
        <PanelHeading>Placement</PanelHeading>
        <div className="space-y-1.5 text-[11px]">
          <label className="flex items-center gap-1.5">
            <Checkbox checked={app.snapEnabled} onCheckedChange={app.setSnapEnabled} />
            Snap to other fields
          </label>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5">
              <Checkbox checked={app.gridEnabled} onCheckedChange={app.setGridEnabled} />
              Grid
            </label>
            <Select
              className="h-6 w-20 px-1.5 text-[11px]"
              value={String(app.gridSize)}
              onChange={(e) => app.setGridSize(Number(e.target.value))}
              disabled={!app.gridEnabled}
            >
              {[6, 8, 12, 16, 24, 36].map((g) => (
                <option key={g} value={g}>
                  {g} pt
                </option>
              ))}
            </Select>
          </div>
        </div>
      </section>

      {/* Validation */}
      <section>
        <PanelHeading>
          Checks
          {issues.length > 0 && (
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 py-px text-[10px] font-semibold",
                issues.some((i) => i.severity === "error")
                  ? "bg-destructive/15 text-destructive"
                  : "bg-amber-500/15 text-amber-600",
              )}
            >
              {issues.length}
            </span>
          )}
        </PanelHeading>
        {issues.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            No problems found
          </p>
        ) : (
          <ul className="space-y-1">
            {issues.map((iss, i) => (
              <li key={i}>
                <button
                  className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-snug hover:bg-muted"
                  onClick={() => {
                    if (iss.page !== undefined) app.scrollToPage(iss.page);
                    if (iss.page !== undefined && iss.ids?.length) {
                      app.setSelected({ page: iss.page, id: iss.ids[0] });
                      if (iss.ids.length > 1) {
                        app.setMultiSelected({ page: iss.page, ids: iss.ids });
                      }
                    }
                  }}
                >
                  <AlertTriangle
                    className={cn(
                      "mt-px h-3.5 w-3.5 shrink-0",
                      iss.severity === "error" ? "text-destructive" : "text-amber-500",
                    )}
                  />
                  {iss.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FieldOutline />
      <ExistingFields />

      {radioDialog && <RadioGroupDialog onClose={() => setRadioDialog(false)} />}
    </div>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

/** New (unsaved) fields in tab order, grouped by page, with reorder/delete. */
function FieldOutline() {
  const app = useApp();
  const fields = allFormFields(app.annotations);

  if (!fields.length) {
    return (
      <section>
        <PanelHeading>Fields</PanelHeading>
        <p className="text-[11px] text-muted-foreground">
          No new fields yet — pick a type above, then click on the page.
        </p>
      </section>
    );
  }

  let lastPage = -1;
  return (
    <section>
      <PanelHeading>Fields · tab order</PanelHeading>
      <ul>
        {fields.map(({ page, ann }, idx) => {
          const pageHeader = page !== lastPage;
          lastPage = page;
          const Icon = TYPE_ICON[ann.fieldType];
          const isSel =
            (app.selected?.page === page && app.selected.id === ann.id) ||
            (app.multiSelected?.page === page &&
              app.multiSelected.ids.includes(ann.id));
          const samePage = fields.filter((f) => f.page === page);
          const posOnPage = samePage.findIndex((f) => f.ann.id === ann.id);
          return (
            <li key={ann.id}>
              {pageHeader && (
                <div className="mt-1.5 px-1 pb-0.5 text-[10px] font-medium text-muted-foreground/70 first:mt-0">
                  Page {page + 1}
                </div>
              )}
              <div
                className={cn(
                  "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px]",
                  isSel ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                )}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={(e) => {
                    app.scrollToPage(page);
                    if (e.shiftKey) app.toggleMultiSelected(page, ann.id);
                    else app.setSelected({ page, id: ann.id });
                  }}
                  title={`${ann.fieldName} — click to select, Shift-click to multi-select (#${idx + 1} in tab order)`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {ann.fieldName}
                    {ann.fieldType === "radio" && ann.optionValue && (
                      <span className="text-muted-foreground"> · {ann.optionValue}</span>
                    )}
                  </span>
                </button>
                <span className="hidden shrink-0 items-center group-hover:flex">
                  <IconBtn
                    title="Earlier in tab order"
                    disabled={posOnPage === 0}
                    onClick={() => app.reorderFormField(page, ann.id, -1)}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </IconBtn>
                  <IconBtn
                    title="Later in tab order"
                    disabled={posOnPage === samePage.length - 1}
                    onClick={() => app.reorderFormField(page, ann.id, 1)}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </IconBtn>
                  <IconBtn
                    title="Delete field"
                    onClick={() => app.removeAnnotations(page, [ann.id])}
                    danger
                  >
                    <Trash2 className="h-3 w-3" />
                  </IconBtn>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-30",
        danger
          ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

interface ExistingWidget {
  key: string;
  name: string;
  page: number;
  rect: { x: number; y: number; w: number; h: number };
}

/** Fields already present in the document's AcroForm (from the loaded PDF). */
function ExistingFields() {
  const app = useApp();
  const [widgets, setWidgets] = useState<ExistingWidget[]>([]);

  useEffect(() => {
    const pdf = app.pdf;
    if (!pdf) {
      setWidgets([]);
      return;
    }
    let alive = true;
    (async () => {
      const out: ExistingWidget[] = [];
      try {
        for (let p = 0; p < pdf.numPages; p++) {
          const page = await pdf.getPage(p + 1);
          const annots = await page.getAnnotations();
          const vp = page.getViewport({ scale: 1 });
          for (const a of annots as any[]) {
            if (a.subtype !== "Widget" || !a.fieldName || a.hidden) continue;
            const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
            const rect = {
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              w: Math.abs(x2 - x1),
              h: Math.abs(y2 - y1),
            };
            out.push({
              // Must match Viewer's fieldOpKey so pending edits line up.
              key: `${a.fieldName}|${p}|${Math.round(rect.x)},${Math.round(rect.y)}`,
              name: a.fieldName as string,
              page: p,
              rect,
            });
          }
        }
      } catch {
        /* no form */
      }
      if (alive) setWidgets(out);
    })();
    return () => {
      alive = false;
    };
  }, [app.pdf, app.docVersion]);

  if (!widgets.length) return null;

  return (
    <section>
      <PanelHeading>Existing fields</PanelHeading>
      <ul>
        {widgets.map((w) => {
          const op = app.fieldOps[w.key];
          const isSel = app.selectedField?.key === w.key;
          return (
            <li key={w.key}>
              <div
                className={cn(
                  "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px]",
                  isSel ? "bg-primary/10" : "hover:bg-muted",
                  op?.deleted && "opacity-45",
                )}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => {
                    app.scrollToPage(w.page);
                    app.setSelected(null);
                    app.setSelectedField({
                      key: w.key,
                      fieldName: w.name,
                      pageIndex: w.page,
                      origRect: w.rect,
                    });
                  }}
                  title={`${w.name} — page ${w.page + 1}`}
                >
                  <TextCursorInput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className={cn("truncate", op?.deleted && "line-through")}>
                    {op?.newName ?? w.name}
                  </span>
                  <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground/70">
                    p.{w.page + 1}
                  </span>
                </button>
                <span className="hidden shrink-0 group-hover:flex">
                  {op?.deleted ? (
                    <IconBtn
                      title="Restore field"
                      onClick={() =>
                        app.upsertFieldOp(
                          {
                            key: w.key,
                            fieldName: w.name,
                            pageIndex: w.page,
                            origRect: w.rect,
                          },
                          { deleted: undefined },
                        )
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </IconBtn>
                  ) : (
                    <IconBtn
                      title="Delete field"
                      danger
                      onClick={() =>
                        app.upsertFieldOp(
                          {
                            key: w.key,
                            fieldName: w.name,
                            pageIndex: w.page,
                            origRect: w.rect,
                          },
                          { deleted: true },
                        )
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Create a labeled radio group in one go (N options, stacked or in a row). */
function RadioGroupDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState(() => nextFieldName(app.annotations, "radio"));
  const [optionsText, setOptionsText] = useState("Option 1\nOption 2\nOption 3");
  const [layout, setLayout] = useState<"vertical" | "horizontal">("vertical");
  const [withLabels, setWithLabels] = useState(true);

  const create = () => {
    const labels = optionsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!labels.length) return;
    const page = app.currentPage;
    const anns: Annotation[] = [];
    const seen = new Set<string>();
    const size = 14;
    const gap = layout === "vertical" ? 26 : 110;
    labels.forEach((label, i) => {
      let value = label;
      let n = 2;
      while (seen.has(value)) value = `${label}_${n++}`;
      seen.add(value);
      const x = 72 + (layout === "horizontal" ? i * gap : 0);
      const y = 96 + (layout === "vertical" ? i * gap : 0);
      const groupId = withLabels ? uid() : undefined;
      const radio: FormFieldAnnotation = {
        id: uid(),
        kind: "formfield",
        fieldType: "radio",
        fieldName: name.trim() || "choice",
        optionValue: value,
        x,
        y,
        w: size,
        h: size,
        groupId,
      };
      anns.push(radio);
      if (withLabels) {
        const text: TextAnnotation = {
          id: uid(),
          kind: "text",
          groupId,
          x: x + size + 7,
          y: y + size / 2 - 7,
          w: Math.max(60, label.length * 6.5),
          h: 15,
          text: label,
          fontSize: 11,
          color: "#111827",
        };
        anns.push(text);
      }
    });
    app.addAnnotations(page, anns);
    const radioIds = anns
      .filter((a) => a.kind === "formfield")
      .map((a) => a.id);
    app.setSelected({ page, id: radioIds[0] });
    if (radioIds.length > 1) app.setMultiSelected({ page, ids: radioIds });
    app.scrollToPage(page);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs space-y-3 rounded-xl border bg-card p-4 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">New radio group</h2>
          <Button variant="ghost" size="icon" className="-mr-1 h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-0.5">
          <div className="text-[10px] font-medium text-muted-foreground">Group name</div>
          <Input
            className="h-7 px-2 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-0.5">
          <div className="text-[10px] font-medium text-muted-foreground">
            Options (one per line)
          </div>
          <Textarea
            className="min-h-20 px-2 py-1 text-xs"
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <label className="flex items-center gap-1.5">
            <Checkbox checked={withLabels} onCheckedChange={setWithLabels} />
            Add text labels
          </label>
          <Select
            className="h-6 w-24 px-1.5 text-[11px]"
            value={layout}
            onChange={(e) => setLayout(e.target.value as "vertical" | "horizontal")}
          >
            <option value="vertical">Stacked</option>
            <option value="horizontal">In a row</option>
          </Select>
        </div>

        <p className="text-[10px] leading-snug text-muted-foreground">
          Placed on page {app.currentPage + 1} — drag the options into position
          afterwards.
        </p>

        <Button size="sm" className="h-7 w-full text-xs" onClick={create}>
          Create {optionsText.split("\n").filter((s) => s.trim()).length} options
        </Button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { FilePlus2, FileText, FormInput, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import {
  PAGE_SIZES,
  TEMPLATES,
  createBlankPdf,
  type Orientation,
  type PageSizeId,
  type TemplateDef,
} from "../../lib/templates";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function TemplatesScreen() {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [size, setSize] = useState<PageSizeId>("letter");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [pages, setPages] = useState(1);

  const createBlank = async () => {
    if (busy) return;
    setBusy("__blank__");
    try {
      const bytes = await createBlankPdf({ size, orientation, pages });
      await app.openBytes(bytes, "Untitled.pdf");
      app.setScreen("viewer");
      app.setEditMode(true);
      const count = Math.max(1, Math.min(100, Math.floor(pages)));
      toast.success(
        `Blank PDF created — ${count} ${count === 1 ? "page" : "pages"}.`,
      );
    } catch (err) {
      toast.error(
        `Couldn't create blank PDF: ${err instanceof Error ? err.message : "error"}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const open = async (t: TemplateDef) => {
    if (busy) return;
    setBusy(t.id);
    try {
      const bytes = await t.build();
      await app.openBytes(bytes, `${t.name}.pdf`);
      app.setScreen("viewer");
      app.setEditMode(true);
      if (t.category === "form") {
        toast.success(`${t.name} opened — fill the fields, then Save.`);
      } else {
        toast.success(`${t.name} opened.`);
      }
    } catch (err) {
      toast.error(`Couldn't create ${t.name}: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  };

  const groups: Array<{ key: TemplateDef["category"]; label: string; hint: string }> = [
    { key: "form", label: "Fillable forms", hint: "Real form fields, ready to fill in the editor." },
    { key: "document", label: "Documents", hint: "Blank starting points to write on." },
  ];

  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-lg font-semibold">New document</h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          Start blank with a chosen page size, or from a ready-made layout.
          Forms open with fillable fields; save writes your entries into the PDF.
        </p>

        {/* Blank document builder */}
        <div className="mb-7 rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePlus2 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium">Blank PDF</div>
              <div className="text-xs text-muted-foreground">
                An empty document to start from scratch.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Page size
              </span>
              <Select
                aria-label="Page size"
                className="w-44"
                value={size}
                onChange={(e) => setSize(e.target.value as PageSizeId)}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.hint})
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Orientation
              </span>
              <ToggleGroup
                value={[orientation]}
                onValueChange={(v: string[]) => {
                  if (v[0]) setOrientation(v[0] as Orientation);
                }}
                className="h-9 p-1"
              >
                <ToggleGroupItem value="portrait" className="h-7 w-auto px-3 text-xs">
                  Portrait
                </ToggleGroupItem>
                <ToggleGroupItem value="landscape" className="h-7 w-auto px-3 text-xs">
                  Landscape
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Pages
              </span>
              <Input
                type="number"
                min={1}
                max={100}
                value={pages}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setPages(Number.isNaN(n) ? 1 : Math.max(1, Math.min(100, n)));
                }}
                className="w-24"
              />
            </label>
            <button
              disabled={!!busy}
              onClick={() => void createBlank()}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors",
                "hover:bg-primary/90 disabled:opacity-60",
              )}
            >
              {busy === "__blank__" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FilePlus2 className="h-4 w-4" />
              )}
              Create blank
            </button>
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.key} className="mb-7">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">{g.label}</h2>
              <span className="text-xs text-muted-foreground">{g.hint}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TEMPLATES.filter((t) => t.category === g.key).map((t) => {
                const Icon = t.category === "form" ? FormInput : FileText;
                const loading = busy === t.id;
                return (
                  <button
                    key={t.id}
                    disabled={!!busy}
                    onClick={() => void open(t)}
                    className={cn(
                      "group flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-colors",
                      "hover:border-primary/60 hover:bg-accent disabled:opacity-60",
                    )}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Icon className="h-4 w-4" />
                      )}
                    </div>
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs leading-snug text-muted-foreground">
                      {t.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

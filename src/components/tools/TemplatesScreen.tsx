import { useState } from "react";
import { FileText, FormInput, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { TEMPLATES, type TemplateDef } from "../../lib/templates";
import { cn } from "../../lib/utils";

export function TemplatesScreen() {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);

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
        <h1 className="text-lg font-semibold">New from template</h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          Start from a ready-made layout. Forms open with fillable fields; save
          writes your entries into the PDF.
        </p>

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

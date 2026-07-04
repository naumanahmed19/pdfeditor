import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Slider } from "../ui/slider";
import { cn } from "../../lib/utils";
import { checkConnection, DEFAULT_MODEL } from "../../lib/ai";
import { ACCENTS } from "../../lib/accents";
import type { ProviderKind } from "../../types";

const PROVIDERS: Array<{ value: ProviderKind; label: string; hint: string }> = [
  {
    value: "browser",
    label: "Built-in (Gemma 4)",
    hint: "Runs in your browser — no setup. Downloads once (~2 GB). Uses your GPU (WebGPU) when available, otherwise CPU (slower).",
  },
  { value: "ollama", label: "Ollama", hint: "Local models via Ollama (default port 11434)" },
  { value: "lmstudio", label: "LM Studio", hint: "Local models via LM Studio server (default port 1234)" },
  { value: "openai_compatible", label: "Custom API", hint: "Any OpenAI-compatible endpoint" },
];

export function SettingsScreen() {
  const app = useApp();
  const s = app.settings;
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const refresh = async () => {
    setChecking(true);
    setStatus(null);
    const r = await checkConnection(app.settings);
    setChecking(false);
    setOk(r.ok);
    setModels(r.models);
    setStatus(
      r.ok
        ? `Connected — ${r.models.length} model(s) found`
        : `Not connected: ${r.error ?? "server unreachable"}`,
    );
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.provider, s.ollamaBaseUrl, s.lmStudioBaseUrl, s.customBaseUrl]);

  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="pb-5 pt-1 text-sm text-muted-foreground">
          Configure the AI provider used by the assistant and “Edit with AI” features.
          Everything runs against your own local or remote endpoint — documents never
          leave your machine otherwise.
        </p>

        <Panel title="Appearance">
          <Row title="Theme" description="Color scheme for the whole app.">
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    if (app.theme !== t) app.toggleTheme();
                  }}
                  className={cn(
                    "h-7 rounded-sm px-3 text-xs font-medium capitalize transition",
                    app.theme === t
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Accent color" description="Primary color used across buttons and highlights.">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={app.accent === a.id}
                  onClick={() => app.setAccent(a.id)}
                  className={cn(
                    "h-6 w-6 rounded-full border transition",
                    app.accent === a.id
                      ? "ring-2 ring-ring ring-offset-2 ring-offset-card"
                      : "border-border hover:scale-110",
                  )}
                  style={{ backgroundColor: a.swatch }}
                />
              ))}
            </div>
          </Row>
        </Panel>

        <Panel title="AI provider">
          <Row title="Provider" description="Where AI requests are sent.">
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  title={p.hint}
                  onClick={() => app.setSettings({ ...s, provider: p.value })}
                  className={cn(
                    "h-7 rounded-sm px-3 text-xs font-medium transition",
                    s.provider === p.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Row>

          {s.provider === "ollama" && (
            <Row title="Ollama URL" description="Base URL of the Ollama server.">
              <Input
                className="w-64"
                value={s.ollamaBaseUrl}
                onChange={(e) => app.setSettings({ ...s, ollamaBaseUrl: e.target.value })}
              />
            </Row>
          )}
          {s.provider === "lmstudio" && (
            <Row title="LM Studio URL" description="Base URL of the LM Studio local server.">
              <Input
                className="w-64"
                value={s.lmStudioBaseUrl}
                onChange={(e) => app.setSettings({ ...s, lmStudioBaseUrl: e.target.value })}
              />
            </Row>
          )}
          {s.provider === "openai_compatible" && (
            <>
              <Row title="Base URL" description="e.g. https://api.example.com (without /v1).">
                <Input
                  className="w-64"
                  value={s.customBaseUrl}
                  placeholder="https://…"
                  onChange={(e) => app.setSettings({ ...s, customBaseUrl: e.target.value })}
                />
              </Row>
              <Row title="API key" description="Sent as a Bearer token.">
                <Input
                  className="w-64"
                  type="password"
                  value={s.customApiKey}
                  onChange={(e) => app.setSettings({ ...s, customApiKey: e.target.value })}
                />
              </Row>
            </>
          )}

          {s.provider === "browser" ? (
            <Row
              title="Model"
              description="Gemma 4 (E2B) runs in your browser via Transformers.js — GPU (WebGPU) when available, otherwise CPU. It downloads once (~2 GB) on first use, then works offline — no server or API key."
            >
              <span className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground">
                Gemma 4 · built-in
              </span>
            </Row>
          ) : (
            <Row
              title="Model"
              description={`Default is “${DEFAULT_MODEL}”. If the exact name isn't installed, the closest installed match is used.`}
            >
              <Input
                className="w-64"
                value={s.model}
                onChange={(e) => app.setSettings({ ...s, model: e.target.value })}
              />
            </Row>
          )}

          <Row
            title="Connection"
            description={status ?? "Checking…"}
            descriptionClass={ok === false ? "text-destructive" : ok ? "text-emerald-600" : undefined}
          >
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refresh()} disabled={checking}>
              {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Test
            </Button>
          </Row>

          {s.provider !== "browser" && models.length > 0 && (
            <div className="border-t px-4 py-3">
              <p className="pb-2 text-xs font-medium text-muted-foreground">
                Installed models — click to use
              </p>
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => (
                  <button
                    key={m}
                    onClick={() => app.setSettings({ ...s, model: m })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition-colors",
                      s.model === m
                        ? "border-foreground/60 bg-accent font-medium"
                        : "border-input hover:bg-accent",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Generation">
          <Row title="Temperature" description="Lower is more focused, higher more creative.">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Slider
                className="w-40"
                aria-label="Temperature"
                min={0}
                max={1}
                step={0.1}
                value={s.temperature}
                onValueChange={(v) => app.setSettings({ ...s, temperature: v })}
              />
              <span className="w-6 tabular-nums">{s.temperature.toFixed(1)}</span>
            </div>
          </Row>
          <Row
            title="Document context"
            description="Max characters of PDF text sent with each request. Reduce for small local models."
          >
            <Select
              value={s.contextChars}
              onChange={(e) => app.setSettings({ ...s, contextChars: Number(e.target.value) })}
              aria-label="Document context size"
              className="h-8 w-36 px-2 text-xs"
            >
              {[4000, 8000, 14000, 24000, 40000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} chars
                </option>
              ))}
            </Select>
          </Row>
        </Panel>

        <p className="pt-4 text-xs text-muted-foreground">
          Tip: for Ollama run <code className="rounded bg-muted px-1 py-0.5">ollama pull gemma3</code>,
          for LM Studio enable the local server (Developer tab) and enable CORS if requests fail.
        </p>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-5">
      <p className="pb-2 text-sm font-medium">{title}</p>
      <div className="overflow-hidden rounded-md border bg-card">{children}</div>
    </div>
  );
}

function Row({
  title,
  description,
  descriptionClass,
  children,
}: {
  title: string;
  description?: string;
  descriptionClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t px-4 py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm">{title}</p>
        {description && (
          <p className={cn("pt-0.5 text-xs text-muted-foreground", descriptionClass)}>
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

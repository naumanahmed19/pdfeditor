import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Combobox } from "../ui/combobox";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Slider } from "../ui/slider";
import { Tip } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import {
  checkConnection,
  DEFAULT_MODEL,
  GOOGLE_GENERATIVE_AI_DEFAULT_URL,
  OPENAI_DEFAULT_URL,
  OPENROUTER_DEFAULT_URL,
  VERCEL_AI_GATEWAY_DEFAULT_URL,
} from "../../lib/ai";
import {
  clearBrowserModelCache,
  type ModelLoadProgress,
  preloadBrowserModel,
  verifyBrowserModelDownloaded,
  webgpuAvailable,
} from "../../lib/browserLlm";
import {
  availableBrowserModels,
  type BrowserModelConfig,
  effectiveBrowserModel,
} from "../../lib/modelConfig";
import { isHandheldDevice } from "../../lib/device";
import { OCR_LANGUAGE_OPTIONS } from "../../lib/ocrLanguages";
import { ACCENTS } from "../../lib/accents";
import { FORM_FIELD_THEMES, setFormFieldSkin, useFormFieldSkin } from "../viewer/formFieldTheme";
import type { ProviderKind } from "../../types";

const PROVIDERS: Array<{ value: ProviderKind; label: string; hint: string }> = [
  {
    value: "browser",
    label: "Built-in",
    hint: "Runs privately on your device — no setup or API key. Downloads once, then works offline. Uses your GPU when available, otherwise CPU (slower).",
  },
  { value: "ollama", label: "Ollama", hint: "Local models via Ollama (default port 11434)" },
  { value: "lmstudio", label: "LM Studio", hint: "Local models via LM Studio server (default port 1234)" },
  { value: "openai_compatible", label: "Custom API", hint: "Any OpenAI-compatible endpoint" },
];

/** On a phone/tablet only a remote Custom API works: Ollama & LM Studio speak to
 *  localhost (the device itself — unreachable), and the built-in on-device model
 *  is desktop-only because its weights OOM-crash a mobile tab. */
const HANDHELD_PROVIDERS: ProviderKind[] = ["openai_compatible"];

const CUSTOM_API_PRESETS = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: OPENAI_DEFAULT_URL,
  },
  {
    id: "gemini",
    label: "Gemini",
    baseUrl: GOOGLE_GENERATIVE_AI_DEFAULT_URL,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_DEFAULT_URL,
  },
  {
    id: "vercel",
    label: "Vercel AI Gateway",
    baseUrl: VERCEL_AI_GATEWAY_DEFAULT_URL,
  },
] as const;

export function SettingsScreen() {
  const app = useApp();
  const s = app.settings;
  const fieldSkin = useFormFieldSkin();
  const handheld = isHandheldDevice();
  const providers = handheld
    ? PROVIDERS.filter((p) => HANDHELD_PROVIDERS.includes(p.value))
    : PROVIDERS;
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const modelOptions = [...new Set(models.filter(Boolean))];
  const baseUrlOptions = CUSTOM_API_PRESETS.map((preset) => ({
    value: preset.baseUrl,
    label: preset.label,
  }));
  const usesGoogleApi =
    s.customBaseUrl.trim().replace(/\/+$/, "") === GOOGLE_GENERATIVE_AI_DEFAULT_URL;

  const setCustomBaseUrl = (value: string) => {
    app.setSettings({
      ...s,
      customBaseUrl: value,
    });
  };

  // A provider persisted on another device (or before this build) could be one
  // we now hide on handhelds — fall back to Custom API, the only provider a
  // phone/tablet can actually reach.
  useEffect(() => {
    if (handheld && !HANDHELD_PROVIDERS.includes(s.provider)) {
      app.setSettings({ ...s, provider: "openai_compatible" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handheld]);

  const refresh = async () => {
    setChecking(true);
    setStatus(null);
    setModels([]);
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
  }, [s.provider, s.ollamaBaseUrl, s.lmStudioBaseUrl, s.customBaseUrl, s.customApiKey]);

  return (
    <div className="scrollbar-soft h-full overflow-y-auto p-4 sm:p-6">
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
          <Row
            title="Form field skin"
            description="How fillable form fields look — a blue tint, or a neutral default."
          >
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {(["blue", "shadcn"] as const).map((skin) => (
                <button
                  key={skin}
                  onClick={() => setFormFieldSkin(skin)}
                  className={cn(
                    "h-7 rounded-sm px-3 text-xs font-medium transition",
                    fieldSkin === skin
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {FORM_FIELD_THEMES[skin].label}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Accent color" description="Primary color used across buttons and highlights.">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {ACCENTS.map((a) => (
                <Tip key={a.id} label={a.label}>
                  <button
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
                </Tip>
              ))}
            </div>
          </Row>
        </Panel>

        <Panel title="AI provider">
          <Row title="Provider" description="Where AI requests are sent.">
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {providers.map((p) => (
                <Tip key={p.value} label={p.label} desc={p.hint}>
                  <button
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
                </Tip>
              ))}
            </div>
          </Row>

          {s.provider === "ollama" && (
            <Row title="Ollama URL" description="Base URL of the Ollama server.">
              <Input
                className="w-full sm:w-64"
                value={s.ollamaBaseUrl}
                onChange={(e) => app.setSettings({ ...s, ollamaBaseUrl: e.target.value })}
              />
            </Row>
          )}
          {s.provider === "lmstudio" && (
            <Row title="LM Studio URL" description="Base URL of the LM Studio local server.">
              <Input
                className="w-full sm:w-64"
                value={s.lmStudioBaseUrl}
                onChange={(e) => app.setSettings({ ...s, lmStudioBaseUrl: e.target.value })}
              />
            </Row>
          )}
          {s.provider === "openai_compatible" && (
            <>
              <Row
                title="API base URL"
                description="Choose a preset or type the exact OpenAI-compatible root."
              >
                <Combobox
                  value={s.customBaseUrl}
                  options={baseUrlOptions}
                  onValueChange={setCustomBaseUrl}
                  placeholder="https://api.example.com/v1"
                  searchPlaceholder="Search or paste a base URL..."
                  emptyText="No matching URL."
                  allowCustom
                  aria-label="API base URL"
                  className="w-full sm:w-80"
                />
              </Row>
              <Row
                title="API key"
                description={`${usesGoogleApi ? "Sent as x-goog-api-key." : "Sent as a Bearer token."} Kept only for this app session.`}
              >
                <Input
                  className="w-full sm:w-64"
                  type="password"
                  value={s.customApiKey}
                  onChange={(e) => app.setSettings({ ...s, customApiKey: e.target.value })}
                />
              </Row>
            </>
          )}

          {s.provider === "browser" ? (
            <BrowserModelSection handheld={handheld} />
          ) : (
            <Row
              title="Model"
              description={
                s.provider === "openai_compatible"
                  ? "Choose a discovered model, or enter any model ID supported by the endpoint."
                  : `Choose a discovered model or enter one manually. Default is "${DEFAULT_MODEL}".`
              }
            >
              <Combobox
                value={s.model}
                options={modelOptions.map((m) => ({ value: m }))}
                onValueChange={(model) => app.setSettings({ ...s, model })}
                placeholder="Enter model ID"
                searchPlaceholder="Search or enter a model ID..."
                emptyText="No matching model."
                allowCustom
                aria-label="Model"
                className="w-full sm:w-80"
              />
            </Row>
          )}

          {s.provider !== "browser" && (
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

        <Panel title="OCR">
          <Row
            title="Recognition language"
            description={
              "Used by “Make searchable (OCR)”. Each language's model downloads once, then " +
              "recognition runs on your device. Right-to-left and vertical scripts (e.g. Arabic, " +
              "Hebrew, Japanese) may come out less accurate."
            }
          >
            <Combobox
              value={app.ocrLanguage}
              options={[...OCR_LANGUAGE_OPTIONS]}
              onValueChange={app.setOcrLanguage}
              showLabel
              searchPlaceholder="Search languages…"
              emptyText="No matching language."
              aria-label="OCR recognition language"
              className="h-8 w-full text-xs sm:w-56"
            />
          </Row>
        </Panel>

        {!handheld && (
          <p className="pt-4 text-xs text-muted-foreground">
            Tip: for Ollama run <code className="rounded bg-muted px-1 py-0.5">ollama pull gemma3</code>,
            for LM Studio enable the local server (Developer tab) and enable CORS if requests fail.
          </p>
        )}
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
    <div className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
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

type DownloadState = "checking" | "idle" | "downloading" | "preparing" | "ready" | "error";

/**
 * The built-in model chooser: a segmented picker on desktop (Gemma 4 vs the
 * lightweight Qwen2.5), or a locked note on phones/tablets — which are pinned to
 * the mobile-safe model because Gemma 4's ~3 GB weights OOM-crash a mobile tab.
 * Below it, download controls for whichever model is selected.
 */
function BrowserModelSection({ handheld }: { handheld: boolean }) {
  const app = useApp();
  const s = app.settings;
  const models = availableBrowserModels(handheld);
  const selected = effectiveBrowserModel(s.browserModelId, handheld);

  return (
    <>
      <Row
        title="Model"
        description={
          handheld
            ? "Phones and tablets use the lightweight Qwen2.5 — Gemma 4 (~3 GB) needs a desktop, so it's desktop-only."
            : "Higher quality vs. a much smaller, faster download. Switch any time; each caches separately."
        }
      >
        {handheld ? (
          <span className="inline-flex items-center rounded-md border border-input bg-muted/60 px-2.5 py-1 text-xs font-medium">
            {selected.name}
          </span>
        ) : (
          <div className="flex flex-wrap justify-end gap-0.5 rounded-md bg-muted p-0.5">
            {models.map((m) => (
              <Tip key={m.id} label={m.name} desc={`${m.blurb} (${m.sizeLabel})`}>
                <button
                  onClick={() => app.setSettings({ ...s, browserModelId: m.id })}
                  className={cn(
                    "h-7 rounded-sm px-3 text-xs font-medium transition",
                    selected.id === m.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {m.name}
                </button>
              </Tip>
            ))}
          </div>
        )}
      </Row>
      {/* Remount on model switch so download state reflects the selected model. */}
      <BrowserModelPanel key={selected.id} model={selected} />
    </>
  );
}

/**
 * Download status, progress and controls for a given built-in model — lets
 * users pre-download it, watch progress, retry a failed load, or clear a bad
 * cache, all without having to start a chat.
 */
function BrowserModelPanel({ model }: { model: BrowserModelConfig }) {
  const [state, setState] = useState<DownloadState>("checking");
  const [progress, setProgress] = useState<ModelLoadProgress | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const handheld = isHandheldDevice();
  const gpu = webgpuAvailable();

  useEffect(() => {
    let alive = true;
    void verifyBrowserModelDownloaded(model).then((ready) => {
      if (alive) setState(ready ? "ready" : "idle");
    });
    return () => {
      alive = false;
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [model]);

  const start = async () => {
    setError("");
    setProgress(null);
    setState("downloading");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await preloadBrowserModel(model, (p) => {
        if (!mountedRef.current) return;
        setProgress(p);
        setState(p.phase === "preparing" ? "preparing" : "downloading");
      }, ac.signal);
      if (mountedRef.current) {
        setState("ready");
        setProgress(null);
        toast.success(`${model.name} is ready — it now runs offline`);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      if ((e as Error).name === "AbortError") {
        setState((await verifyBrowserModelDownloaded(model)) ? "ready" : "idle");
      } else {
        setError((e as Error).message || "Download failed");
        setState("error");
      }
    } finally {
      if (mountedRef.current) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const clear = async () => {
    cancel();
    try {
      await clearBrowserModelCache();
      if (!mountedRef.current) return;
      setState("idle");
      setProgress(null);
      setError("");
      toast.success("Cached model data cleared — it will download again on next use");
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message || "Could not clear the model cache");
      setState("error");
    }
  };

  const busy = state === "downloading" || state === "preparing";
  const pct = progress?.pct ?? null;

  return (
    <div className="border-t px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-sm">Download</p>
          <p className="pt-0.5 text-xs text-muted-foreground">
            {model.name} runs privately on your device — no server or API
            key. Downloads once ({model.sizeLabel}), then works offline.{" "}
            {handheld
              ? "On phones and tablets it runs on the CPU (slower, but avoids mobile-GPU crashes)."
              : gpu
                ? "Uses your GPU (WebGPU) when available."
                : "No WebGPU detected — it will run on CPU (slower)."}
          </p>
        </div>
        <div className="shrink-0">
          {state === "checking" && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking cache…
            </span>
          )}
          {state === "ready" && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Ready · offline
            </span>
          )}
          {state === "idle" && (
            <Button size="sm" className="gap-1.5" onClick={() => void start()}>
              <Download className="h-3.5 w-3.5" /> Download model
            </Button>
          )}
          {state === "error" && (
            <Button size="sm" className="gap-1.5" onClick={() => void start()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
          {busy && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={cancel}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {busy && (
        <div className="pt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-all",
                pct === null && "animate-pulse",
              )}
              style={{ width: pct === null ? "100%" : `${pct}%` }}
            />
          </div>
          <p className="pt-1.5 text-xs text-muted-foreground">
            {progress?.text || "Starting…"}
          </p>
        </div>
      )}

      {state === "error" && error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {(state === "ready" || state === "error") && (
        <button
          onClick={() => void clear()}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          <Trash2 className="h-3 w-3" /> Clear cached model data
        </button>
      )}
    </div>
  );
}

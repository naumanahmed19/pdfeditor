import type { AppSettings, ChatMessage, ProviderKind } from "../types";

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";
export const LMSTUDIO_DEFAULT_URL = "http://localhost:1234";
export const DEFAULT_MODEL = "gemma3";

export const DEFAULT_SETTINGS: AppSettings = {
  // Default to the zero-config in-browser model, so users without a local model
  // server (Ollama / LM Studio) can use the assistant with no setup.
  provider: "browser",
  model: DEFAULT_MODEL,
  ollamaBaseUrl: OLLAMA_DEFAULT_URL,
  lmStudioBaseUrl: LMSTUDIO_DEFAULT_URL,
  customBaseUrl: "",
  customApiKey: "",
  temperature: 0.4,
  contextChars: 14000,
};

export function providerBaseUrl(settings: AppSettings): string {
  switch (settings.provider) {
    case "ollama":
      return settings.ollamaBaseUrl || OLLAMA_DEFAULT_URL;
    case "lmstudio":
      return settings.lmStudioBaseUrl || LMSTUDIO_DEFAULT_URL;
    default:
      return settings.customBaseUrl;
  }
}

/**
 * In dev, local model servers may not send CORS headers. If a direct request
 * fails at the network layer, retry through the vite dev proxy.
 */
function proxyUrl(url: string, provider: ProviderKind): string | null {
  if (provider === "ollama" && url.startsWith(OLLAMA_DEFAULT_URL)) {
    return url.replace(OLLAMA_DEFAULT_URL, "/proxy/ollama");
  }
  if (provider === "lmstudio" && url.startsWith(LMSTUDIO_DEFAULT_URL)) {
    return url.replace(LMSTUDIO_DEFAULT_URL, "/proxy/lmstudio");
  }
  return null;
}

async function fetchWithFallback(
  url: string,
  provider: ProviderKind,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const fallback = proxyUrl(url, provider);
    if (fallback) return fetch(fallback, init);
    throw err;
  }
}

export async function listModels(settings: AppSettings): Promise<string[]> {
  if (settings.provider === "browser") {
    const { BROWSER_MODEL_LABEL } = await import("./browserLlm");
    return [BROWSER_MODEL_LABEL];
  }
  const base = providerBaseUrl(settings);
  if (!base) return [];
  const headers: Record<string, string> = {};
  if (settings.provider === "openai_compatible" && settings.customApiKey) {
    headers.Authorization = `Bearer ${settings.customApiKey}`;
  }

  // Ollama native endpoint gives the richest listing.
  if (settings.provider === "ollama") {
    try {
      const res = await fetchWithFallback(`${base}/api/tags`, "ollama", { headers });
      if (res.ok) {
        const json = await res.json();
        const names = (json.models ?? [])
          .map((m: any) => m?.name)
          .filter(Boolean);
        if (names.length) return names;
      }
    } catch {
      /* fall through to OpenAI-compatible listing */
    }
  }

  const res = await fetchWithFallback(`${base}/v1/models`, settings.provider, {
    headers,
  });
  if (!res.ok) throw new Error(`Model listing failed (${res.status})`);
  const json = await res.json();
  return (json.data ?? json.models ?? [])
    .map((m: any) => m?.id ?? m?.key ?? m?.name)
    .filter(Boolean);
}

export async function checkConnection(settings: AppSettings): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
}> {
  if (settings.provider === "browser") {
    const { webgpuAvailable, BROWSER_MODEL_LABEL, browserModelReady } =
      await import("./browserLlm");
    const gpu = webgpuAvailable();
    const label = browserModelReady()
      ? BROWSER_MODEL_LABEL
      : `${BROWSER_MODEL_LABEL} — downloads on first use`;
    return {
      ok: true,
      models: [gpu ? label : `${label} (CPU mode — slower, no WebGPU)`],
    };
  }
  try {
    const models = await listModels(settings);
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/** Pick the configured model, preferring an exact then fuzzy match from what's installed. */
export function resolveModel(configured: string, available: string[]): string {
  if (!available.length) return configured;
  if (available.includes(configured)) return configured;
  const fuzzy = available.find((m) =>
    m.toLowerCase().includes(configured.toLowerCase()),
  );
  return fuzzy ?? available[0];
}

export async function streamChat(
  settings: AppSettings,
  messages: ChatMessage[],
  onToken: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<string> {
  if (settings.provider === "browser") {
    const { streamBrowserChat } = await import("./browserLlm");
    return streamBrowserChat(messages, settings.temperature, onToken, signal, onStatus);
  }

  const base = providerBaseUrl(settings);
  if (!base) throw new Error("No API base URL configured. Check Settings.");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.provider === "openai_compatible" && settings.customApiKey) {
    headers.Authorization = `Bearer ${settings.customApiKey}`;
  }

  let model = settings.model;
  try {
    model = resolveModel(settings.model, await listModels(settings));
  } catch {
    /* use configured name as-is */
  }

  const res = await fetchWithFallback(`${base}/v1/chat/completions`, settings.provider, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model,
      temperature: settings.temperature,
      stream: true,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Chat request failed (${res.status}). ${text.slice(0, 300)}`,
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta =
          json.choices?.[0]?.delta?.content ??
          json.choices?.[0]?.message?.content ??
          "";
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        /* ignore malformed keep-alive lines */
      }
    }
  }
  return full;
}

import { streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { AppSettings, ChatMessage, ProviderKind } from "../types";
import {
  browserModelLabel,
  DEFAULT_DESKTOP_MODEL_ID,
  effectiveBrowserModel,
} from "./modelConfig";
import { isHandheldDevice } from "./device";

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";
export const LMSTUDIO_DEFAULT_URL = "http://localhost:1234";
export const DEFAULT_MODEL = "gemma3";
export const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";
export const GEMINI_OPENAI_DEFAULT_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const GOOGLE_GENERATIVE_AI_DEFAULT_URL = "https://generativelanguage.googleapis.com/v1beta";
export const OPENROUTER_DEFAULT_URL = "https://openrouter.ai/api/v1";
export const VERCEL_AI_GATEWAY_DEFAULT_URL = "https://ai-gateway.vercel.sh/v1";

export const DEFAULT_SETTINGS: AppSettings = {
  // Default to the zero-config in-browser model, so users without a local model
  // server (Ollama / LM Studio) can use the assistant with no setup.
  provider: "browser",
  model: DEFAULT_MODEL,
  browserModelId: DEFAULT_DESKTOP_MODEL_ID,
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
      return trimTrailingSlash(settings.ollamaBaseUrl || OLLAMA_DEFAULT_URL);
    case "lmstudio":
      return trimTrailingSlash(settings.lmStudioBaseUrl || LMSTUDIO_DEFAULT_URL);
    default:
      return normalizeOpenAiCompatibleBaseUrl(settings.customBaseUrl);
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function joinUrl(base: string, path: string): string {
  return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

function normalizeOpenAiCompatibleBaseUrl(value: string): string {
  const base = trimTrailingSlash(value);
  if (!base) return "";

  // Older PickPDF builds asked users for a host without "/v1" and appended it
  // internally. Keep those saved URLs working while allowing exact API roots
  // such as Gemini's "/v1beta/openai" and OpenRouter's "/api/v1".
  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/v1";
      return trimTrailingSlash(url.toString());
    }
  } catch {
    // If it is not a full URL, use it as written; fetch will surface the error.
  }

  return base;
}

function openAiCompatibleEndpoint(settings: AppSettings, path: string): string {
  return joinUrl(providerBaseUrl(settings), path);
}

function localOpenAiEndpoint(settings: AppSettings, path: string): string {
  return joinUrl(providerBaseUrl(settings), `v1/${path}`);
}

function isSameApiRoot(base: string, expected: string): boolean {
  return trimTrailingSlash(base).toLowerCase() === trimTrailingSlash(expected).toLowerCase();
}

function isGoogleGenerativeAiBaseUrl(base: string): boolean {
  return isSameApiRoot(base, GOOGLE_GENERATIVE_AI_DEFAULT_URL);
}

function shouldUseAiSdkForCustomApi(base: string): boolean {
  return isSameApiRoot(base, OPENAI_DEFAULT_URL) || isGoogleGenerativeAiBaseUrl(base);
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function googleHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { "x-goog-api-key": apiKey } : {};
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
    const model = effectiveBrowserModel(settings.browserModelId, isHandheldDevice());
    return [browserModelLabel(model)];
  }
  const base = providerBaseUrl(settings);
  if (!base) throw new Error("No API base URL configured.");
  const headers: Record<string, string> = {};
  if (settings.provider === "openai_compatible" && settings.customApiKey) {
    Object.assign(
      headers,
      isGoogleGenerativeAiBaseUrl(base)
        ? googleHeaders(settings.customApiKey)
        : bearerHeaders(settings.customApiKey),
    );
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

  const modelsUrl =
    settings.provider === "openai_compatible"
      ? openAiCompatibleEndpoint(settings, "models")
      : localOpenAiEndpoint(settings, "models");
  const res = await fetchWithFallback(modelsUrl, settings.provider, {
    headers,
  });
  if (!res.ok) throw new Error(`Model listing failed (${res.status})`);
  const json = await res.json();
  if (settings.provider === "openai_compatible" && isGoogleGenerativeAiBaseUrl(base)) {
    return (json.models ?? [])
      .filter((m: any) => (m?.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m?.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }
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
    const { webgpuAvailable, browserModelReady } = await import("./browserLlm");
    const model = effectiveBrowserModel(settings.browserModelId, isHandheldDevice());
    const base = browserModelLabel(model);
    const gpu = webgpuAvailable();
    const label = browserModelReady(model.id)
      ? base
      : `${base} — downloads on first use`;
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
    const model = effectiveBrowserModel(settings.browserModelId, isHandheldDevice());
    return streamBrowserChat(model, messages, settings.temperature, onToken, signal, onStatus);
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

  if (settings.provider === "openai_compatible" && shouldUseAiSdkForCustomApi(base)) {
    return streamAiSdkChat(settings, model, messages, onToken, signal);
  }

  const chatUrl =
    settings.provider === "openai_compatible"
      ? openAiCompatibleEndpoint(settings, "chat/completions")
      : localOpenAiEndpoint(settings, "chat/completions");
  const res = await fetchWithFallback(chatUrl, settings.provider, {
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

async function streamAiSdkChat(
  settings: AppSettings,
  model: string,
  messages: ChatMessage[],
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const base = providerBaseUrl(settings);
  const languageModel = isGoogleGenerativeAiBaseUrl(base)
    ? createGoogleGenerativeAI({
        apiKey: settings.customApiKey,
        baseURL: base,
      })(model)
    : createOpenAI({
        apiKey: settings.customApiKey,
        baseURL: base,
      }).chat(model);

  const result = streamText({
    model: languageModel,
    messages,
    temperature: settings.temperature,
    abortSignal: signal,
  });

  let full = "";
  for await (const delta of result.textStream) {
    full += delta;
    onToken(delta);
  }
  return full;
}

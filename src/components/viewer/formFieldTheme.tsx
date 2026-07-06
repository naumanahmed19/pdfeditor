/**
 * Skin for the fillable form-field overlays (fill view only, not the designer).
 *
 * Self-contained so it's easy to rip out later: it owns its own tiny store
 * (persisted to localStorage) plus a floating toggle. `useFormFieldTheme()`
 * returns the active theme's class strings / CSS colors; nothing else in the
 * app needs to know skins exist.
 */
import { useSyncExternalStore } from "react";
import { cn } from "../../lib/utils";

export type FormFieldSkin = "blue" | "shadcn";

export interface FormFieldThemeDef {
  /** Base class for text inputs / selects / textareas / comb. */
  input: string;
  /** Accent-color utility for checkbox & radio. */
  accent: string;
  /** Opaque fill (CSS color) for comb / list box — must hide the baked canvas. */
  fill: string;
  /** Comb glyph color (CSS). */
  text: string;
  /** Comb cell-divider color (CSS). */
  divider: string;
}

const BASE = "absolute outline-none transition disabled:opacity-60";

export const FORM_FIELD_THEMES: Record<FormFieldSkin, FormFieldThemeDef> = {
  // The app's current look.
  blue: {
    input: cn(
      BASE,
      "rounded-[2px] border border-blue-400/50 bg-sky-400/10 text-slate-900 focus:border-blue-500 focus:bg-white",
    ),
    accent: "accent-blue-600",
    fill: "#ffffff",
    text: "#0f172a",
    divider: "rgba(96,165,250,0.45)",
  },
  // shadcn's default input tokens.
  shadcn: {
    input: cn(
      BASE,
      "rounded-md border border-input bg-background text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring",
    ),
    accent: "accent-primary",
    fill: "hsl(var(--background))",
    text: "hsl(var(--foreground))",
    divider: "hsl(var(--border))",
  },
};

const STORAGE_KEY = "pdf-form-field-skin";

function readInitial(): FormFieldSkin {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "blue" || v === "shadcn") return v;
  } catch {
    /* SSR / no storage */
  }
  return "blue";
}

let current: FormFieldSkin = readInitial();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setFormFieldSkin(skin: FormFieldSkin) {
  current = skin;
  try {
    localStorage.setItem(STORAGE_KEY, skin);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useFormFieldSkin(): FormFieldSkin {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "blue" as FormFieldSkin,
  );
}

export function useFormFieldTheme(): FormFieldThemeDef {
  return FORM_FIELD_THEMES[useFormFieldSkin()];
}

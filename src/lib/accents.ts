// shadcn-style accent (primary) color presets. Each preset overrides
// --primary / --primary-foreground / --ring for both light and dark themes.
// "neutral" reproduces the app's default monochrome palette.

export type AccentId =
  | "neutral"
  | "blue"
  | "green"
  | "violet"
  | "rose"
  | "orange"
  | "yellow"
  | "red";

interface AccentVars {
  primary: string;
  primaryForeground: string;
  ring: string;
}

export interface Accent {
  id: AccentId;
  label: string;
  /** Swatch color shown in the settings picker (a representative hsl()). */
  swatch: string;
  light: AccentVars;
  dark: AccentVars;
  /**
   * Sidebar / app background — a subtle tint of the accent hue.
   * Light keeps the original 31%/95% tint (hwb ≈ h 93% 3%); dark is a
   * faintly-tinted near-black. HSL triplets, applied to --sidebar.
   */
  sidebar: { light: string; dark: string };
}

export const ACCENTS: Accent[] = [
  {
    id: "neutral",
    label: "Neutral",
    swatch: "hsl(0 0% 9%)",
    light: { primary: "0 0% 9%", primaryForeground: "0 0% 98%", ring: "0 0% 3.9%" },
    dark: { primary: "0 0% 98%", primaryForeground: "0 0% 9%", ring: "0 0% 83.1%" },
    sidebar: { light: "203 31% 95%", dark: "0 0% 9%" },
  },
  {
    id: "blue",
    label: "Blue",
    swatch: "hsl(221.2 83.2% 53.3%)",
    light: { primary: "221.2 83.2% 53.3%", primaryForeground: "210 40% 98%", ring: "221.2 83.2% 53.3%" },
    dark: { primary: "217.2 91.2% 59.8%", primaryForeground: "222.2 47.4% 11.2%", ring: "224.3 76.3% 48%" },
    sidebar: { light: "221 31% 95%", dark: "222 22% 11%" },
  },
  {
    id: "green",
    label: "Green",
    swatch: "hsl(142.1 76.2% 36.3%)",
    light: { primary: "142.1 76.2% 36.3%", primaryForeground: "355.7 100% 97.3%", ring: "142.1 76.2% 36.3%" },
    dark: { primary: "142.1 70.6% 45.3%", primaryForeground: "144.9 80.4% 10%", ring: "142.4 71.8% 29.2%" },
    sidebar: { light: "142 28% 94%", dark: "142 20% 10%" },
  },
  {
    id: "violet",
    label: "Violet",
    swatch: "hsl(262.1 83.3% 57.8%)",
    light: { primary: "262.1 83.3% 57.8%", primaryForeground: "210 20% 98%", ring: "262.1 83.3% 57.8%" },
    dark: { primary: "263.4 70% 50.4%", primaryForeground: "210 20% 98%", ring: "263.4 70% 50.4%" },
    sidebar: { light: "262 31% 96%", dark: "263 24% 12%" },
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "hsl(346.8 77.2% 49.8%)",
    light: { primary: "346.8 77.2% 49.8%", primaryForeground: "355.7 100% 97.3%", ring: "346.8 77.2% 49.8%" },
    dark: { primary: "346.8 77.2% 49.8%", primaryForeground: "355.7 100% 97.3%", ring: "346.8 77.2% 49.8%" },
    sidebar: { light: "347 40% 96%", dark: "346 22% 12%" },
  },
  {
    id: "orange",
    label: "Orange",
    swatch: "hsl(24.6 95% 53.1%)",
    light: { primary: "24.6 95% 53.1%", primaryForeground: "60 9.1% 97.8%", ring: "24.6 95% 53.1%" },
    dark: { primary: "20.5 90.2% 48.2%", primaryForeground: "60 9.1% 97.8%", ring: "20.5 90.2% 48.2%" },
    sidebar: { light: "25 45% 96%", dark: "24 22% 11%" },
  },
  {
    id: "yellow",
    label: "Yellow",
    swatch: "hsl(47.9 95.8% 53.1%)",
    light: { primary: "47.9 95.8% 53.1%", primaryForeground: "26 83.3% 14.1%", ring: "47.9 95.8% 53.1%" },
    dark: { primary: "47.9 95.8% 53.1%", primaryForeground: "26 83.3% 14.1%", ring: "47.9 95.8% 53.1%" },
    sidebar: { light: "48 52% 94%", dark: "40 20% 11%" },
  },
  {
    id: "red",
    label: "Red",
    swatch: "hsl(0 72.2% 50.6%)",
    light: { primary: "0 72.2% 50.6%", primaryForeground: "0 85.7% 97.3%", ring: "0 72.2% 50.6%" },
    dark: { primary: "0 72.2% 50.6%", primaryForeground: "0 85.7% 97.3%", ring: "0 72.2% 50.6%" },
    sidebar: { light: "0 44% 96%", dark: "0 22% 11%" },
  },
];

/** Apply an accent's CSS variables to the document root for the given theme. */
export function applyAccent(id: AccentId, theme: "light" | "dark") {
  const accent = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  const v = theme === "dark" ? accent.dark : accent.light;
  const root = document.documentElement;
  root.style.setProperty("--primary", v.primary);
  root.style.setProperty("--primary-foreground", v.primaryForeground);
  root.style.setProperty("--ring", v.ring);
  // Sidebar + app background pick up a subtle tint of the accent hue.
  root.style.setProperty("--sidebar", theme === "dark" ? accent.sidebar.dark : accent.sidebar.light);
}

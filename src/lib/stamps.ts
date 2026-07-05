/** Predefined rubber stamps (APPROVED / DRAFT / …), rendered to a PNG data
 *  URL on demand and placed through the existing image-stamp flow. */

export interface StampDef {
  label: string;
  color: string;
  /** Append today's date under the label (e.g. RECEIVED stamps). */
  withDate?: boolean;
}

export const STAMPS: StampDef[] = [
  { label: "APPROVED", color: "#15803d" },
  { label: "NOT APPROVED", color: "#b91c1c" },
  { label: "DRAFT", color: "#1d4ed8" },
  { label: "FINAL", color: "#15803d" },
  { label: "CONFIDENTIAL", color: "#b91c1c" },
  { label: "VOID", color: "#b91c1c" },
  { label: "FOR REVIEW", color: "#1d4ed8" },
  { label: "RECEIVED", color: "#1d4ed8", withDate: true },
  { label: "REVIEWED", color: "#15803d", withDate: true },
];

/** Render a classic bordered rubber stamp as a PNG data URL (3× for crisp
 *  scaling). Returns the data URL and its aspect ratio (h / w). */
export function makeStamp(def: StampDef): { dataUrl: string; aspect: number } {
  const S = 3; // supersample
  const fontMain = `italic 700 ${34 * S}px Helvetica, Arial, sans-serif`;
  const fontDate = `600 ${15 * S}px Helvetica, Arial, sans-serif`;
  const date = def.withDate
    ? new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = fontMain;
  const labelW = measure.measureText(def.label).width;
  measure.font = fontDate;
  const dateW = date ? measure.measureText(date).width : 0;

  const padX = 22 * S;
  const padY = 12 * S;
  const border = 4 * S;
  const w = Math.ceil(Math.max(labelW, dateW) + padX * 2);
  const h = Math.ceil((date ? 34 + 8 + 15 : 34) * S + padY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = def.color;
  ctx.lineWidth = border;
  const r = 8 * S;
  ctx.beginPath();
  ctx.roundRect(border / 2, border / 2, w - border, h - border, r);
  ctx.stroke();

  ctx.fillStyle = def.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = fontMain;
  const labelY = date ? padY + (34 * S) / 2 : h / 2;
  ctx.fillText(def.label, w / 2, labelY);
  if (date) {
    ctx.font = fontDate;
    ctx.fillText(date, w / 2, labelY + (34 / 2 + 8 + 15 / 2) * S);
  }

  return { dataUrl: canvas.toDataURL("image/png"), aspect: h / w };
}

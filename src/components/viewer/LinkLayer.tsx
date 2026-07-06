import { useEffect, useState } from "react";
import type { PdfDoc } from "../../lib/pdf";
import { useApp } from "../../store";

interface LinkRect {
  left: number;
  top: number;
  width: number;
  height: number;
  url?: string;
  destPage?: number;
}

/** Renders the PDF's own link annotations as clickable overlays. */
export function LinkLayer({
  pdf,
  pageIndex,
  scale,
  visible,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  scale: number;
  visible: boolean;
}) {
  const app = useApp();
  const [links, setLinks] = useState<LinkRect[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const annots = await page.getAnnotations();
        const vp = page.getViewport({ scale: 1 });
        const out: LinkRect[] = [];
        for (const a of annots) {
          if (a.subtype !== "Link" || !a.rect) continue;
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          const rect = {
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          };
          if (a.url) {
            out.push({ ...rect, url: a.url });
          } else if (a.destPage !== undefined) {
            // The engine resolves internal destinations to a page index.
            out.push({ ...rect, destPage: a.destPage });
          }
        }
        if (alive) setLinks(out);
      } catch {
        /* no annotations */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, pageIndex, visible]);

  // Links are active while reading; in edit mode they'd fight the tools.
  if (app.editMode || !links.length) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {links.map((l, i) => (
        <a
          key={i}
          href={l.url ?? "#"}
          target={l.url ? "_blank" : undefined}
          rel={l.url ? "noopener noreferrer" : undefined}
          title={l.url ?? `Go to page ${(l.destPage ?? 0) + 1}`}
          onClick={(e) => {
            if (l.destPage !== undefined) {
              e.preventDefault();
              app.scrollToPage(l.destPage);
            }
          }}
          className="absolute rounded-sm hover:bg-blue-500/10 hover:ring-1 hover:ring-blue-400/50"
          style={{
            left: l.left * scale,
            top: l.top * scale,
            width: l.width * scale,
            height: l.height * scale,
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */


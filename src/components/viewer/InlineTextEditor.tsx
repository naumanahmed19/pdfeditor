import { useEffect, useRef, useState } from "react";
import { type InlineEdit, FONT_CSS } from "./textedit";
import { activeInlineEdit } from "../../lib/activeInlineEdit";

/** Unique @font-face family per inline-edit session (embedded-font preview). */
let inlineFaceSeq = 0;

/**
 * Inline editor shown over a text run while editing it in place. It's a
 * transient input (not a persisted annotation) — on commit the underlying
 * PDFium text object is rewritten and the page re-renders from real bytes.
 */
export function InlineTextEditor({
  edit,
  saving,
  onCommit,
  onCancel,
}: {
  edit: InlineEdit;
  saving: boolean;
  /** Resolves false when the commit was rejected (editor stays open). */
  onCommit: (
    text: string,
    colorHex: string,
    fontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean,
  ) => Promise<boolean>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(edit.original);
  const [colorHex, setColorHex] = useState(edit.colorHex);
  const [sizePt, setSizePt] = useState(Math.round(edit.fontSize));
  // "original" keeps the document's embedded face; replacement is explicit.
  const [family, setFamily] = useState("original");
  const [bold, setBold] = useState(edit.bold);
  const [italic, setItalic] = useState(edit.italic);
  // CSS family name of the page's real embedded font, once it's registered as
  // an @font-face — null until loaded (or if the browser rejects the program).
  const [embeddedFamily, setEmbeddedFamily] = useState<string | null>(null);
  const done = useRef(false);

  // Register the clicked run's embedded font so the textarea shows the exact
  // face and glyph widths on the page, not a generic CSS substitute. Loading is
  // async and can fail (unsupported program) — fall back to CSS in that case.
  useEffect(() => {
    if (!edit.embeddedFont || typeof FontFace === "undefined") return;
    const family = `pdfedit-face-${++inlineFaceSeq}`;
    const face = new FontFace(family, edit.embeddedFont as BufferSource);
    let cancelled = false;
    face
      .load()
      .then(() => {
        if (cancelled) return;
        document.fonts.add(face);
        setEmbeddedFamily(family);
      })
      .catch(() => {
        /* unsupported program — keep the CSS fallback */
      });
    return () => {
      cancelled = true;
      try {
        document.fonts.delete(face);
      } catch {
        /* not added */
      }
    };
  }, [edit.embeddedFont]);

  // Paragraph mode: the edit spans several visual lines, one textarea row per
  // document line. In a reflowable edit (edit.reflow) added/removed breaks
  // are soft — the commit re-wraps to the column — so the row count follows
  // whatever the user typed; fixed-break edits keep the original count.
  const lineCount = edit.original.split("\n").length;
  const valueLines = value.split("\n").length;
  const rows = edit.reflow ? Math.max(lineCount, valueLines) : lineCount;

  useEffect(() => {
    window.getSelection()?.removeAllRanges();
    const t = ref.current;
    if (t) {
      t.focus({ preventScroll: true });
      // Select-all invites replacing the text wholesale — right for a single
      // line, an accident waiting to happen for a whole paragraph.
      if (lineCount > 1) t.setSelectionRange(0, 0);
      else t.select();
    }
  }, []);

  // Surface the style controls in the top toolbar's contextual row while this
  // inline edit is open (instead of a separate floating bar).
  useEffect(() => {
    activeInlineEdit.set({
      colorHex,
      sizePt,
      fontName: edit.fontName,
      family,
      bold,
      italic,
      saving,
      setColorHex,
      setSizePt,
      setFamily,
      toggleBold: () => setBold((v) => !v),
      toggleItalic: () => setItalic((v) => !v),
    });
  }, [colorHex, sizePt, family, bold, italic, saving, edit.fontName]);
  useEffect(() => () => activeInlineEdit.set(null), []);

  // Commit once — guard against Enter followed by the unmount blur firing
  // twice. A rejected commit (e.g. glyphs missing from the embedded font)
  // re-arms the editor instead of discarding the user's text.
  const finish = () => {
    if (done.current) return;
    done.current = true;
    void onCommit(value, colorHex, sizePt, family, bold, italic).then((closed) => {
      if (!closed) {
        done.current = false;
        requestAnimationFrame(() => ref.current?.focus());
      }
    });
  };

  // Live-preview the size change on screen (px per point from the original).
  const pxPerPt = edit.fontPx / (edit.fontSize || 1);
  const fontPx = sizePt * pxPerPt;
  const baseH = Math.max(edit.height, fontPx * 1.25 * lineCount);
  // Anchor on the ORIGINAL lines so they sit on the page's lines; rows added
  // in a reflowable edit extend the box downward, like the reflow will.
  const top = edit.top + edit.height / 2 - baseH / 2;
  // One textarea row per document line: row height = the paragraph's own
  // leading, so the editor's lines sit on the page's lines.
  const lineH = lineCount > 1 ? baseH / lineCount : baseH;
  const boxH = lineH * rows;

  return (
    <div
      className="absolute z-30"
      style={{ left: edit.left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      // Commit when focus leaves the editor — but NOT when it moves to THIS
      // edit's own style controls (tagged data-inline-edit-controls), so
      // changing font / size / color there keeps the edit open. Focus landing
      // anywhere else in the toolbar (Undo/Redo, a tool) still commits first,
      // so those never act on a stale text-object index. `document.activeElement`
      // is a fallback for native controls whose blur reports no relatedTarget.
      onBlur={(e) => {
        const to = e.relatedTarget as HTMLElement | null;
        if (e.currentTarget.contains(to)) return;
        if (to?.closest?.("[data-inline-edit-controls]")) return;
        if (document.activeElement?.closest?.("[data-inline-edit-controls]")) return;
        finish();
      }}
    >
      <textarea
        ref={ref}
        value={value}
        disabled={saving}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish();
          } else if (e.key === "Enter" && !edit.reflow) {
            // Fixed-break edit (line scope / mixed styles): the document's
            // line breaks can't change, so Shift+Enter must not insert one.
            e.preventDefault();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        className="block resize-none overflow-hidden whitespace-pre rounded-[2px] bg-white shadow-sm outline outline-2 outline-primary"
        style={{
          width: Math.max(edit.width + 24, 60),
          height: boxH,
          fontSize: fontPx,
          lineHeight: `${lineH}px`,
          color: colorHex,
          padding: "0 1px",
          fontFamily:
            family === "original"
              ? // Prefer the page's real embedded face; CSS family is the
                // fallback stack while it loads or if it can't be used.
                [
                  embeddedFamily && `"${embeddedFamily}"`,
                  FONT_CSS[edit.fallbackFamily] ?? "Helvetica, Arial, sans-serif",
                ]
                  .filter(Boolean)
                  .join(", ")
              : FONT_CSS[family] ?? "Helvetica, Arial, sans-serif",
          // On the real embedded face the weight/slant is already baked in, so
          // only faux-emphasize the DELTA the user just toggled on; on the CSS
          // fallback the toggle's absolute state drives it.
          fontWeight:
            family === "original" && embeddedFamily
              ? bold && !edit.bold
                ? 700
                : 400
              : bold
                ? 700
                : 400,
          fontStyle:
            family === "original" && embeddedFamily
              ? italic && !edit.italic
                ? "italic"
                : "normal"
              : italic
                ? "italic"
                : "normal",
        }}
      />
    </div>
  );
}

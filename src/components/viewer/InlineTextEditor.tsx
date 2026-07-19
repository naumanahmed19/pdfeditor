import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  passive = false,
  initialFamily = "original",
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
  /** Non-interactive committed preview shown until the PDF worker catches up. */
  passive?: boolean;
  initialFamily?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(edit.original);
  const [colorHex, setColorHex] = useState(edit.colorHex);
  const [sizePt, setSizePt] = useState(Math.round(edit.fontSize));
  // "original" keeps the document's embedded face; replacement is explicit.
  const [family, setFamily] = useState(initialFamily);
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

  const lineCount = edit.original.split("\n").length;

  useEffect(() => {
    if (passive) return;
    window.getSelection()?.removeAllRanges();
    const t = ref.current;
    if (t) {
      t.focus({ preventScroll: true });
      // Start where the user clicked. Selecting the whole run made a normal
      // keystroke unexpectedly replace a title or paragraph.
      t.setSelectionRange(edit.caretOffset, edit.caretOffset);
    }
  }, [edit.caretOffset, passive]);

  // Surface the style controls in the top toolbar's contextual row while this
  // inline edit is open (instead of a separate floating bar).
  useEffect(() => {
    if (passive) return;
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
  }, [colorHex, sizePt, family, bold, italic, saving, edit.fontName, passive]);
  useEffect(() => {
    if (passive) return;
    return () => activeInlineEdit.set(null);
  }, [passive]);

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
  const top = edit.top + edit.height / 2 - baseH / 2;
  const lineH = lineCount > 1 ? baseH / lineCount : baseH;
  const baseWidth = Math.min(edit.maxWidth, Math.max(edit.width + 8, 60));
  const [box, setBox] = useState(() => ({ width: baseWidth, height: baseH }));

  // A paragraph keeps its column width and grows downward as browser wrapping
  // adds lines. A fixed single line grows horizontally until the page edge.
  // Measuring scrollWidth/scrollHeight after every keystroke avoids clipped
  // text without guessing from character counts or font averages.
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const width = edit.reflow
      ? baseWidth
      : Math.min(
          edit.maxWidth,
          Math.max(baseWidth, textarea.scrollWidth + 4),
        );
    textarea.style.width = `${width}px`;
    textarea.style.height = "0px";
    const height = Math.min(
      edit.maxHeight,
      Math.max(baseH, textarea.scrollHeight + 2),
    );
    textarea.style.height = `${height}px`;
    setBox((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, [baseH, baseWidth, edit.maxHeight, edit.maxWidth, edit.reflow, embeddedFamily, value]);

  const originalPaintUnchanged =
    !passive &&
    family === "original" &&
    !embeddedFamily &&
    value === edit.original &&
    colorHex.toLowerCase() === edit.colorHex.toLowerCase() &&
    sizePt === Math.round(edit.fontSize) &&
    bold === edit.bold &&
    italic === edit.italic;

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
        if (passive) return;
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
        readOnly={saving || passive}
        aria-busy={saving}
        aria-label={passive ? "Committed PDF text preview" : "Edit PDF text"}
        aria-hidden={passive || undefined}
        wrap={edit.reflow ? "soft" : "off"}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (saving) return;
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            (!edit.reflow || e.ctrlKey || e.metaKey)
          ) {
            e.preventDefault();
            finish();
          } else if (e.key === "Enter" && !edit.reflow) {
            // A fixed line cannot accept a hard break. Paragraph mode uses
            // ordinary Enter for a new line and Ctrl/Cmd+Enter to finish.
            e.preventDefault();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        className={`block resize-none rounded-[2px] outline outline-2 ${
          saving || passive
            ? "pointer-events-none shadow-none outline-transparent"
            : "shadow-sm outline-primary"
        }`}
        style={{
          width: box.width,
          height: box.height,
          maxWidth: edit.maxWidth,
          maxHeight: edit.maxHeight,
          overflowX: box.width >= edit.maxWidth ? "auto" : "hidden",
          overflowY: box.height >= edit.maxHeight ? "auto" : "hidden",
          whiteSpace: edit.reflow ? "pre-wrap" : "pre",
          overflowWrap: edit.reflow ? "anywhere" : "normal",
          fontSize: fontPx,
          lineHeight: `${lineH}px`,
          // When the browser cannot load the real embedded font, an untouched
          // edit session should not repaint the line in Helvetica. Transparent
          // text/background reveal the exact PDF rendering underneath. As soon
          // as content or styling changes, the normal editable preview appears.
          color: originalPaintUnchanged ? "transparent" : colorHex,
          caretColor: colorHex,
          backgroundColor: originalPaintUnchanged ? "transparent" : "white",
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

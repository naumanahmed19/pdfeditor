import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type InlineEdit, FONT_CSS } from "./textedit";
import { activeInlineEdit } from "../../lib/activeInlineEdit";
import { missingGlyphs, newCharacters } from "../../lib/fontcoverage";

/** Unique @font-face family per inline-edit session (embedded-font preview). */
let inlineFaceSeq = 0;

const FALLBACK_LABELS: Record<string, string> = {
  helvetica: "Helvetica",
  times: "Times",
  courier: "Courier",
  carlito: "Carlito",
  caladea: "Caladea",
  roboto: "Roboto",
  opensans: "Open Sans",
  montserrat: "Montserrat",
  lora: "Lora",
};

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
    layout?: { width: number },
  ) => Promise<boolean>;
  onCancel: () => void;
  /** Non-interactive committed preview shown until the PDF worker catches up. */
  passive?: boolean;
  initialFamily?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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
  const [fontNotice, setFontNotice] = useState<string | null>(null);
  const done = useRef(false);
  const manualWidthRef = useRef<number | null>(edit.preferredWidth ?? null);
  const finishRef = useRef<() => void>(() => {});

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

  useEffect(() => {
    if (passive || family !== "original") {
      setFontNotice(null);
      return;
    }
    const fresh = newCharacters(
      value,
      edit.original,
      edit.fontChars[edit.runs[0]?.fontName] ?? "",
    );
    if (!fresh.length) {
      setFontNotice(null);
      return;
    }
    const shown = fresh.slice(0, 4).join("");
    const fallback = FALLBACK_LABELS[edit.fallbackFamily] ?? edit.fallbackFamily;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!edit.embeddedFont) {
        setFontNotice(
          `New character${fresh.length > 1 ? "s" : ""} “${shown}” may use ${fallback} when saved.`,
        );
        return;
      }
      void missingGlyphs(edit.embeddedFont, fresh).then((missing) => {
        if (cancelled) return;
        setFontNotice(
          missing?.length
            ? `Original font can’t draw “${missing.slice(0, 4).join("")}”; saving will use ${fallback}.`
            : missing === null
              ? `New character${fresh.length > 1 ? "s" : ""} “${shown}” may use ${fallback} when saved.`
              : null,
        );
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [edit.embeddedFont, edit.fallbackFamily, edit.original, family, passive, value]);

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
      commitHint: edit.autoWrapLine
        ? "Enter saves · Shift+Enter adds a line"
        : edit.reflow
          ? "Ctrl+Enter saves · Enter adds a line"
          : "Enter saves",
      setColorHex,
      setSizePt,
      setFamily,
      toggleBold: () => setBold((v) => !v),
      toggleItalic: () => setItalic((v) => !v),
    });
  }, [
    colorHex,
    sizePt,
    family,
    bold,
    italic,
    saving,
    edit.autoWrapLine,
    edit.fontName,
    edit.reflow,
    passive,
  ]);
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
    void onCommit(
      value,
      colorHex,
      sizePt,
      family,
      bold,
      italic,
      manualWidthRef.current === null
        ? undefined
        : { width: manualWidthRef.current },
    ).then((closed) => {
      if (!closed) {
        done.current = false;
        requestAnimationFrame(() => ref.current?.focus());
      }
    });
  };
  finishRef.current = finish;
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  // Page canvas and toolbar surfaces are often non-focusable, so relying on
  // textarea blur alone leaves an edit open after a visible outside click.
  useEffect(() => {
    if (passive) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (wrapRef.current?.contains(target)) return;
      if (target.closest("[data-inline-edit-controls]")) return;
      finishRef.current();
    };
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }, [passive]);

  // Live-preview the size change on screen (px per point from the original).
  const pxPerPt = edit.fontPx / (edit.fontSize || 1);
  const fontPx = sizePt * pxPerPt;
  const baseH = Math.max(edit.height, fontPx * 1.25 * lineCount);
  const top = edit.top + edit.height / 2 - baseH / 2;
  const lineH = lineCount > 1 ? baseH / lineCount : baseH;
  const baseWidth = Math.min(edit.maxWidth, Math.max(edit.width + 8, 60));
  const [box, setBox] = useState(() => ({
    width: edit.preferredWidth ?? baseWidth,
    height: baseH,
  }));
  const [manualWidth, setManualWidth] = useState<number | null>(
    edit.preferredWidth ?? null,
  );

  // A paragraph keeps its column width. A line grows horizontally to the page
  // edge, then wraps and grows downward. Measuring scrollWidth/scrollHeight
  // after every keystroke avoids clipped text without guessing from character
  // counts or font averages.
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    let naturalWidth = textarea.scrollWidth + 4;
    if (edit.autoWrapLine) {
      // Measure the unwrapped value so a line editor grows naturally until it
      // reaches the page edge. It then switches back to pre-wrap below and
      // grows downward instead of hiding text behind a horizontal scrollbar.
      const whiteSpace = textarea.style.whiteSpace;
      const width = textarea.style.width;
      textarea.style.whiteSpace = "pre";
      textarea.style.width = "0px";
      naturalWidth = textarea.scrollWidth + 4;
      textarea.style.whiteSpace = whiteSpace;
      textarea.style.width = width;
    }
    const width =
      manualWidth ??
      (edit.reflow && !edit.autoWrapLine
        ? baseWidth
        : Math.min(edit.maxWidth, Math.max(baseWidth, naturalWidth)));
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
  }, [
    baseH,
    baseWidth,
    edit.autoWrapLine,
    edit.maxHeight,
    edit.maxWidth,
    edit.reflow,
    embeddedFamily,
    manualWidth,
    value,
  ]);

  const beginWidthResize = (e: React.PointerEvent) => {
    if (saving || passive || !edit.reflow) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = box.width;
    const onMove = (event: PointerEvent) => {
      const width = Math.min(
        edit.maxWidth,
        Math.max(60, startWidth + event.clientX - startX),
      );
      manualWidthRef.current = width;
      setManualWidth(width);
    };
    const finishResize = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      ref.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  const textCollision =
    edit.collisionRects?.some(
      (rect) =>
        edit.left + box.width > rect.left + 1 &&
        edit.left < rect.right - 1 &&
        top + box.height > rect.top + 1 &&
        top < rect.bottom - 1,
    ) ?? false;

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
      ref={wrapRef}
      className="absolute z-30"
      style={{ left: edit.left, top, width: box.width, height: box.height }}
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
            (edit.autoWrapLine || !edit.reflow || e.ctrlKey || e.metaKey)
          ) {
            e.preventDefault();
            finish();
          } else if (e.key === "Enter" && !edit.reflow) {
            // A non-reflowable mixed-style scope cannot accept a hard break.
            // Paragraph mode uses ordinary Enter; auto-wrapping line mode
            // keeps Enter-to-commit and offers Shift+Enter for a soft break.
            e.preventDefault();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className={`block resize-none rounded-[2px] outline outline-2 ${
          saving || passive
            ? "pointer-events-none shadow-none outline-transparent"
            : textCollision
              ? "shadow-sm outline-red-500"
              : "shadow-sm outline-primary"
        }`}
        style={{
          width: box.width,
          height: box.height,
          maxWidth: edit.maxWidth,
          maxHeight: edit.maxHeight,
          overflowX: edit.reflow
            ? "hidden"
            : box.width >= edit.maxWidth
              ? "auto"
              : "hidden",
          overflowY: box.height >= edit.maxHeight ? "auto" : "hidden",
          whiteSpace: edit.reflow ? "pre-wrap" : "pre",
          overflowWrap: edit.reflow ? "anywhere" : "normal",
          fontSize: fontPx,
          lineHeight: `${lineH}px`,
          // When the browser cannot load the real embedded font, an untouched
          // edit session should not repaint the line in Helvetica. Transparent
          // text/background reveal the exact PDF rendering underneath. As soon
          // as content or styling changes, use the sampled page backdrop to
          // mask the old glyphs without turning light PDF text white-on-white.
          color: originalPaintUnchanged ? "transparent" : colorHex,
          caretColor: colorHex,
          backgroundColor: originalPaintUnchanged
            ? "transparent"
            : edit.backdropColor,
          backgroundImage: originalPaintUnchanged ? "none" : edit.backdropImage,
          backgroundSize:
            edit.backdropWidth && edit.backdropHeight
              ? `${edit.backdropWidth}px ${edit.backdropHeight}px`
              : undefined,
          backgroundPosition: "left top",
          backgroundRepeat: "no-repeat",
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
      {!saving && !passive && (
        <div
          data-inline-edit-controls
          className="absolute -top-9 right-0 z-20 flex items-center gap-1 rounded-md border border-border bg-background p-1 shadow-md"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="h-6 rounded px-2 text-[11px] font-medium hover:bg-muted"
            onClick={finish}
          >
            Done
          </button>
          <button
            type="button"
            className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted"
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      )}
      {!saving && !passive && edit.reflow && (
        <div
          aria-label="Resize text width"
          className="absolute -right-2 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center"
          style={{ touchAction: "none" }}
          onPointerDown={beginWidthResize}
        >
          <span className="h-6 w-1 rounded-full border border-white bg-blue-500 shadow-sm" />
        </div>
      )}
      {!passive && edit.reflow && (
        <div className="pointer-events-none absolute -bottom-6 right-0 rounded bg-slate-900/80 px-1.5 py-0.5 text-[9px] tabular-nums text-white">
          {Math.round(box.width / pxPerPt)} pt wide
        </div>
      )}
      {textCollision && !passive && (
        <div className="pointer-events-none absolute -bottom-6 left-0 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-medium text-white">
          Overlaps page content
        </div>
      )}
      {fontNotice && !passive && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-10 max-w-72 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] leading-tight text-amber-900 shadow-sm"
        >
          {fontNotice}
        </div>
      )}
    </div>
  );
}

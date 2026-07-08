import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { TextAnnotation, TextRun } from "../../types";
import {
  FONT_CSS,
  applyStyleToRange,
  getRuns,
  getSelectionOffsets,
  parseEditorRuns,
  rangeStyleValue,
  runsToHtml,
  setSelectionOffsets,
  type ResolvedStyle,
} from "../../lib/richtext";
import { activeTextEditor } from "../../lib/activeTextEditor";

export interface RichTextHandle {
  /** Apply a style patch to the current selection (or whole box if collapsed).
   *  Returns false when the box has no text to style yet. */
  applyStyle: (patch: Partial<Omit<TextRun, "text">>) => boolean;
  /** Current selection offsets, or null. */
  selection: () => { start: number; end: number } | null;
  focus: () => void;
}

/**
 * contentEditable rich-text editor for a text annotation. Uncontrolled while
 * typing (so the caret never jumps); reads the DOM back into runs on input and
 * re-renders only when styling a selection. Newlines are real "\n" (Enter is
 * intercepted) so runs stay a clean flat model.
 */
export const RichTextEditor = forwardRef<
  RichTextHandle,
  {
    ann: TextAnnotation;
    scale: number;
    maxWidth: number;
    onRunsChange: (runs: TextRun[]) => void;
    /** `focusTo` is blur's relatedTarget — where focus is going (reliable
     *  during blur, unlike document.activeElement which is still in flux). */
    onCommit: (runs: TextRun[], focusTo: HTMLElement | null) => void;
    style?: React.CSSProperties;
  }
>(({ ann, scale, onRunsChange, onCommit, style }, ref) => {
  const elRef = useRef<HTMLDivElement>(null);
  // Keep the latest ann in a ref so imperative handlers read fresh defaults.
  const annRef = useRef(ann);
  annRef.current = ann;

  // Populate once on mount; typing keeps it uncontrolled thereafter.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.innerHTML = runsToHtml(getRuns(ann), ann, scale);
    const raf = requestAnimationFrame(() => {
      el.focus();
      // Caret to end.
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render spans when the font SCALE (zoom) or the BOX style changes
  // without disturbing the text — box-style changes matter while the box is
  // still empty (runs inherit the new defaults, stale spans get rebuilt).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const off = getSelectionOffsets(el);
    el.innerHTML = runsToHtml(parseEditorRuns(el, annRef.current), annRef.current, scale);
    if (off) setSelectionOffsets(el, off.start, off.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scale,
    ann.color,
    ann.fontSize,
    ann.fontFamily,
    ann.bold,
    ann.italic,
    ann.underline,
    ann.strike,
    ann.displayFontCss,
  ]);

  const readRuns = () => (elRef.current ? parseEditorRuns(elRef.current, annRef.current) : []);

  const applyStyle = (patch: Partial<Omit<TextRun, "text">>): boolean => {
    const el = elRef.current;
    if (!el) return false;
    const runs = parseEditorRuns(el, annRef.current);
    const off = getSelectionOffsets(el);
    const total = runs.reduce((n, r) => n + r.text.length, 0);
    // Nothing typed yet — tell the caller to patch the box style instead.
    if (total === 0) return false;
    const [start, end] = off && off.end > off.start ? [off.start, off.end] : [0, total];
    const next = applyStyleToRange(runs, start, end, patch);
    el.innerHTML = runsToHtml(next, annRef.current, scale);
    setSelectionOffsets(el, start, end);
    el.focus();
    onRunsChange(next);
    return true;
  };

  /** Resolved style of the current selection (collapsed → the char before it),
   *  or undefined when the selection spans mixed values. */
  const styleValue = <K extends keyof ResolvedStyle>(key: K): ResolvedStyle[K] | undefined => {
    const el = elRef.current;
    if (!el) return undefined;
    const runs = parseEditorRuns(el, annRef.current);
    const total = runs.reduce((n, r) => n + r.text.length, 0);
    if (total === 0) return undefined; // empty box → caller reads box style
    const off = getSelectionOffsets(el) ?? { start: total, end: total };
    return rangeStyleValue(runs, off.start, off.end, key, annRef.current);
  };

  useImperativeHandle(ref, () => ({
    applyStyle,
    selection: () => (elRef.current ? getSelectionOffsets(elRef.current) : null),
    focus: () => elRef.current?.focus(),
  }));

  // Register as the active editor so toolbar/popover controls style the
  // selection here while this box is being edited.
  useEffect(() => {
    activeTextEditor.current = {
      annId: ann.id,
      applyStyle,
      selection: () => (elRef.current ? getSelectionOffsets(elRef.current) : null),
      styleValue,
    };
    return () => {
      if (activeTextEditor.current?.annId === ann.id) activeTextEditor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann.id]);

  // Base style on the root: freshly typed characters land as bare text nodes
  // (outside any styled span) and must LOOK like the box style they'll parse
  // back into — otherwise text renders default-black while typing and only
  // picks up its color/font on commit.
  const deco =
    [ann.underline && "underline", ann.strike && "line-through"].filter(Boolean).join(" ") ||
    "none";
  const baseStyle: React.CSSProperties = {
    color: ann.color,
    fontSize: ann.fontSize * scale,
    fontFamily: ann.displayFontCss || FONT_CSS[ann.fontFamily ?? "helvetica"],
    fontWeight: ann.bold ? 700 : 400,
    fontStyle: ann.italic ? "italic" : "normal",
    textDecoration: deco,
    ...style,
  };

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      className="h-full w-full whitespace-pre-wrap break-words outline-none"
      style={baseStyle}
      onInput={() => onRunsChange(readRuns())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // `insertLineBreak` reliably yields a real "\n" in the flat run model.
          // A bare `insertText("\n")` gets turned into <div>/<p> block soup by
          // the browser — especially a trailing Enter — which drops the newline
          // entirely when parseEditorRuns walks the DOM back into runs.
          e.preventDefault();
          document.execCommand("insertLineBreak");
        }
      }}
      onPaste={(e) => {
        // Paste as plain text so foreign styling never leaks in.
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      onBlur={(e) => onCommit(readRuns(), e.relatedTarget as HTMLElement | null)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
});
RichTextEditor.displayName = "RichTextEditor";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { TextAnnotation, TextBlock } from "../../types";
import {
  FONT_CSS,
  applyBlockOp,
  blocksToSemanticHtml,
  getBlocks,
  parseEditorBlocks,
  type BlockOp,
} from "../../lib/richtext";
import { activeTextEditor } from "../../lib/activeTextEditor";
import { activeBlockEditor } from "../../lib/activeBlockEditor";

export interface BlockEditorHandle {
  focus: () => void;
}

/**
 * Block-aware rich-text editor for a text annotation: headings + nested
 * bullet/numbered lists on top of the inline run model. Structure is edited
 * natively (contentEditable: Enter splits/continues, Tab indents) and read back
 * with `parseEditorBlocks`. Inline styling (B/I/U/S, colour, size, family) is
 * applied to the live selection so the existing toolbar controls keep working.
 */
export const BlockTextEditor = forwardRef<
  BlockEditorHandle,
  {
    ann: TextAnnotation;
    scale: number;
    onChange: (blocks: TextBlock[]) => void;
    onSize: (heightPts: number) => void;
    onCommit: (blocks: TextBlock[], focusTo: HTMLElement | null) => void;
    style?: React.CSSProperties;
  }
>(({ ann, scale, onChange, onSize, onCommit, style }, ref) => {
  const elRef = useRef<HTMLDivElement>(null);
  const annRef = useRef(ann);
  annRef.current = ann;
  // Last selection made inside the editor, so block ops can restore it after a
  // toolbar control (that isn't preventing blur) steals focus.
  const savedRange = useRef<Range | null>(null);
  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection();
      const el = elRef.current;
      if (!sel || !sel.rangeCount || !el) return;
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, []);

  const read = () => (elRef.current ? parseEditorBlocks(elRef.current, annRef.current) : []);
  // Measure the CONTENT height. `scrollHeight` is content-driven and does not
  // depend on the element's own box height, so reporting it back (which resizes
  // the wrapper) can't feed back into the measurement — no auto-grow loop.
  const reportSize = () => {
    const el = elRef.current;
    if (el) onSize(el.scrollHeight / scale + 3);
  };

  // Populate once on mount and place the caret at the end.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.innerHTML = blocksToSemanticHtml(getBlocks(ann), ann, scale);
    const raf = requestAnimationFrame(() => {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      reportSize();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render spans when zoom or box-level style changes (rebuild from the
  // current DOM so typed content survives); caret goes to the end.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.innerHTML = blocksToSemanticHtml(read(), annRef.current, scale);
    reportSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, ann.color, ann.fontSize, ann.fontFamily]);

  /* ---- inline styling on the live selection (for the toolbar) ---- */
  const cmdState = (cmd: string) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  const setInline = (cmd: string, want: boolean) => {
    if (cmdState(cmd) !== want) document.execCommand(cmd);
  };
  // Wrap the selection in a span carrying one style (data-* so parseEditorBlocks
  // reads it back exactly; inline CSS so it shows immediately).
  const wrapSelection = (dataAttr: string, dataVal: string, cssProp: string, cssVal: string) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.setAttribute(dataAttr, dataVal);
    (span.style as unknown as Record<string, string>)[cssProp] = cssVal;
    try {
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nr);
  };

  const applyStyle = (patch: Partial<Omit<TextBlock["runs"][number], "text">>): boolean => {
    const el = elRef.current;
    if (!el) return false;
    el.focus();
    if (patch.bold !== undefined) setInline("bold", patch.bold);
    if (patch.italic !== undefined) setInline("italic", patch.italic);
    if (patch.underline !== undefined) setInline("underline", patch.underline);
    if (patch.strike !== undefined) setInline("strikeThrough", patch.strike);
    if (patch.color !== undefined) wrapSelection("data-c", patch.color, "color", patch.color);
    if (patch.fontSize !== undefined)
      wrapSelection("data-s", String(patch.fontSize), "fontSize", `${patch.fontSize * scale}px`);
    if (patch.fontFamily !== undefined)
      wrapSelection("data-f", patch.fontFamily, "fontFamily", FONT_CSS[patch.fontFamily]);
    onChange(read());
    return true;
  };

  // Style of the run span at the caret (for the toolbar's current values).
  const caretSpan = (): HTMLElement | null => {
    const sel = window.getSelection();
    let node = sel?.anchorNode ?? null;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== elRef.current) {
      if (node instanceof HTMLElement && node.hasAttribute("data-c")) return node;
      node = node.parentElement;
    }
    return null;
  };
  const styleValue = (key: string): unknown => {
    if (key === "bold") return cmdState("bold");
    if (key === "italic") return cmdState("italic");
    if (key === "underline") return cmdState("underline");
    if (key === "strike") return cmdState("strikeThrough");
    const span = caretSpan();
    if (!span) return undefined;
    if (key === "color") return span.getAttribute("data-c") ?? undefined;
    if (key === "fontSize") {
      const s = span.getAttribute("data-s");
      return s ? Number(s) : undefined;
    }
    if (key === "fontFamily") return span.getAttribute("data-f") ?? undefined;
    return undefined;
  };

  /* ---- block structure (headings / lists / indent) ---- */
  const blockEl = (): HTMLElement | null => {
    const sel = window.getSelection();
    let node = sel?.anchorNode ?? null;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return (node as HTMLElement | null)?.closest("li,p,h1,h2,h3") ?? null;
  };
  const blockState = (): { kind: TextBlock["kind"]; list?: "bullet" | "numbered" } => {
    const el = blockEl();
    if (!el) return { kind: "p" };
    if (el.tagName === "LI") {
      const list = el.closest("ol") ? "numbered" : "bullet";
      return { kind: "li", list };
    }
    const t = el.tagName.toLowerCase();
    return { kind: (t === "h1" || t === "h2" || t === "h3" ? t : "p") as TextBlock["kind"] };
  };
  // Refocus the editor AND restore the selection captured before focus was
  // stolen (e.g. clicking the format dropdown) — otherwise execCommand runs on
  // a collapsed/empty selection and can wipe the selected lines.
  const focusEl = () => {
    const el = elRef.current;
    if (!el) return;
    el.focus();
    const range = savedRange.current;
    const sel = window.getSelection();
    if (range && el.contains(range.commonAncestorContainer) && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };
  const blockEls = (): HTMLElement[] =>
    Array.from(elRef.current?.querySelectorAll("li,p,h1,h2,h3") ?? []) as HTMLElement[];

  // Block indices spanned by the current selection (in document = block order).
  // Uses range.intersectsNode so it works for any selection shape, including a
  // whole-editor selection whose boundaries sit on the root element.
  const selectedBlockIndices = (): { start: number; end: number } => {
    const els = blockEls();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { start: 0, end: 0 };
    const range = sel.getRangeAt(0);
    let start = -1;
    let end = -1;
    els.forEach((el, i) => {
      if (range.intersectsNode(el)) {
        if (start < 0) start = i;
        end = i;
      }
    });
    if (start < 0) start = end = 0;
    return { start, end };
  };

  // Re-select the same block range after a re-render (blocks map 1:1 to els).
  const reselectBlocks = (start: number, end: number) => {
    const el = elRef.current;
    if (!el) return;
    const els = blockEls();
    const s = els[start];
    const e = els[end] ?? s;
    el.focus();
    if (!s) return;
    const range = document.createRange();
    range.setStart(s, 0);
    range.setEnd(e, e.childNodes.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  // Structural ops mutate the block MODEL directly (not execCommand, which
  // mangles/deletes content on this DOM) and re-render — see `applyBlockOp`.
  const runOp = (op: BlockOp) => {
    const el = elRef.current;
    if (!el) return;
    focusEl(); // restore selection if a control stole focus (e.g. the dropdown)
    const blocks = parseEditorBlocks(el, annRef.current);
    const { start, end } = selectedBlockIndices();
    const next = applyBlockOp(blocks, start, end, op);
    el.innerHTML = blocksToSemanticHtml(next, annRef.current, scale);
    reselectBlocks(start, end);
    onChange(read());
    reportSize();
  };

  const setKind = (kind: "p" | "h1" | "h2" | "h3") => runOp({ type: "kind", kind });
  const toggleList = (list: "bullet" | "numbered") => runOp({ type: "list", list });
  const indent = () => runOp({ type: "indent", delta: 1 });
  const outdent = () => runOp({ type: "indent", delta: -1 });

  useImperativeHandle(ref, () => ({ focus: () => elRef.current?.focus() }));

  // Register as the active editor(s) so the toolbar targets this box.
  useEffect(() => {
    activeTextEditor.current = {
      annId: ann.id,
      applyStyle: applyStyle as never,
      selection: () => ({ start: 0, end: 1 }),
      styleValue: styleValue as never,
    };
    activeBlockEditor.current = { annId: ann.id, state: blockState, setKind, toggleList, indent, outdent };
    return () => {
      if (activeTextEditor.current?.annId === ann.id) activeTextEditor.current = null;
      if (activeBlockEditor.current?.annId === ann.id) activeBlockEditor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann.id]);

  // Auto-grow.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const ro = new ResizeObserver(reportSize);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  const baseStyle: React.CSSProperties = {
    color: ann.color,
    fontSize: ann.fontSize * scale,
    fontFamily: ann.displayFontCss || FONT_CSS[ann.fontFamily ?? "helvetica"],
    fontWeight: ann.bold ? 700 : 400,
    fontStyle: ann.italic ? "italic" : "normal",
    ...style,
  };

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      className="richtext-blocks w-full break-words outline-none"
      style={baseStyle}
      onInput={() => {
        onChange(read());
        reportSize();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          if (blockState().kind === "li") (e.shiftKey ? outdent : indent)();
        }
      }}
      onPaste={(e) => {
        // Plain-text paste so foreign block markup never leaks in.
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      onBlur={(e) => onCommit(read(), e.relatedTarget as HTMLElement | null)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
});
BlockTextEditor.displayName = "BlockTextEditor";

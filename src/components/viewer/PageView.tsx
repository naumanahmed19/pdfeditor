import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PdfDoc, PdfPage } from "../../lib/pdf";
import { renderTextLayer } from "../../lib/pdf";
import type { TextRunEdit } from "../../lib/pdfium";
import { FIELD_META, buildFormField, paletteDrag } from "../../lib/formbuilder";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import type { PageDims } from "./types";
import {
  type InlineEdit,
  type InlineEditRun,
  styleKey,
  familyRoot,
  collectLine,
  mapLineEditToRuns,
  detectFontFromName,
  resolveTextFont,
} from "./textedit";
import { missingGlyphs, newCharacters } from "../../lib/fontcoverage";
import { InlineTextEditor } from "./InlineTextEditor";
import { ObjectLayer } from "./objectlayer";
import { LinkLayer } from "./LinkLayer";
import { FormLayer } from "./form";
import { AnnotationLayer } from "./annotations";

export function PageView({
  pdf,
  pageIndex,
  baseDims,
  scale,
}: {
  pdf: PdfDoc;
  pageIndex: number;
  baseDims: PageDims;
  scale: number;
}) {
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [painted, setPainted] = useState(false);
  // Tracks the last content-edit revision this page painted, to tell an
  // in-place repaint (no skeleton) from a fresh render (skeleton).
  const lastRevRef = useRef(0);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(0);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // Highlighted while a palette field is dragged over this page.
  const [fieldDropActive, setFieldDropActive] = useState(false);

  const w = baseDims.width * scale;
  const h = baseDims.height * scale;

  // Drop a field dragged from the sidebar palette, centered on the cursor.
  const onFieldDrop = (e: React.DragEvent) => {
    const type = paletteDrag.type;
    setFieldDropActive(false);
    if (!type) return;
    e.preventDefault();
    paletteDrag.type = null;
    const rect = wrapRef.current!.getBoundingClientRect();
    const meta = FIELD_META[type];
    let x = (e.clientX - rect.left) / scale - meta.defaultSize.w / 2;
    let y = (e.clientY - rect.top) / scale - meta.defaultSize.h / 2;
    if (app.gridEnabled) {
      x = Math.round(x / app.gridSize) * app.gridSize;
      y = Math.round(y / app.gridSize) * app.gridSize;
    }
    x = Math.max(0, Math.min(baseDims.width - meta.defaultSize.w, x));
    y = Math.max(0, Math.min(baseDims.height - meta.defaultSize.h, y));
    const ann = buildFormField(app.annotations, type, { x, y });
    app.addAnnotation(pageIndex, ann);
    app.setSelected({ page: pageIndex, id: ann.id });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: "800px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Render canvas + text layer when visible or scale changes
  useEffect(() => {
    if (!visible) {
      setPainted(false);
      return;
    }
    // An in-place content edit (contentRev bumped) just repaints over the
    // existing canvas — don't drop to the skeleton, which would gray-flash on
    // every object move. The skeleton still shows for first paint / zoom.
    const contentOnly = lastRevRef.current !== app.contentRev;
    lastRevRef.current = app.contentRev;
    if (!contentOnly) setPainted(false);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const canvas = canvasRef.current;
      const textDiv = textLayerRef.current;
      if (!canvas || !textDiv) return;
      let page: PdfPage;
      try {
        page = await pdf.getPage(pageIndex + 1);
      } catch {
        return;
      }
      if (cancelled) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport });
      renderTask.current = task as any;
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }

      // Text layer at CSS scale
      if (cancelled) return;
      setPainted(true);
      try {
        renderTextLayer(page, textDiv, scale);
        if (!cancelled) setTextLayerReady((v) => v + 1);
      } catch {
        /* text layer optional */
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // app.contentRev: an existing-object edit mutated the live doc in place —
    // repaint from the same handle (no pdf identity change to key off).
  }, [pdf, pageIndex, scale, visible, app.contentRev]);

  // Search highlighting on the text layer — wraps only the matched
  // substring in a mark, not the whole text run.
  useEffect(() => {
    const textDiv = textLayerRef.current;
    if (!textDiv) return;
    const spans = Array.from(
      textDiv.querySelectorAll<HTMLElement>(":scope > span"),
    );
    // Restore any previously marked spans to their original text.
    for (const s of spans) {
      if (s.dataset.searchOriginal !== undefined) {
        s.textContent = s.dataset.searchOriginal;
        delete s.dataset.searchOriginal;
      }
    }
    const q = app.searchQuery.trim().toLowerCase();
    if (!q) return;
    const pageMatches = app.searchMatches.filter((m) => m.page === pageIndex);
    if (!pageMatches.length) return;

    const active = app.searchMatches[app.activeMatch];
    const hitSpans = spans.filter((s) =>
      s.textContent?.toLowerCase().includes(q),
    );

    hitSpans.forEach((span) => {
      // The active match is the one whose run index matches — not a DOM
      // position — so it stays correct even though spans render in reading
      // order rather than extraction order.
      const isActive =
        !!active &&
        active.page === pageIndex &&
        Number(span.dataset.run) === active.itemIndex;
      const text = span.textContent ?? "";
      const lower = text.toLowerCase();
      span.dataset.searchOriginal = text;
      const frag = document.createDocumentFragment();
      let pos = 0;
      let at: number;
      while ((at = lower.indexOf(q, pos)) !== -1) {
        if (at > pos) frag.appendChild(document.createTextNode(text.slice(pos, at)));
        const mark = document.createElement("span");
        mark.className =
          isActive ? "search-mark search-mark-active" : "search-mark";
        mark.textContent = text.slice(at, at + q.length);
        frag.appendChild(mark);
        pos = at + q.length;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      span.replaceChildren(frag);
    });
  }, [
    app.searchQuery,
    app.searchMatches,
    app.activeMatch,
    pageIndex,
    textLayerReady,
  ]);

  // Text-marking tools drag over text to mark it: the selection becomes
  // underline/strikeout/squiggly marks — or a highlight when the highlighter
  // is in "text" mode (see the mark-on-mouseup effect). They need a selectable
  // text layer, like read. (Highlighter "area" mode free-draws a box instead.)
  const textMarkTool =
    app.tool === "underline" ||
    app.tool === "strikeout" ||
    app.tool === "squiggly" ||
    (app.tool === "highlight" && app.highlightMode === "text");

  // Text is selectable for reading/copy (read tool), click-to-edit (edittext),
  // and while a text-marking tool is armed. The Select tool grabs page OBJECTS
  // instead (via ObjectLayer), so text stays non-selectable there.
  const textSelectable =
    (app.tool === "read" || app.tool === "edittext" || textMarkTool) &&
    !app.pendingStamp &&
    // Honor the copy restriction of protected documents (read-tool selection
    // exists to copy; edittext and marking only annotate, never extract text).
    (app.tool === "edittext" || textMarkTool || app.docPermissions.copy);

  // "Edit existing text": a click selects the whole visual LINE around the
  // hit run (PDFs fragment lines into many small runs), and the inline editor
  // shows the joined text. On commit the diff is mapped back onto the
  // underlying content-stream objects and rewritten in place — no whiteout
  // patch, no overlay copy, original text truly gone.
  const onTextLayerClick = async (e: React.MouseEvent) => {
    if (app.tool !== "edittext" || !app.docBytes || !wrapRef.current) return;
    const pr = wrapRef.current.getBoundingClientRect();

    let objs;
    let viewport;
    try {
      // pdf.js viewport maps PDFium's (unrotated) page space to the on-screen
      // rendering — this is what keeps the editor aligned on rotated/cropped
      // pages instead of guessing with a manual y-flip.
      const page = await pdf.getPage(pageIndex + 1);
      viewport = page.getViewport({ scale });
      objs = await app.getPageTextObjects(pageIndex);
    } catch {
      toast.error("Couldn't read this page's text for editing.");
      return;
    }
    // Click point in PDF page coordinates (handles rotation + crop origin).
    const [xPt, yPt] = viewport.convertToPdfPoint(
      e.clientX - pr.left,
      e.clientY - pr.top,
    );
    // Smallest text run whose bounds contain the click point.
    const hit = objs
      .filter(
        (o) =>
          o.text.trim() &&
          xPt >= o.left &&
          xPt <= o.right &&
          yPt >= o.bottom &&
          yPt <= o.top,
      )
      .sort(
        (a, b) =>
          (a.right - a.left) * (a.top - a.bottom) -
          (b.right - b.left) * (b.top - b.bottom),
      )[0];
    if (!hit) {
      toast.info("Click directly on a line of text to edit it.");
      return;
    }

    // Join the visual line's fragments into one editable string, remembering
    // each run's span so the edit can be mapped back per run.
    const lineRuns = collectLine(objs, hit);
    let joined = "";
    const runs: InlineEditRun[] = [];
    for (let i = 0; i < lineRuns.length; i++) {
      const o = lineRuns[i];
      const next = lineRuns[i + 1];
      // Infer a visual space where the PDF split words into separate runs.
      const sep =
        next &&
        next.left - o.right > 0.15 * hit.fontSize &&
        !o.text.endsWith(" ") &&
        !next.text.startsWith(" ")
          ? " "
          : "";
      runs.push({
        objectIndex: o.index,
        text: o.text,
        start: joined.length,
        sep,
        originX: o.originX,
        originY: o.originY,
        fontName: o.fontName,
      });
      joined += o.text + sep;
    }

    // Map the line's PDF-space box to the exact on-screen rectangle.
    const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
      Math.min(...lineRuns.map((o) => o.left)),
      Math.min(...lineRuns.map((o) => o.bottom)),
      Math.max(...lineRuns.map((o) => o.right)),
      Math.max(...lineRuns.map((o) => o.top)),
    ]);
    const [r, g, b] = hit.color;
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    const f = detectFontFromName(hit.fontName || "");

    // Per-face proven glyphs: all page text drawn with each font. Coverage is
    // per-subset — a 'c' in the regular face proves nothing about the bold
    // face's subset — so the preflight checks each edited run's own font.
    const fontChars: Record<string, string> = {};
    for (const o of objs) {
      fontChars[o.fontName] = (fontChars[o.fontName] ?? "") + o.text;
    }

    // Other styles of the same family embedded in the page (a real Bold or
    // Regular face beats a synthesized one when the user toggles B/I).
    const root = familyRoot(hit.fontName || "");
    const siblings: Partial<Record<string, number>> = {};
    if (root) {
      for (const o of objs) {
        if (o.fontName === hit.fontName || familyRoot(o.fontName) !== root) continue;
        const st = detectFontFromName(o.fontName);
        const key = styleKey(st.bold, st.italic);
        if (siblings[key] == null) siblings[key] = o.index;
      }
    }

    // Load the clicked run's real embedded font so the on-screen editor shows
    // the page's actual face and metrics — but only when that subset can render
    // the current line's characters. A bare-CFF/CID subset fontkit can't parse
    // (or that lacks a Unicode cmap) would draw tofu in the textarea, so in that
    // case we keep the CSS fallback instead.
    let embeddedFont: Uint8Array | null = null;
    try {
      const fi = await app.getTextFontInfo(pageIndex, hit.index);
      if (fi?.data) {
        const chars = [...new Set(joined.replace(/\s+/g, ""))];
        const miss = await missingGlyphs(fi.data, chars);
        if (miss && miss.length === 0) embeddedFont = fi.data;
      }
    } catch {
      /* keep the CSS fallback */
    }

    setInlineEdit({
      runs,
      original: joined,
      left: Math.min(vx1, vx2),
      top: Math.min(vy1, vy2),
      width: Math.max(Math.abs(vx2 - vx1), 24),
      height: Math.max(Math.abs(vy2 - vy1), hit.fontSize * scale),
      fontPx: hit.fontSize * scale,
      color: `rgb(${r}, ${g}, ${b})`,
      colorHex: hex,
      fontSize: hit.fontSize,
      fontName: (hit.fontName || "").replace(/^[A-Z]{6}\+/, ""),
      fallbackFamily: f.family,
      embeddedFont,
      bold: f.bold,
      italic: f.italic,
      anchor: [runs[0].originX, runs[0].originY],
      fontChars,
      siblings,
    });
  };

  /**
   * Recreate the line's runs with a different face. Preference order: a face
   * of the same family the document already embeds (perfect match), then the
   * closest bundled/standard family. Used for explicit font replacement, for
   * un-bolding/un-italicizing (the regular face isn't synthesizable), and as
   * the offered fallback when the embedded subset lacks a typed glyph.
   */
  const commitRecreate = async (
    edit: InlineEdit,
    runEdits: TextRunEdit[],
    fill: [number, number, number, number] | undefined,
    fontSize: number | undefined,
    family: string,
    bold: boolean,
    italic: boolean,
    // Glyph-fallback: replace only the edited run(s), keeping the untouched
    // neighbors' original embedded faces. Explicit restyles cover the line.
    changedOnly = false,
  ) => {
    // Every run needs explicit text on the recreate path.
    const withText = edit.runs
      .map((r, i) => ({
        objectIndex: r.objectIndex,
        text: runEdits[i].text ?? r.text,
        changed: runEdits[i].text != null,
      }))
      .filter((r) => !changedOnly || r.changed)
      .map(({ objectIndex, text }) => ({ objectIndex, text }));

    let font: { standardName?: string; bytes?: Uint8Array } | null = null;
    if (family === "original") {
      const sib = edit.siblings[styleKey(bold, italic)];
      if (sib != null) {
        const info = await app.getTextFontInfo(pageIndex, sib);
        if (info?.data) {
          // The sibling is a subset too — only use it if it covers the text.
          const chars = [...new Set(withText.map((r) => r.text).join(""))];
          const missing = await missingGlyphs(info.data, chars);
          if (missing !== null && missing.length === 0) font = { bytes: info.data };
        }
      }
      if (!font) font = await resolveTextFont(edit.fallbackFamily, bold, italic);
    } else {
      font = await resolveTextFont(family, bold, italic);
    }
    await app.applyTextRuns(pageIndex, withText, { font, fontSize, fill });
  };

  /** Returns true when the edit session is finished (editor should close). */
  const commitInlineEdit = async (
    text: string,
    colorHex: string,
    fontSize: number,
    family: string,
    bold: boolean,
    italic: boolean,
  ): Promise<boolean> => {
    const edit = inlineEdit;
    if (!edit) return true;
    const textChanged = text !== edit.original && text.trim().length > 0;
    const colorChanged = colorHex.toLowerCase() !== edit.colorHex.toLowerCase();
    const sizeChanged = fontSize > 0 && fontSize !== Math.round(edit.fontSize);
    const familyReplaced = family !== "original";
    const boldOn = bold && !edit.bold;
    const boldOff = !bold && edit.bold;
    const italicOn = italic && !edit.italic;
    const italicOff = !italic && edit.italic;
    if (
      !textChanged &&
      !colorChanged &&
      !sizeChanged &&
      !familyReplaced &&
      !boldOn &&
      !boldOff &&
      !italicOn &&
      !italicOff
    ) {
      setInlineEdit(null);
      return true;
    }
    const fill: [number, number, number, number] = [
      parseInt(colorHex.slice(1, 3), 16),
      parseInt(colorHex.slice(3, 5), 16),
      parseInt(colorHex.slice(5, 7), 16),
      255,
    ];
    const runEdits = mapLineEditToRuns(edit, textChanged ? text : edit.original);
    const newFill = colorChanged ? fill : undefined;
    const newSize = sizeChanged ? fontSize : undefined;
    // Turning OFF a real bold/italic needs a different face — recreate.
    const needsRecreate = familyReplaced || boldOff || italicOff;

    setSavingEdit(true);
    try {
      if (needsRecreate) {
        await commitRecreate(edit, runEdits, newFill, newSize, family, bold, italic);
        setInlineEdit(null);
        return true;
      }

      // Glyph preflight: embedded fonts are subsets that only carry the glyphs
      // the document already uses — coverage is per FACE (a 'c' in the regular
      // face proves nothing about the bold subset), so each edited run is
      // checked against its own font. Any character the run's face can't render
      // (or that fontkit can't verify) means the in-place FPDFText_SetText would
      // bake blanks/garbage. Rather than block the edit, we substitute a close
      // full font for just the affected runs so the change always lands. A run
      // that only reuses characters already on the page in its face is left
      // in-place, keeping the original embedded face pixel-for-pixel.
      let substitute = false;
      let badFace = edit.fontName;
      const badChars: string[] = [];
      if (textChanged) {
        for (let i = 0; i < edit.runs.length; i++) {
          const newText = runEdits[i].text;
          if (!newText) continue; // unchanged or removed run
          const run = edit.runs[i];
          const fresh = newCharacters(
            newText,
            run.text,
            edit.fontChars[run.fontName] ?? "",
          );
          if (!fresh.length) continue;
          const info = await app.getTextFontInfo(pageIndex, run.objectIndex);
          const missing = info?.data ? await missingGlyphs(info.data, fresh) : null;
          const runBad = missing === null ? fresh : missing;
          if (runBad.length) {
            if (!substitute) badFace = run.fontName.replace(/^[A-Z]{6}\+/, "");
            substitute = true;
            badChars.push(...runBad);
          }
        }
      }
      if (substitute) {
        // Recreate only the edited runs with a close bundled/standard face; the
        // untouched neighbors keep their original embedded fonts.
        await commitRecreate(edit, runEdits, newFill, newSize, family, bold, italic, true);
        const chars = [...new Set(badChars)].map((c) => `"${c}"`).join(" ");
        toast.info(
          `The embedded font "${badFace}" doesn't include ${chars}, so the edited text was set in a close matching font.`,
        );
        setInlineEdit(null);
        return true;
      }

      await app.applyTextRuns(pageIndex, runEdits, {
        fill: newFill,
        fontScale: sizeChanged ? fontSize / edit.fontSize : undefined,
        anchor: edit.anchor,
        synthBold: boldOn || undefined,
        synthItalic: italicOn || undefined,
      });
      setInlineEdit(null);
      return true;
    } catch {
      toast.error(
        "Couldn't edit this text in place — use the Text tool to overlay a correction instead.",
      );
      setInlineEdit(null);
      return true;
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      data-page-index={pageIndex}
      className={cn(
        "relative shrink-0 bg-white shadow-shell ring-1 ring-border/60",
        fieldDropActive && "ring-2 ring-primary",
      )}
      style={{ width: w, height: h, scrollMarginTop: 16 }}
      onPointerDown={() => {
        if (app.tool === "select") {
          app.setSelected(null);
          app.setSelectedField(null);
        }
      }}
      onDragOver={(e) => {
        // Only intercept palette-field drags (dataTransfer data is
        // unreadable here, so the module holder is the source of truth).
        if (!paletteDrag.type) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!fieldDropActive) setFieldDropActive(true);
      }}
      onDragLeave={(e) => {
        // Ignore leaves into child elements of this page.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFieldDropActive(false);
        }
      }}
      onDrop={onFieldDrop}
    >
      {visible && !painted && (
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
      )}
      {visible && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
        />
      )}
      <div
        ref={textLayerRef}
        className={cn("textLayer", app.tool === "edittext" && "edit-mode")}
        style={{
          pointerEvents: textSelectable ? "auto" : "none",
          cursor: app.tool === "edittext" || textMarkTool ? "text" : undefined,
        }}
        onClick={onTextLayerClick}
      />
      <LinkLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      {/* Existing-content editing lives on its own "Move objects" tool
          (app.tool === "editobject"), kept separate from Select so moving your
          own annotations never fights with grabbing underlying page text /
          images. Rendered BELOW the form and annotation layers so form fields
          and your own annotations keep priority — clicks that miss them fall
          through here. */}
      {app.tool === "editobject" && visible && (
        <ObjectLayer
          pdf={pdf}
          pageIndex={pageIndex}
          scale={scale}
          canvasRef={canvasRef}
        />
      )}
      <FormLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      <AnnotationLayer pageIndex={pageIndex} scale={scale} baseDims={baseDims} />
      {inlineEdit && (
        <InlineTextEditor
          edit={inlineEdit}
          saving={savingEdit}
          onCommit={commitInlineEdit}
          onCancel={() => setInlineEdit(null)}
        />
      )}
    </div>
  );
}




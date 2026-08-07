import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PdfDoc, PdfPage } from "../../lib/pdf";
import { renderTextLayer } from "../../lib/pdf";
import type { ReflowLine, TextRunEdit } from "../../lib/pdfium";
import { FIELD_META, buildFormField, paletteDrag } from "../../lib/formbuilder";
import { useApp } from "../../store";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import type { PageDims } from "./types";
import {
  type InlineEdit,
  type InlineEditRun,
  type ReflowMeta,
  FONT_CSS,
  styleKey,
  familyRoot,
  typefaceRoot,
  faceStyleDistance,
  collectLine,
  columnAwareTextWidth,
  mapLineEditToRuns,
  detectFontFromName,
  resolveTextFont,
  trustedStandardFont,
} from "./textedit";
import { collectParagraph } from "./paragraph";
import { sampleTextBackdrop } from "./textBackdrop";
import {
  makeParagraphMeasure,
  planReflow,
  reflowWouldOverlap,
  type Measure,
} from "./reflow";
import { missingGlyphs, newCharacters } from "../../lib/fontcoverage";
import { canMoveNativeContent } from "../../lib/selectionPolicy";
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
  const inlineEditSeq = useRef(0);
  const inlineWrapWidths = useRef(new Map<string, number>());
  const committedPreviewSeq = useRef(0);
  const [committedPreview, setCommittedPreview] = useState<{
    id: number;
    edit: InlineEdit;
    family: string;
  } | null>(null);
  // Highlighted while a palette field is dragged over this page.
  const [fieldDropActive, setFieldDropActive] = useState(false);

  const w = baseDims.width * scale;
  const h = baseDims.height * scale;
  const canMovePageObjects = canMoveNativeContent(app.tool, app.docPermissions);

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
    }, contentOnly ? 0 : 60);
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
    if (!app.searchQuery.trim()) return;
    const pageMatches = app.searchMatches.filter(
      (m) => m.page === pageIndex && m.source === "pdf-content",
    );
    if (!pageMatches.length) return;

    const active = app.searchMatches[app.activeMatch];

    spans.forEach((span) => {
      // The active match is the one whose run index matches — not a DOM
      // position — so it stays correct even though spans render in reading
      // order rather than extraction order.
      const run = Number(span.dataset.run);
      const ranges = pageMatches
        .flatMap((match) =>
          match.ranges
            .filter((r) => r.itemIndex === run)
            .map((range) => ({ ...range, matchId: match.id })),
        )
        .sort((a, b) => a.start - b.start || a.end - b.end);
      if (!ranges.length) return;
      const text = span.textContent ?? "";
      span.dataset.searchOriginal = text;
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const range of ranges) {
        if (range.end <= pos) continue;
        const start = Math.max(pos, range.start);
        const end = Math.min(text.length, range.end);
        if (start > pos) frag.appendChild(document.createTextNode(text.slice(pos, start)));
        const mark = document.createElement("span");
        mark.className =
          active?.id === range.matchId
            ? "search-mark search-mark-active"
            : "search-mark";
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        pos = end;
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

  // "Edit existing text": a click selects the whole PARAGRAPH around the hit
  // run (detected from line geometry — see paragraph.ts; a lone line degrades
  // to single-line editing), and the inline editor shows the joined text with
  // one row per visual line. On commit the diff is mapped back onto the
  // underlying content-stream objects and rewritten in place — no whiteout
  // patch, no overlay copy, original text truly gone. When the paragraph is
  // uniform (one face/size) the commit may REFLOW it: edits that add/remove
  // breaks or overflow a line re-wrap to the column width (see reflow.ts);
  // mixed-style paragraphs and line scope keep the document's fixed breaks.
  const openTextAtPoint = async (
    clientX: number,
    clientY: number,
    options?: { force?: boolean; objectIndex?: number },
  ) => {
    if (
      (!options?.force && app.tool !== "edittext") ||
      !app.docBytes ||
      !wrapRef.current
    )
      return;
    // A click while an edit is open (or still committing) is the gesture that
    // dismisses it — never a request to start another edit, and never worth a
    // "click a line" hint.
    if (inlineEdit || savingEdit) return;
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
      clientX - pr.left,
      clientY - pr.top,
    );
    // A native-object double click supplies its exact PDFium object index.
    // Direct Edit-text clicks still use the smallest run under the pointer.
    const hit =
      options?.objectIndex == null
        ? objs
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
            )[0]
        : objs.find(
            (o) => o.index === options.objectIndex && o.text.trim(),
          );
    // A miss (margin, image, whitespace) simply does nothing — the tool's
    // hover affordance already shows what's editable, a toast would only nag.
    if (!hit) return;

    // Join the scoped fragments into one editable string — a "\n" separator
    // (virtual, like the inferred spaces) closes each visual line —
    // remembering each run's span so the edit maps back per run. The scope
    // (line / paragraph / whole block) is the toolbar's edit-text sub-option.
    const paraLines =
      app.editTextScope === "line"
        ? [collectLine(objs, hit)]
        : collectParagraph(objs, hit, app.editTextScope);
    let joined = "";
    const runs: InlineEditRun[] = [];
    for (let li = 0; li < paraLines.length; li++) {
      const lineRuns = paraLines[li];
      for (let i = 0; i < lineRuns.length; i++) {
        const o = lineRuns[i];
        const next = lineRuns[i + 1];
        // Infer a visual space where the PDF split words into separate runs;
        // the last run of every line but the final one gets the line break.
        const sep = next
          ? next.left - o.right > 0.15 * hit.fontSize &&
            !o.text.endsWith(" ") &&
            !next.text.startsWith(" ")
            ? " "
            : ""
          : li < paraLines.length - 1
            ? "\n"
            : "";
        runs.push({
          objectIndex: o.index,
          text: o.text,
          start: joined.length,
          sep,
          originX: o.originX,
          originY: o.originY,
          fontName: o.fontName,
          fontSize: o.fontSize,
          color: o.color,
        });
        joined += o.text + sep;
      }
    }

    // Map the paragraph's PDF-space box to the exact on-screen rectangle.
    const allRuns = paraLines.flat();
    const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
      Math.min(...allRuns.map((o) => o.left)),
      Math.min(...allRuns.map((o) => o.bottom)),
      Math.max(...allRuns.map((o) => o.right)),
      Math.max(...allRuns.map((o) => o.top)),
    ]);
    const [r, g, b] = hit.color;
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    const f = detectFontFromName(hit.fontName || "");

    // Per-face proven glyphs: all page text drawn with each font. Coverage is
    // per-subset — a 'c' in the regular face proves nothing about the bold
    // face's subset — so the preflight checks each edited run's own font.
    const fontChars: Record<string, string> = {};
    const faceIndexes: Record<string, number> = {};
    for (const o of objs) {
      fontChars[o.fontName] = (fontChars[o.fontName] ?? "") + o.text;
      if (o.text.trim() && faceIndexes[o.fontName] == null) {
        faceIndexes[o.fontName] = o.index;
      }
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

    // Line scope may grow to the page edge and uses the clicked run as its
    // style template. Paragraph/block reflow still requires one face and size;
    // moving words between mixed-style paragraph lines cannot preserve styles.
    let reflow: ReflowMeta | undefined;
    const lineMeta = paraLines.map((lineRuns) => ({
      objectIndexes: lineRuns.map((o) => o.index),
      originX: lineRuns[0].originX,
      originY: lineRuns[0].originY,
    }));
    const wrapKey = `${app.editTextScope}:${lineMeta[0].objectIndexes[0]}`;
    const steps = lineMeta
      .slice(1)
      .map((l, i) => lineMeta[i].originY - l.originY)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    const leading = steps.length
      ? steps[Math.floor(steps.length / 2)]
      : hit.fontSize * 1.2;
    if (
      app.editTextScope === "line" ||
      allRuns.every(
        (o) =>
          o.fontName === hit.fontName &&
          Math.abs(o.fontSize - hit.fontSize) < 0.2,
      )
    ) {
      reflow = {
        lines: lineMeta,
        width:
          app.editTextScope === "line"
            ? 0
            : Math.max(...allRuns.map((o) => o.right)) -
              Math.min(...allRuns.map((o) => o.left)),
        leading,
      };
    }

    const editId = ++inlineEditSeq.current;
    const left = Math.min(vx1, vx2);
    const top = Math.min(vy1, vy2);
    const width = Math.max(Math.abs(vx2 - vx1), 24);
    const selectedObjectIndexes = new Set(allRuns.map((object) => object.index));
    const collisionRects = objs
      .filter(
        (object) =>
          object.text.trim() && !selectedObjectIndexes.has(object.index),
      )
      .map((object) => {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
          object.left,
          object.bottom,
          object.right,
          object.top,
        ]);
        return {
          left: Math.min(x1, x2),
          top: Math.min(y1, y2),
          right: Math.max(x1, x2),
          bottom: Math.max(y1, y2),
        };
      });
    const selectedRect = {
      left,
      top,
      right: left + width,
      bottom: top + Math.max(Math.abs(vy2 - vy1), hit.fontSize * scale),
    };
    const availableWidth = columnAwareTextWidth(
      selectedRect,
      w,
      collisionRects,
    );
    const autoWrapLine = app.editTextScope === "line" && !!reflow;
    const rememberedWidth = reflow
      ? inlineWrapWidths.current.get(wrapKey)
      : undefined;
    if (reflow) {
      if (rememberedWidth !== undefined) {
        reflow.width = Math.min(rememberedWidth, availableWidth / scale);
      } else if (app.editTextScope === "line") {
        // Stay inside the current column/cell rather than treating the page's
        // right edge as the line boundary.
        reflow.width = availableWidth / scale;
      }
    }
    const hitRun = runs.find((run) => run.objectIndex === hit.index) ?? runs[0];
    const hitFraction = Math.max(
      0,
      Math.min(1, (xPt - hit.left) / Math.max(hit.right - hit.left, 0.01)),
    );
    const caretOffset = Math.min(
      joined.length,
      hitRun.start + Math.round(hit.text.length * hitFraction),
    );
    const backdrop = sampleTextBackdrop(
      canvasRef.current,
      {
        left,
        top,
        width: availableWidth,
        height: Math.min(
          Math.max(Math.abs(vy2 - vy1), hit.fontSize * scale) * 8,
          Math.max(hit.fontSize * scale, h - top - 4),
        ),
      },
      { width: w, height: h },
      hex,
    );
    const openedEdit: InlineEdit = {
      id: editId,
      runs,
      original: joined,
      left,
      top,
      width,
      height: Math.max(Math.abs(vy2 - vy1), hit.fontSize * scale),
      maxWidth: Math.max(width, availableWidth),
      maxHeight: Math.max(hit.fontSize * scale, h - top - 4),
      preferredWidth:
        rememberedWidth === undefined
          ? undefined
          : Math.min(rememberedWidth * scale, availableWidth),
      wrapKey,
      collisionRects,
      autoWrapLine,
      caretOffset,
      fontPx: hit.fontSize * scale,
      color: `rgb(${r}, ${g}, ${b})`,
      colorHex: hex,
      backdropColor: backdrop.color,
      backdropImage: backdrop.image,
      backdropWidth: backdrop.width,
      backdropHeight: backdrop.height,
      fontSize: hit.fontSize,
      fontName: (hit.fontName || "").replace(/^[A-Z]{6}\+/, ""),
      fallbackFamily: f.family,
      embeddedFont: null,
      bold: f.bold,
      italic: f.italic,
      anchor: [runs[0].originX, runs[0].originY],
      fontChars,
      faceIndexes,
      siblings,
      reflow,
    };
    // Put the caret on screen immediately. Embedded-font extraction and
    // validation are preview enhancements and must never delay typing.
    setInlineEdit(openedEdit);

    void (async () => {
      let embeddedFont: Uint8Array | null = null;
      try {
        // Control characters (PDFium's stand-in for glyphs without a Unicode
        // mapping) have no glyph in any font and must not veto the real face.
        const chars = [
          ...new Set(joined.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, "")),
        ];
        const info = await app.getTextFontInfo(pageIndex, hit.index);
        if (info?.data) {
          const missing = await missingGlyphs(info.data, chars);
          if (missing && missing.length === 0) embeddedFont = info.data;
        }
        if (!embeddedFont && app.docBytes && app.docId) {
          const { compiledFontsForPage, compiledCandidates } = await import(
            "../../lib/fontcompile"
          );
          const fonts = await compiledFontsForPage(
            app.docId,
            app.docBytes,
            pageIndex,
          );
          for (const candidate of compiledCandidates(fonts, hit.fontName || "")) {
            const missing = await missingGlyphs(candidate.data, chars);
            if (missing && missing.length === 0) {
              embeddedFont = candidate.data;
              break;
            }
          }
        }
      } catch {
        /* keep the CSS fallback */
      }
      if (embeddedFont) {
        setInlineEdit((current) =>
          current?.id === editId ? { ...current, embeddedFont } : current,
        );
      }
    })();
  };

  const onTextLayerClick = (e: React.MouseEvent) => {
    void openTextAtPoint(e.clientX, e.clientY);
  };

  const onNativeTextDoubleClick = (
    objectIndex: number,
    clientX: number,
    clientY: number,
  ) => {
    // Reflect the active interaction in the toolbar. `force` opens the editor
    // immediately, without waiting for the tool-state update to render first.
    app.setTool("edittext");
    void openTextAtPoint(clientX, clientY, { force: true, objectIndex });
  };

  /**
   * Missing glyphs of `chars` in one run's face. The raw PDFium program is
   * checked first; when fontkit can't parse it (bare CFF/Type1 subsets) the
   * pdf.js-rebuilt program of the same face answers instead of returning
   * "unverifiable" — so covered edits stay in place rather than being pushed
   * into a substitute font.
   */
  const missingInFace = async (
    objectIndex: number,
    fontName: string,
    chars: string[],
  ): Promise<string[] | null> => {
    const info = await app.getTextFontInfo(pageIndex, objectIndex);
    let missing = info?.data ? await missingGlyphs(info.data, chars) : null;
    if (missing === null && app.docBytes && app.docId) {
      try {
        const { compiledFontsForPage, compiledCandidates } = await import(
          "../../lib/fontcompile"
        );
        const fonts = await compiledFontsForPage(app.docId!, app.docBytes, pageIndex);
        for (const cand of compiledCandidates(fonts, fontName)) {
          const m = await missingGlyphs(cand.data, chars);
          if (m === null) continue;
          if (missing === null || m.length < missing.length) missing = m;
          if (m.length === 0) break;
        }
      } catch {
        /* stays unverifiable */
      }
    }
    return missing;
  };

  /**
   * Program bytes of one page face (by a sample object index) that cover
   * `chars`: the raw PDFium program first, then its pdf.js-rebuilt version
   * when the raw one can't be parsed. Null when the face provably lacks a
   * glyph or no usable program exists.
   */
  const faceBytesCovering = async (
    objectIndex: number,
    chars: string[],
  ): Promise<Uint8Array | null> => {
    const info = await app.getTextFontInfo(pageIndex, objectIndex);
    if (!info) return null;
    if (info.data) {
      const missing = await missingGlyphs(info.data, chars);
      if (missing !== null) return missing.length === 0 ? info.data : null;
    }
    if (app.docBytes && app.docId && info.name) {
      try {
        const { compiledFontsForPage, compiledCandidates } = await import(
          "../../lib/fontcompile"
        );
        const fonts = await compiledFontsForPage(app.docId!, app.docBytes, pageIndex);
        for (const cand of compiledCandidates(fonts, info.name)) {
          const missing = await missingGlyphs(cand.data, chars);
          if (missing !== null && missing.length === 0) return cand.data;
        }
      } catch {
        /* unverifiable */
      }
    }
    return null;
  };

  /** The full installed font matching a PDF face name, when it covers `chars`. */
  const systemFaceCovering = async (
    fontName: string,
    chars: string[],
  ): Promise<Uint8Array | null> => {
    try {
      const { findSystemFont } = await import("../../lib/systemfont");
      const bytes = await findSystemFont(fontName);
      if (!bytes) return null;
      const missing = await missingGlyphs(bytes, chars);
      return missing !== null && missing.length === 0 ? bytes : null;
    } catch {
      return null;
    }
  };

  /**
   * The closest same-typeface face on the page that covers `chars` — glyph
   * borrowing: a document setting "UniversLTStd-LightUltraCn" often also
   * embeds "UniversLTStd-Cn" or "Univers67CondensedBold", and any Univers
   * beats a generic bundled substitute. Candidates are ranked by weight/
   * width/slant closeness to the wanted style.
   */
  const sameTypefaceCovering = async (
    edit: InlineEdit,
    targetFontName: string,
    chars: string[],
    wantBold: boolean,
    wantItalic: boolean,
  ): Promise<Uint8Array | null> => {
    const root = typefaceRoot(targetFontName);
    if (!root) return null;
    const candidates = Object.entries(edit.faceIndexes)
      .filter(([name]) => name !== targetFontName && typefaceRoot(name) === root)
      .sort(
        ([a], [b]) =>
          faceStyleDistance(a, targetFontName, wantBold, wantItalic) -
          faceStyleDistance(b, targetFontName, wantBold, wantItalic),
      );
    for (const [, objectIndex] of candidates) {
      const bytes = await faceBytesCovering(objectIndex, chars);
      if (bytes) return bytes;
    }
    return null;
  };

  /** Leave committed text visually in place while a structural/font worker
   * edit catches up, without keeping the editor or toolbar locked. */
  const holdCommittedPreview = (
    edit: InlineEdit,
    text: string,
    colorHex: string,
    fontSize: number,
    family: string,
    bold: boolean,
    italic: boolean,
    settled: Promise<void>,
  ) => {
    const id = ++committedPreviewSeq.current;
    setCommittedPreview({
      id,
      family,
      edit: {
        ...edit,
        id,
        original: text,
        colorHex,
        fontSize,
        bold,
        italic,
        caretOffset: 0,
      },
    });
    const clear = () =>
      setCommittedPreview((current) => (current?.id === id ? null : current));
    void settled.then(clear, clear);
  };

  /**
   * Recreate the line's runs with a different face. Preference order: a face
   * of the same family+width the document already embeds, the exact font
   * installed on this machine, any same-typeface face on the page, then the
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
    // A face the caller already resolved (e.g. the installed system font) —
    // used verbatim, skipping the cascade.
    preset?: { standardName?: string; bytes?: Uint8Array },
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

    let font: { standardName?: string; bytes?: Uint8Array } | null = preset ?? null;
    if (!font && family === "original") {
      const chars = [
        ...new Set(
          withText
            .map((r) => r.text)
            .join("")
            .replace(/[\s\u0000-\u001f\u007f-\u009f]/g, ""),
        ),
      ];
      // Same family AND width in the requested style, already embedded.
      const sib = edit.siblings[styleKey(bold, italic)];
      if (sib != null) font = await faceBytesCovering(sib, chars).then((b) => (b ? { bytes: b } : null));
      // The exact installed font — only when the style isn't being changed
      // (the installed face matches the ORIGINAL weight/slant).
      if (!font && bold === edit.bold && italic === edit.italic) {
        const sys = await systemFaceCovering(edit.fontName, chars);
        if (sys) font = { bytes: sys };
      }
      // Any same-typeface face on the page, closest style first.
      if (!font) {
        const borrowed = await sameTypefaceCovering(edit, edit.fontName, chars, bold, italic);
        if (borrowed) font = { bytes: borrowed };
      }
      if (!font) font = await resolveTextFont(edit.fallbackFamily, bold, italic);
    } else if (!font) {
      font = await resolveTextFont(family, bold, italic);
    }
    return app.applyTextRuns(pageIndex, withText, { font, fontSize, fill });
  };

  /** Returns true when the edit session is finished (editor should close). */
  const commitInlineEdit = async (
    text: string,
    colorHex: string,
    fontSize: number,
    family: string,
    bold: boolean,
    italic: boolean,
    layout?: { width: number },
  ): Promise<boolean> => {
    const edit = inlineEdit;
    if (!edit) return true;
    const oldLines = edit.original.split("\n");
    let committed = text;
    let textChanged = committed !== edit.original && committed.trim().length > 0;
    const colorChanged = colorHex.toLowerCase() !== edit.colorHex.toLowerCase();
    const sizeChanged = fontSize > 0 && fontSize !== Math.round(edit.fontSize);
    const familyReplaced = family !== "original";
    const boldOn = bold && !edit.bold;
    const boldOff = !bold && edit.bold;
    const italicOn = italic && !edit.italic;
    const italicOff = !italic && edit.italic;
    const requestedReflowWidth =
      edit.reflow && layout
        ? Math.max(1, layout.width / scale)
        : edit.reflow?.width;
    const layoutChanged =
      !!edit.reflow &&
      requestedReflowWidth !== undefined &&
      Math.abs(requestedReflowWidth - edit.reflow.width) > 0.5;
    if (layout && edit.wrapKey && requestedReflowWidth !== undefined) {
      inlineWrapWidths.current.set(edit.wrapKey, requestedReflowWidth);
    }

    // Reflow: a page-bounded line, or a paragraph/block over a uniform face,
    // re-wraps when text overflows or adds/removes soft breaks. Size and face
    // changes keep the fixed-break per-run path.
    let plan: string[] | null = null;
    let wrapMeasure: Measure | null = null;
    if (
      edit.reflow &&
      (textChanged || layoutChanged) &&
      !sizeChanged &&
      !familyReplaced &&
      !boldOn &&
      !boldOff &&
      !italicOn &&
      !italicOff
    ) {
      wrapMeasure = await makeParagraphMeasure(
        edit.embeddedFont,
        FONT_CSS[edit.fallbackFamily] ?? "Helvetica, Arial, sans-serif",
        edit.fontSize,
      );
      plan = planReflow(
        oldLines,
        committed.split("\n"),
        requestedReflowWidth ?? edit.reflow.width,
        wrapMeasure,
        layoutChanged,
      );
      if (!plan && committed.split("\n").length !== oldLines.length) {
        // The wrap settled back into the document's own breaks (a Shift+Enter
        // that changed nothing) — commit as if the text were untouched.
        committed = edit.original;
        textChanged = false;
      }
    }
    // Structural change that can't reflow: mixed paragraph faces/sizes, or a
    // line-break edit combined with a size/face change. The editor stays open.
    if (!plan && committed.split("\n").length !== oldLines.length) {
      toast.info(
        "These line breaks can't reflow across mixed paragraph styles or while changing the font or size in the same edit.",
      );
      return false;
    }
    if (
      !plan &&
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
    const runEdits = mapLineEditToRuns(edit, textChanged ? committed : edit.original);
    const newFill = colorChanged ? fill : undefined;
    const newSize = sizeChanged ? fontSize : undefined;
    // Turning OFF a real bold/italic needs a different face — recreate.
    const needsRecreate = familyReplaced || boldOff || italicOff;

    setSavingEdit(true);
    try {
      if (plan) {
        const meta = edit.reflow!;
        const lines: ReflowLine[] = meta.lines.map((l, i) => ({
          objectIndexes: l.objectIndexes,
          text: plan[i] === oldLines[i] ? null : (plan[i] ?? ""),
        }));
        // Grown lines continue the column: the X the paragraph's own
        // continuation lines use, one leading step down per line. Growth
        // extends into whatever lies below — reflow is paragraph-contained.
        const contX =
          meta.lines.length > 1
            ? Math.min(...meta.lines.slice(1).map((l) => l.originX))
            : meta.lines[0].originX;
        const lastY = meta.lines[meta.lines.length - 1].originY;
        const extras = plan.slice(meta.lines.length).map((t, k) => ({
          text: t,
          originX: contX,
          originY: lastY - meta.leading * (k + 1),
        }));
        if (extras.some((e) => e.originY < 0)) {
          toast.info("This edit would push the paragraph past the bottom of the page.");
          return false;
        }
        if (plan.length && wrapMeasure) {
          try {
            const selectedIndexes = new Set(
              meta.lines.flatMap((line) => line.objectIndexes),
            );
            const obstacles = (await app.getPageObjects(pageIndex))
              .filter(
                (object) =>
                  object.kind === "text" && !selectedIndexes.has(object.index),
              )
              .map((object) => ({
                left: object.left,
                right: object.right,
                bottom: object.bottom,
                top: object.top,
              }));
            const plannedBoxes = plan.map((text, index) =>
              index < meta.lines.length
                ? {
                    text,
                    originX: meta.lines[index].originX,
                    originY: meta.lines[index].originY,
                  }
                : extras[index - meta.lines.length],
            );
            if (reflowWouldOverlap(plannedBoxes, edit.fontSize, wrapMeasure, obstacles)) {
              const proceed = await app.requestConfirm({
                title: "Wrapped text overlaps page content",
                message:
                  "The wrapped text would overlap existing page content. Keep the overlap, or cancel and shorten the text or resize it?",
                confirmLabel: "Keep overlap",
                cancelLabel: "Keep editing",
              });
              if (!proceed) return false;
            }
          } catch {
            // Collision checking is advisory; never discard an otherwise valid
            // edit because page-object bounds could not be inspected.
          }
        }
        const lastKept = [...lines].reverse().find((l) => l.text !== "");
        const templateIndex = (lastKept ?? lines[0]).objectIndexes[0];

        // Glyph preflight over the paragraph's (uniform) face — words move
        // between lines, so coverage is checked against the whole result.
        const face = edit.runs[0].fontName;
        const fresh = newCharacters(
          plan.join("\n"),
          edit.original,
          edit.fontChars[face] ?? "",
        );
        let font: { standardName?: string; bytes?: Uint8Array } | undefined;
        if (fresh.length) {
          const missing = await missingInFace(edit.runs[0].objectIndex, face, fresh);
          const bad =
            missing === null
              ? trustedStandardFont(face, fresh)
                ? []
                : fresh
              : missing;
          if (bad.length) {
            // Face replacement recreates every line, so any replacement face
            // must cover the whole reflowed paragraph, not just the new chars.
            const allChars = [
              ...new Set(
                plan.join("").replace(/[\s\u0000-\u001f\u007f-\u009f]/g, ""),
              ),
            ];
            // The exact font installed on this machine renders precisely what
            // the subset couldn't — same face, nothing visibly changes, so
            // there is nothing to ask the user.
            const sys = await systemFaceCovering(face, allChars);
            if (sys) {
              font = { bytes: sys };
            } else {
              // Same typeface elsewhere in the document beats a bundled family.
              const borrowed = await sameTypefaceCovering(edit, face, allChars, bold, italic);
              font = borrowed
                ? { bytes: borrowed }
                : await resolveTextFont(edit.fallbackFamily, bold, italic);
              const chars = [...new Set(bad)].map((c) => `"${c}"`).join(" ");
              toast.info(
                `Used a close matching font because "${face.replace(/^[A-Z]{6}\+/, "")}" doesn't contain ${chars}.`,
              );
            }
            // Face replacement recreates every line — explicit text throughout.
            lines.forEach((l, i) => {
              if (l.text === null) l.text = oldLines[i];
            });
          }
        }

        const result = await app.applyTextReflow(pageIndex, {
          lines,
          extras,
          templateIndex,
          fill: newFill,
          font,
          // A fallback may be much wider than a condensed embedded subset.
          // Keep recreated lines inside the original paragraph column.
          maxWidth: font ? meta.width : undefined,
        });
        if (!result.previewed) {
          holdCommittedPreview(
            edit,
            committed,
            colorHex,
            fontSize,
            family,
            bold,
            italic,
            result.settled,
          );
        }
        setInlineEdit(null);
        return true;
      }

      if (needsRecreate) {
        const result = await commitRecreate(
          edit,
          runEdits,
          newFill,
          newSize,
          family,
          bold,
          italic,
        );
        if (!result.previewed) {
          holdCommittedPreview(
            edit,
            committed,
            colorHex,
            fontSize,
            family,
            bold,
            italic,
            result.settled,
          );
        }
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
          const missing = await missingInFace(run.objectIndex, run.fontName, fresh);
          // Unverifiable coverage (no parseable program) usually means a
          // non-embedded standard face — viewers render those with their own
          // complete font, so Latin text is safe. Anything else stays on the
          // conservative "treat as missing" path.
          const runBad =
            missing === null
              ? trustedStandardFont(run.fontName, fresh)
                ? []
                : fresh
              : missing;
          if (runBad.length) {
            if (!substitute) badFace = run.fontName.replace(/^[A-Z]{6}\+/, "");
            substitute = true;
            badChars.push(...runBad);
          }
        }
      }
      if (substitute) {
        // The replacement face must cover the changed runs' WHOLE text, not
        // just the new characters — recreate rewrites those runs entirely.
        const changedChars = [
          ...new Set(
            edit.runs
              .map((r, i) => runEdits[i].text ?? "")
              .join("")
              .replace(/[\s\u0000-\u001f\u007f-\u009f]/g, ""),
          ),
        ];
        // The exact installed font is the same face, complete — commit with
        // it silently; nothing visible changes.
        const sys = await systemFaceCovering(badFace, changedChars);
        if (sys) {
          const result = await commitRecreate(
            edit,
            runEdits,
            newFill,
            newSize,
            family,
            bold,
            italic,
            true,
            { bytes: sys },
          );
          if (!result.previewed) {
            holdCommittedPreview(
              edit,
              committed,
              colorHex,
              fontSize,
              family,
              bold,
              italic,
              result.settled,
            );
          }
          setInlineEdit(null);
          return true;
        }
        // A visible substitution is automatic and non-blocking; Undo/Discard
        // remain available like they are for every other edit.
        const chars = [...new Set(badChars)].map((c) => `"${c}"`).join(" ");
        // Recreate only the edited runs — same-typeface faces from the page
        // first, then the closest bundled/standard family; the untouched
        // neighbors keep their original embedded fonts.
        const result = await commitRecreate(
          edit,
          runEdits,
          newFill,
          newSize,
          family,
          bold,
          italic,
          true,
        );
        toast.info(
          `Used a close matching font because "${badFace}" doesn't contain ${chars}.`,
        );
        if (!result.previewed) {
          holdCommittedPreview(
            edit,
            committed,
            colorHex,
            fontSize,
            family,
            bold,
            italic,
            result.settled,
          );
        }
        setInlineEdit(null);
        return true;
      }

      const result = await app.applyTextRuns(pageIndex, runEdits, {
        fill: newFill,
        fontScale: sizeChanged ? fontSize / edit.fontSize : undefined,
        // A shared anchor only makes sense for one line — scaling a whole
        // paragraph about it would shift the other baselines. Multi-line
        // edits scale each run about its own origin instead.
        anchor: edit.original.includes("\n") ? undefined : edit.anchor,
        synthBold: boldOn || undefined,
        synthItalic: italicOn || undefined,
      });
      if (!result.previewed) {
        holdCommittedPreview(
          edit,
          committed,
          colorHex,
          fontSize,
          family,
          bold,
          italic,
          result.settled,
        );
      }
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
          window.dispatchEvent(
            new CustomEvent("pdfwb:object-selection", { detail: null }),
          );
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
      {/* Move/select handles both annotations and native PDF content. This
          layer stays BELOW fields and annotations, giving those overlays first
          pick; clicks that miss them reach page text/images. Restricted
          annotate-only documents omit this modifying layer. */}
      {canMovePageObjects && visible && (
        <ObjectLayer
          pdf={pdf}
          pageIndex={pageIndex}
          scale={scale}
          canvasRef={canvasRef}
          onEditText={onNativeTextDoubleClick}
        />
      )}
      <FormLayer pdf={pdf} pageIndex={pageIndex} scale={scale} visible={visible} />
      <AnnotationLayer pageIndex={pageIndex} scale={scale} baseDims={baseDims} />
      {committedPreview && (
        <InlineTextEditor
          key={`committed-${committedPreview.id}`}
          edit={committedPreview.edit}
          saving
          passive
          initialFamily={committedPreview.family}
          onCommit={async () => true}
          onCancel={() => {}}
        />
      )}
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




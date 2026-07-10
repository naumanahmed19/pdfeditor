import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";

/** One optional-content group (layer) from the catalog's /OCProperties. */
export interface LayerInfo {
  /** Indirect-ref tag ("12 0 R") — stable across a load/save round-trip of
   *  the same bytes, so it survives the list → toggle → re-list cycle. */
  id: string;
  name: string;
  visible: boolean;
  /** Nesting level from the default config's /Order tree (0 = top level). */
  depth: number;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

const OC_PROPERTIES = PDFName.of("OCProperties");

interface OcState {
  doc: PDFDocument;
  ocProps: PDFDict;
  d: PDFDict;
  /** All OCG refs from /OCGs, in declaration order. */
  ocgRefs: PDFRef[];
  /** tag → currently visible, after /BaseState + /ON + /OFF are applied. */
  visibleByTag: Map<string, boolean>;
}

function refTags(dict: PDFDict, key: string): Set<string> {
  const tags = new Set<string>();
  const arr = dict.lookupMaybe(PDFName.of(key), PDFArray);
  if (!arr) return tags;
  for (let i = 0; i < arr.size(); i++) {
    const el = arr.get(i);
    if (el instanceof PDFRef) tags.add(el.tag);
  }
  return tags;
}

function readOcState(doc: PDFDocument): OcState | null {
  const ocProps = doc.catalog.lookupMaybe(OC_PROPERTIES, PDFDict);
  if (!ocProps) return null;

  const ocgRefs: PDFRef[] = [];
  const ocgsArr = ocProps.lookupMaybe(PDFName.of("OCGs"), PDFArray);
  if (ocgsArr) {
    for (let i = 0; i < ocgsArr.size(); i++) {
      const el = ocgsArr.get(i);
      // The spec requires OCGs to be indirect; skip anything else.
      if (el instanceof PDFRef && !ocgRefs.some((r) => r.tag === el.tag)) {
        ocgRefs.push(el);
      }
    }
  }

  // /D is required by the spec when /OCProperties exists, but tolerate its
  // absence (visibility then falls back to the BaseState-ON default).
  let d = ocProps.lookupMaybe(PDFName.of("D"), PDFDict);
  if (!d) {
    d = doc.context.obj({});
    ocProps.set(PDFName.of("D"), d);
  }

  // Viewer model: BaseState first (default /ON), then /ON, then /OFF wins.
  const baseState = d.lookupMaybe(PDFName.of("BaseState"), PDFName);
  const defaultVisible = baseState?.decodeText() !== "OFF";
  const onTags = refTags(d, "ON");
  const offTags = refTags(d, "OFF");
  const visibleByTag = new Map<string, boolean>();
  for (const ref of ocgRefs) {
    visibleByTag.set(
      ref.tag,
      offTags.has(ref.tag) ? false : onTags.has(ref.tag) ? true : defaultVisible,
    );
  }

  return { doc, ocProps, d, ocgRefs, visibleByTag };
}

/**
 * List the document's optional-content groups (layers) with their current
 * default-config visibility and /Order nesting depth. OCGs missing from
 * /Order are appended at depth 0 so every group stays toggleable. Returns
 * [] when the document has no /OCProperties.
 */
export async function listLayers(bytes: Uint8Array): Promise<LayerInfo[]> {
  const doc = await load(bytes);
  const state = readOcState(doc);
  if (!state || state.ocgRefs.length === 0) return [];
  const { d, ocgRefs, visibleByTag } = state;
  const ctx = doc.context;
  const knownTags = new Set(ocgRefs.map((r) => r.tag));

  // Flatten the /Order display tree: a nested array renders one level deeper
  // than its surroundings; string labels and non-OCG refs carry no toggle so
  // they are skipped (their children still indent).
  const ordered: Array<{ ref: PDFRef; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (arr: PDFArray, depth: number) => {
    for (let i = 0; i < arr.size(); i++) {
      const raw = arr.get(i);
      const resolved = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
      if (resolved instanceof PDFArray) {
        walk(resolved, depth + 1);
      } else if (raw instanceof PDFRef && knownTags.has(raw.tag) && !seen.has(raw.tag)) {
        seen.add(raw.tag);
        ordered.push({ ref: raw, depth });
      }
    }
  };
  const order = d.lookupMaybe(PDFName.of("Order"), PDFArray);
  if (order) walk(order, 0);
  for (const ref of ocgRefs) {
    if (!seen.has(ref.tag)) ordered.push({ ref, depth: 0 });
  }

  return ordered.map(({ ref, depth }) => {
    const dict = ctx.lookupMaybe(ref, PDFDict);
    const nameObj = dict?.lookup(PDFName.of("Name"));
    const name =
      nameObj instanceof PDFHexString || nameObj instanceof PDFString
        ? nameObj.decodeText()
        : ref.tag;
    return { id: ref.tag, name, visible: visibleByTag.get(ref.tag) ?? true, depth };
  });
}

/**
 * Set the default-config visibility of the layers identified by `refTags`
 * (LayerInfo.id values); every other layer keeps its current state. The
 * default config's /ON and /OFF are rewritten to list every OCG explicitly
 * (deterministic regardless of /BaseState); other /D entries are preserved.
 */
export async function setLayerVisibility(
  bytes: Uint8Array,
  refTags: string[],
  visible: boolean,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const state = readOcState(doc);
  if (!state || state.ocgRefs.length === 0) return bytes;
  const { d, ocgRefs, visibleByTag } = state;
  const targets = new Set(refTags);

  const on: PDFRef[] = [];
  const off: PDFRef[] = [];
  for (const ref of ocgRefs) {
    const next = targets.has(ref.tag) ? visible : (visibleByTag.get(ref.tag) ?? true);
    (next ? on : off).push(ref);
  }
  d.set(PDFName.of("ON"), doc.context.obj(on));
  d.set(PDFName.of("OFF"), doc.context.obj(off));

  return doc.save();
}

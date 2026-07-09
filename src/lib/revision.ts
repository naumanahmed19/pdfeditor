/**
 * Revision-based dirty tracking — the ONE document-integrity gate.
 *
 * Every open document carries a `DocRevision`. EVERY mutation — overlay
 * annotation/form edits AND committed byte-level edits (page ops, OCR,
 * in-place text/object edits, redaction apply, decrypt) — bumps `revision`;
 * a successful save records the revision it wrote via `markSaved`. A document
 * has unsaved changes exactly when `revision !== savedRevision`, so byte-level
 * commits can no longer masquerade as "clean" by clearing the overlay maps.
 *
 * `bytesRevision`/`savedBytesRevision` additionally track whether any
 * byte-level commit happened since the last save: overlay edits can be
 * discarded (the base bytes still match what was last saved), committed byte
 * edits cannot — Discard uses this to decide whether the document may return
 * to a clean state.
 *
 * Kept as a pure module so the model is unit-testable outside the store.
 */

export interface DocRevision {
  /** Bumped by every mutation, overlay or byte-level. */
  revision: number;
  /** Value of `revision` at the last successful save (or at open). */
  savedRevision: number;
  /** Bumped by every byte-level commit (new base bytes). */
  bytesRevision: number;
  /** Value of `bytesRevision` at the last successful save (or at open). */
  savedBytesRevision: number;
}

/** What `markSaved` needs from the moment the saved bytes were produced. */
export type RevisionSnapshot = Pick<DocRevision, "revision" | "bytesRevision">;

/** A just-opened (or just-restored) document: clean. */
export function freshRevision(): DocRevision {
  return { revision: 0, savedRevision: 0, bytesRevision: 0, savedBytesRevision: 0 };
}

/** An overlay mutation: annotations, form values, field ops, undo/redo. */
export function bumpRevision(r: DocRevision): DocRevision {
  return { ...r, revision: r.revision + 1 };
}

/**
 * A byte-level commit: the document's base bytes were replaced (page ops,
 * OCR layer, in-place text/object edit, applied redactions, decrypt…).
 */
export function bumpBytesRevision(r: DocRevision): DocRevision {
  return { ...r, revision: r.revision + 1, bytesRevision: r.bytesRevision + 1 };
}

/**
 * Record a successful save. Pass the snapshot captured when the saved bytes
 * were baked: mutations that land while the write is in flight then keep the
 * document dirty instead of being silently marked saved.
 */
export function markSaved(r: DocRevision, at: RevisionSnapshot = r): DocRevision {
  return {
    ...r,
    savedRevision: at.revision,
    savedBytesRevision: at.bytesRevision,
  };
}

/** The document-integrity gate: unsaved changes exist. */
export function hasUnsavedChanges(r: DocRevision): boolean {
  return r.revision !== r.savedRevision;
}

/** Byte-level commits since the last save — these cannot be discarded. */
export function hasUnsavedByteEdits(r: DocRevision): boolean {
  return r.bytesRevision !== r.savedBytesRevision;
}

/**
 * Discard the overlay maps. The discard itself is a mutation; the document
 * only returns to "clean" when no byte-level commit happened since the last
 * save — committed byte edits are baked into the base bytes, so wiping the
 * overlays cannot restore the last-saved state.
 */
export function discardOverlays(r: DocRevision): DocRevision {
  const revision = r.revision + 1;
  return {
    ...r,
    revision,
    savedRevision: hasUnsavedByteEdits(r) ? r.savedRevision : revision,
  };
}

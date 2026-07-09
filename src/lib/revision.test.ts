import { describe, expect, it } from "vitest";
import {
  type DocRevision,
  bumpBytesRevision,
  bumpRevision,
  discardOverlays,
  freshRevision,
  hasUnsavedByteEdits,
  hasUnsavedChanges,
  markSaved,
} from "./revision";

describe("revision model — the document-integrity gate", () => {
  it("a freshly opened document is clean", () => {
    const r = freshRevision();
    expect(hasUnsavedChanges(r)).toBe(false);
    expect(hasUnsavedByteEdits(r)).toBe(false);
  });

  it("an overlay mutation (annotation / form value / field op) marks dirty", () => {
    const r = bumpRevision(freshRevision());
    expect(hasUnsavedChanges(r)).toBe(true);
    // Overlay edits are not byte-level commits — they remain discardable.
    expect(hasUnsavedByteEdits(r)).toBe(false);
  });

  it("a byte-level commit (page op / OCR / in-place edit / redaction) marks dirty", () => {
    const r = bumpBytesRevision(freshRevision());
    expect(hasUnsavedChanges(r)).toBe(true);
    expect(hasUnsavedByteEdits(r)).toBe(true);
  });

  it("a byte-level commit stays dirty even though the overlay maps are empty", () => {
    // The old heuristic (non-empty annotation/form maps) read this state as
    // clean — the regression this model exists to prevent.
    let r = freshRevision();
    r = bumpBytesRevision(r); // e.g. rotate pages: commits bytes, clears maps
    expect(hasUnsavedChanges(r)).toBe(true);
  });

  it("every mutation keeps the document dirty until a save", () => {
    let r = freshRevision();
    r = bumpRevision(r); // add annotation
    r = bumpRevision(r); // fill a form field
    r = bumpBytesRevision(r); // in-place text edit
    r = bumpRevision(r); // undo
    expect(hasUnsavedChanges(r)).toBe(true);
  });

  describe("save", () => {
    it("a successful save marks the document clean", () => {
      let r = bumpBytesRevision(bumpRevision(freshRevision()));
      r = markSaved(r, { revision: r.revision, bytesRevision: r.bytesRevision });
      expect(hasUnsavedChanges(r)).toBe(false);
      expect(hasUnsavedByteEdits(r)).toBe(false);
    });

    it("a failed save never runs markSaved — the document stays dirty", () => {
      // The store only calls markSaved after the awaited write succeeds; a
      // thrown write leaves the revision state untouched.
      const r = bumpRevision(freshRevision());
      expect(hasUnsavedChanges(r)).toBe(true);
    });

    it("edits landing while the write is in flight keep the document dirty", () => {
      let r = bumpRevision(freshRevision());
      // Snapshot captured when the bytes were baked…
      const at = { revision: r.revision, bytesRevision: r.bytesRevision };
      // …then the user keeps editing while the write is awaited.
      r = bumpRevision(r);
      r = markSaved(r, at);
      expect(hasUnsavedChanges(r)).toBe(true);
    });

    it("a byte edit during the write survives as a byte edit after save", () => {
      let r = freshRevision();
      const at = { revision: r.revision, bytesRevision: r.bytesRevision };
      r = bumpBytesRevision(r);
      r = markSaved(r, at);
      expect(hasUnsavedChanges(r)).toBe(true);
      expect(hasUnsavedByteEdits(r)).toBe(true);
    });

    it("saving again after new edits works repeatedly", () => {
      let r = freshRevision();
      for (let i = 0; i < 3; i++) {
        r = bumpRevision(r);
        expect(hasUnsavedChanges(r)).toBe(true);
        r = markSaved(r, { revision: r.revision, bytesRevision: r.bytesRevision });
        expect(hasUnsavedChanges(r)).toBe(false);
      }
    });
  });

  describe("discard", () => {
    it("discarding overlay-only edits returns the document to clean", () => {
      let r = bumpRevision(bumpRevision(freshRevision()));
      r = discardOverlays(r);
      expect(hasUnsavedChanges(r)).toBe(false);
    });

    it("discard does NOT pretend committed byte edits can be discarded", () => {
      let r = freshRevision();
      r = bumpBytesRevision(r); // e.g. applied redactions
      r = bumpRevision(r); // plus a highlight
      r = discardOverlays(r); // highlight goes; redaction is baked in
      expect(hasUnsavedChanges(r)).toBe(true);
      expect(hasUnsavedByteEdits(r)).toBe(true);
    });

    it("discard after save-then-overlay-edit is clean again", () => {
      let r = bumpBytesRevision(freshRevision());
      r = markSaved(r, { revision: r.revision, bytesRevision: r.bytesRevision });
      r = bumpRevision(r); // new annotation after the save
      r = discardOverlays(r);
      expect(hasUnsavedChanges(r)).toBe(false);
    });

    it("discard after save-then-byte-edit stays dirty", () => {
      let r = bumpRevision(freshRevision());
      r = markSaved(r, { revision: r.revision, bytesRevision: r.bytesRevision });
      r = bumpBytesRevision(r); // e.g. delete a page after saving
      r = discardOverlays(r);
      expect(hasUnsavedChanges(r)).toBe(true);
    });

    it("saving after a kept-dirty discard cleans the document", () => {
      let r = bumpBytesRevision(freshRevision());
      r = discardOverlays(r);
      expect(hasUnsavedChanges(r)).toBe(true);
      r = markSaved(r, { revision: r.revision, bytesRevision: r.bytesRevision });
      expect(hasUnsavedChanges(r)).toBe(false);
      expect(hasUnsavedByteEdits(r)).toBe(false);
    });
  });

  describe("read-only flows", () => {
    it("baking for print/preview/export does not touch the revision", () => {
      // Bake flows never call bump*/markSaved — the state object is untouched
      // and dirtiness is unchanged. Guard the immutability contract here.
      const r: Readonly<DocRevision> = freshRevision();
      const before = { ...r };
      void bumpRevision(r);
      void bumpBytesRevision(r);
      void markSaved(r);
      void discardOverlays(r);
      expect(r).toEqual(before);
    });
  });
});

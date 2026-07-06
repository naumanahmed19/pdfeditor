// Shared value types for the viewer component tree. Kept dependency-free so
// any viewer module (PageView, layers, annotations) can import it without
// pulling in JSX or the store.

/** Intrinsic (unscaled) page size in CSS pixels at scale 1. */
export interface PageDims {
  width: number;
  height: number;
}

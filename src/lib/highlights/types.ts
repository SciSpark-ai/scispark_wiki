/**
 * A quote+context+position anchor for a highlighted passage. `exact` is the
 * highlighted text verbatim; `prefix`/`suffix` are up to CONTEXT_LEN chars of
 * surrounding text (M6 Task 2's anchor core uses these to re-resolve the
 * highlight's offsets after the underlying text shifts); `start`/`end` are a
 * position hint into the surface's plain text as of anchor creation.
 */
export interface HighlightAnchor {
  exact: string
  prefix: string
  suffix: string
  start: number
  end: number
}

/** One user highlight on a paper's reader surface, persisted app-side (not a
 * wiki page — see the M6 plan's Global Constraints: highlights are direct
 * writes under highlights/, never changesets). */
export interface Highlight {
  id: string
  anchor: HighlightAnchor
  /** e.g. "yellow" (default) — one of a fixed palette defined by the reader UI. */
  color: string
  /** Optional user note attached to the highlight; "" when none. */
  note: string
  /** ISO timestamp. */
  createdTs: string
}

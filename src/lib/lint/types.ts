export type LintKind =
  | "orphan"
  | "broken-link"
  | "bad-frontmatter"
  | "index-drift"
  | "contradiction"
  | "stale-claim"

export interface LintFinding {
  lintKind: LintKind
  title: string
  description: string
  pages: string[] // bare slugs / page ids involved
  /**
   * Disambiguates WHICH finding this is when a single page can carry several
   * findings of the same `lintKind` (today only broken-link: one per distinct
   * broken slug). Carried onto the review item so applyLintFix
   * (src/lib/lint/run.ts) can re-find the EXACT finding after a sibling fix on
   * the same page has already mutated it. Absent for findings that are unique
   * per page (bad-frontmatter, index-drift).
   */
  fixTarget?: string
  /** Present ONLY for mechanical fixes: a single-file change an applyChangeset
   * can consume. `before`/`after` are full raw file contents (matching
   * VaultStorage.read/write semantics), not just the body. */
  fix?: { path: string; before: string | null; after: string }
}

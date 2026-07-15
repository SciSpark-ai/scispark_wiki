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
  /** Present ONLY for mechanical fixes: a single-file change an applyChangeset
   * can consume. `before`/`after` are full raw file contents (matching
   * VaultStorage.read/write semantics), not just the body. */
  fix?: { path: string; before: string | null; after: string }
}

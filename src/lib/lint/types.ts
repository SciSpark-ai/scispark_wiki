import type { FileChange } from "../vault/types"

export type LintKind =
  | "orphan"
  | "broken-link"
  | "bad-frontmatter"
  | "index-drift"
  | "duplicate-author"
  | "contradiction"
  | "stale-claim"

export interface LintFinding {
  lintKind: LintKind
  title: string
  description: string
  pages: string[] // bare slugs / page ids involved
  /**
   * Disambiguates WHICH finding this is when a single page can carry several
   * findings of the same `lintKind` (broken-link: one per distinct broken
   * slug; duplicate-author: one per extra/duplicate page id). Carried onto
   * the review item so applyLintFix (src/lib/lint/run.ts) can re-find the
   * EXACT finding after a sibling fix has already mutated the vault. Absent
   * for findings that are unique per page (bad-frontmatter, index-drift).
   */
  fixTarget?: string
  /** Present ONLY for mechanical fixes that touch a SINGLE file: an
   * applyChangeset-consumable change. `before`/`after` are full raw file
   * contents (matching VaultStorage.read/write semantics), not just the
   * body. Mutually exclusive with `fixes` below. */
  fix?: { path: string; before: string | null; after: string }
  /**
   * Present ONLY for mechanical fixes that touch MORE than one file (today:
   * duplicate-author's cross-vault wikilink/`related` rewrite plus deleting
   * the duplicate page). applyLintFix applies every entry as one atomic
   * multi-file changeset (`after: null` deletes the file, same as
   * `vault/types.ts#FileChange`). Mutually exclusive with `fix` above.
   */
  fixes?: FileChange[]
}

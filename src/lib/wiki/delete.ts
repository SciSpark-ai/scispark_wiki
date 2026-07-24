import type { VaultStorage } from "../vault/storage"
import type { Bundle } from "../vault/bundle"
import { loadBundle } from "../vault/bundle"
import { RESERVED_FILES, type Changeset, type FileChange, type WikiPage } from "../vault/types"
import { applyChangeset, makeChangesetId } from "../vault/changesets"
import { appendLog, writeIndex } from "../vault/index-builder"

/**
 * Wiki-root ids of the three user-model pages (`profile.md`/`interests.md`/`feedback.md` —
 * see `src/lib/usermodel/pages.ts`). Never deletable via the wiki delete action: they're
 * app-seeded at onboarding and read by the Feed/Trending/Companion skills on every run.
 */
export const PROTECTED_PAGE_IDS = ["profile", "interests", "feedback"] as const

const RESERVED_BASENAMES = new Set<string>(RESERVED_FILES)

/**
 * Whether a wiki page may be deleted via `deletePage`. False for the app-maintained
 * reserved root files (`index.md`/`log.md`/`purpose.md`/`schema.md`, deterministically
 * rebuilt/appended by the app — never hand-edited or deleted) and the user-model pages
 * (`profile`/`interests`/`feedback`). Matched by basename so both a bare id ("profile")
 * and a `wiki/`-prefixed id ("wiki/profile") are protected.
 */
export function isDeletablePage(page: WikiPage): boolean {
  const pathBasename = page.path.split("/").pop() ?? page.path
  if (RESERVED_BASENAMES.has(pathBasename)) return false

  const idBasename = page.id.split("/").pop() ?? page.id
  if ((PROTECTED_PAGE_IDS as readonly string[]).includes(idBasename)) return false

  return true
}

/**
 * Count of distinct pages linking to `id` — dedupes multiple wikilinks from the same
 * source page down to one (a page linking to the same target three times is one backlink,
 * not three).
 */
export function backlinkCount(bundle: Bundle, id: string): number {
  const froms = new Set<string>()
  for (const link of bundle.links) {
    if (link.to === id) froms.add(link.from)
  }
  return froms.size
}

/**
 * Deletes a wiki page as an undoable one-change changeset: builds
 * `{skill: "delete", model: "none", changes: [{path, before: raw, after: null}]}` and
 * applies it — `applyChangeset` persists the changeset's own audit record at
 * `.scispark/changesets/<id>.json` as part of applying, which is what makes the delete
 * show up in the existing undo surface (`listIngests`) and revertable via the generic
 * revert path / `undoIngest` for free, with zero new undo code. Then rebuilds `index.md`
 * over the post-delete bundle and appends a `delete` log entry. Returns the changeset id.
 */
export async function deletePage(storage: VaultStorage, page: WikiPage): Promise<string> {
  if (!isDeletablePage(page)) {
    throw new Error(`page is not deletable: ${page.id}`)
  }

  const raw = await storage.read(page.path)
  if (raw === null) {
    throw new Error(`page not found (nothing to delete): ${page.path}`)
  }
  const change: FileChange = { path: page.path, before: raw, after: null }
  const changeset: Changeset = {
    id: makeChangesetId(),
    skill: "delete",
    model: "none",
    timestamp: new Date().toISOString(),
    changes: [change],
  }

  await applyChangeset(storage, changeset)
  await writeIndex(storage, await loadBundle(storage))
  await appendLog(storage, {
    date: new Date().toISOString().slice(0, 10),
    op: "delete",
    summary: page.id,
  })

  return changeset.id
}

import type { VaultStorage } from "../vault/storage"
import type { PaperRecord } from "./types"
import { paperSlug } from "../wiki/authoring"
import { paperKey } from "./types"
import { buildSaveStubChangeset } from "./save"
import { applyChangesetRemote } from "../vault/changeset-client"
import { enrichRemote } from "../skills/enrich-client"
import { logEvent } from "../events/log"

export interface SavePaperResult {
  saved: boolean
  slug: string
}

export interface SavePaperOptions {
  /** ISO date (YYYY-MM-DD) for the changeset timestamp; defaults from `now`. */
  today?: string
  /** Clock injection point for `today`'s default; defaults to `new Date()`. */
  now?: () => Date
  /** Applies the tier-1 stub changeset; defaults to `applyChangesetRemote`. */
  applyFn?: typeof applyChangesetRemote
  /** Fires the background tier-2 enrich; defaults to `enrichRemote`. Never awaited. */
  enrichFn?: typeof enrichRemote
  /** Logs the save event; defaults to `logEvent`. */
  logFn?: typeof logEvent
}

/**
 * Tier-1 save + background tier-2 enrich trigger, callable from the browser
 * (feed card Save, paper-page Save). Applies `buildSaveStubChangeset`'s
 * deterministic stub changeset via the vault changeset route (a no-op,
 * `{saved: false}`, when the paper page already exists — never a
 * duplicate), logs a `feed_save` event, then fires `enrichRemote` in the
 * background.
 *
 * The enrich call is fire-and-forget: `enrichRemote` itself never throws
 * (see its docstring), but even so this function never awaits or chains
 * onto that promise for its own result, so a failure there can never
 * surface to — or delay — the caller of `savePaper`. The trailing
 * `.catch(() => {})` only swallows an otherwise-unhandled rejection (e.g.
 * from a test double or a future `enrichFn` that doesn't honor the
 * never-throws contract); it does not affect what `savePaper` returns.
 */
export async function savePaper(
  storage: VaultStorage,
  paper: PaperRecord,
  opts: SavePaperOptions = {},
): Promise<SavePaperResult> {
  const now = opts.now ?? (() => new Date())
  const today = opts.today ?? now().toISOString().slice(0, 10)
  const applyFn = opts.applyFn ?? applyChangesetRemote
  const enrichFn = opts.enrichFn ?? enrichRemote
  const logFn = opts.logFn ?? logEvent
  const slug = paperSlug(paper)

  const changeset = await buildSaveStubChangeset(storage, paper, today)
  if (changeset == null) return { saved: false, slug }

  await applyFn(changeset)
  await logFn(storage, { type: "feed_save", paperKey: paperKey(paper), title: paper.title })
  void enrichFn(slug).catch(() => {})

  return { saved: true, slug }
}

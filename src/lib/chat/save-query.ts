import type { VaultStorage } from "../vault/storage"
import type { Changeset, Frontmatter } from "../vault/types"
import { applyChangeset, makeChangesetId } from "../vault/changesets"
import { loadBundle } from "../vault/bundle"
import { serializeDocument } from "../vault/frontmatter"
import { appendLog, writeIndex } from "../vault/index-builder"
import { loadRouting } from "../wiki/schema-routing"
import { slugifyTitle } from "../wiki/authoring"
import { sanitizeSlugList } from "../skills/ingest"

export interface SaveAnswerAsQueryOpts {
  question: string
  answer: string
  sessionId: string
  /** FULL bundle ids (e.g. "wiki/papers/x") — the shape `ChatMessage.citedPageIds`
   * is documented to carry (see src/lib/chat/session.ts). Mapped down to bare
   * slugs before landing in `related[]` — see the module doc below. */
  citedPageIds: string[]
  today?: string
}

export interface SaveAnswerAsQueryResult {
  changesetId: string
  pageId: string
}

/**
 * "Save to Wiki" (llm_wiki's naming) for the chat surface: writes a chat
 * answer worth keeping as a `query` wiki page. Deterministic and LLM-free —
 * this only assembles and applies a changeset, it never calls a model.
 * Auto-ingesting the saved page into the rest of the wiki is a separate
 * future milestone and is deliberately NOT done here.
 *
 * Routing: the page lands under whatever `schema.md`'s Page Types table
 * currently routes `query` to (`wiki/queries` by default) via `loadRouting`
 * — never hardcoded, since a custom routing must be honoured.
 *
 * `related[]`: `citedPageIds` arrives as FULL bundle ids (Task 6 finalized
 * this shape so `wikiHref` can link straight through), but the repo-wide
 * frontmatter contract requires `related[]` to hold bare slugs. `sanitizeSlugList`
 * (already used for this exact purpose by ingest and capture-idea) maps each id
 * down to its last path segment, slugified, deduped.
 *
 * Slug: derived from the question via `slugifyTitle`. Saving the same question
 * twice must never clobber the first save, so a collision at the routed path
 * is resolved by appending -2, -3, ... (the same suffixing convention
 * `buildAuthorSkeletons` uses) until a free path is found.
 *
 * Applied as a single atomic changeset via `applyChangeset` (undoable through
 * the existing revert path), then `index.md` is rebuilt and a `log.md` line is
 * appended — exactly the `deletePage` pattern — so the save shows up in the
 * existing review/undo surface for free.
 */
export async function saveAnswerAsQuery(
  storage: VaultStorage,
  opts: SaveAnswerAsQueryOpts,
): Promise<SaveAnswerAsQueryResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const routing = await loadRouting(storage)
  const dir = routing["query"] ?? "wiki/queries"

  const bundle = await loadBundle(storage)
  const baseSlug = slugifyTitle(opts.question)
  let slug = baseSlug
  let suffix = 2
  while (bundle.pages.has(`${dir}/${slug}`)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  const path = `${dir}/${slug}.md`
  const pageId = `${dir}/${slug}`

  const frontmatter: Frontmatter = {
    type: "query",
    title: opts.question,
    created: today,
    updated: today,
    tags: [],
    related: sanitizeSlugList(opts.citedPageIds),
    sources: [`chat:${opts.sessionId}`],
  }
  const body = `## ${opts.question}\n\n${opts.answer.trim()}\n`
  const content = serializeDocument(frontmatter, body)

  const changeset: Changeset = {
    id: makeChangesetId(),
    skill: "chat-save",
    model: "none",
    timestamp: `${today}T00:00:00.000Z`,
    changes: [{ path, before: null, after: content }],
  }

  await applyChangeset(storage, changeset)
  await writeIndex(storage, await loadBundle(storage))
  await appendLog(storage, { date: today, op: "save", summary: pageId })

  return { changesetId: changeset.id, pageId }
}

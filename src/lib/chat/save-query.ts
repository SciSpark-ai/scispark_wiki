import type { VaultStorage } from "../vault/storage"
import type { Changeset, Frontmatter } from "../vault/types"
import { makeChangesetId } from "../vault/changesets"
import { loadBundle } from "../vault/bundle"
import { serializeDocument } from "../vault/frontmatter"
import { commitChangeset, type MutationWarning } from "../vault/mutations"
import { loadRouting } from "../wiki/schema-routing"
import { slugifyTitle } from "../wiki/authoring"
import { sanitizeSlugList } from "../skills/ingest"

export interface SaveAnswerAsQueryOpts {
  question: string
  answer: string
  sessionId?: string
  /** A reading answer has paper provenance instead of a chat session. */
  readingSource?: { paperKey: string; paperTitle: string; selection: string }
  /** FULL bundle ids (e.g. "wiki/papers/x") — the shape `ChatMessage.citedPageIds`
   * is documented to carry (see src/lib/chat/session.ts). Mapped down to bare
   * slugs before landing in `related[]` — see the module doc below. */
  citedPageIds: string[]
  today?: string
}

export interface SaveAnswerAsQueryResult {
  changesetId: string
  pageId: string
  warnings?: MutationWarning[]
}

/**
 * Collapses free text to a single line before it's embedded as a `sources[]`
 * list entry. `sources` is a flat list of short reference strings — unlike
 * `title`/`body`, which the YAML/Markdown layers can carry as legitimate
 * multi-line values, a raw newline embedded in a list entry would read back
 * (after a `serializeDocument`/`parseDocument` round trip) as if it were
 * extra content glued onto that one entry rather than the single reference
 * it's meant to be. Any run of whitespace (including newlines) collapses to
 * one space; leading/trailing whitespace is trimmed.
 */
function singleLine(text: string): string {
  return text.trim().replace(/\s+/g, " ")
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
 * `sources[]`: the SP5 design doc requires it record BOTH the session id and
 * the question (not just one), so two independent entries are written —
 * `chat:<sessionId>` and `question:<the question, collapsed to one line>` —
 * using the `prefix:value` shape the repo's own structured-id keys already
 * use (`doi:`/`arxiv:`/`pmid:` in `paperKey`, `src/lib/papers/types.ts`). BOTH
 * values are collapsed via `singleLine` before embedding so a newline (or any
 * run of whitespace) can't smear across what's meant to be one `sources[]`
 * entry — the question because a user types it, and the session id because it
 * reaches this function straight from a request body, exactly the untrusted
 * shape `singleLine` exists to defuse.
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
  if (!opts.readingSource && !opts.sessionId) throw new Error("An answer must have chat or paper provenance.")
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
    sources: [opts.readingSource ? `paper:${singleLine(opts.readingSource.paperKey)}` : `chat:${singleLine(opts.sessionId!)}`, `question:${singleLine(opts.question)}`],
  }
  const body = opts.readingSource
    ? `## Question\n\n${opts.question}\n\n## Selected passage\n\n${opts.readingSource.selection.split("\n").map(line => `> ${line}`).join("\n")}\n\n## Explanation\n\n${opts.answer.trim()}\n\n## Provenance\n\nAI-generated reading explanation; saved by the user.\n\nPaper: ${singleLine(opts.readingSource.paperTitle)}\n\nReference: ${singleLine(opts.readingSource.paperKey)}\n`
    : `## ${opts.question}\n\n${opts.answer.trim()}\n`
  const content = serializeDocument(frontmatter, body)

  const changeset: Changeset = {
    id: makeChangesetId(),
    skill: opts.readingSource ? "reading-answer-save" : "chat-save",
    model: "none",
    timestamp: `${today}T00:00:00.000Z`,
    changes: [{ path, before: null, after: content }],
  }

  const mutation = await commitChangeset(storage, changeset, {
    timestamp: changeset.timestamp,
    op: "save",
    summary: pageId,
  })

  return {
    changesetId: changeset.id,
    pageId,
    ...(mutation.warnings.length > 0 ? { warnings: mutation.warnings } : {}),
  }
}

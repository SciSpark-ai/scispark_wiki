import type { VaultStorage } from "../vault/storage"
import type { Changeset, FileChange, Frontmatter } from "../vault/types"
import { applyChangeset, makeChangesetId } from "../vault/changesets"
import { slugifyTitle, composePage, type PageDraft } from "../wiki/authoring"
import { logEvent } from "../events/log"
import { neutralizeFenceMarkers } from "../skills/ingest-analysis"

export interface CaptureIdeaInput {
  storage: VaultStorage
  paperKey: string
  paperTitle: string
  /** Wiki id of the paper page if ingested (for related[] link). */
  sourcePageId?: string
  /** The passage that sparked the idea. */
  selection: string
  /** The user's own note/idea text ("" allowed). */
  thought: string
  /** Injected date (no Date.now in this module). */
  today: string
  now?: () => Date
}

const TITLE_WORD_COUNT = 8
const FALLBACK_TITLE = "Captured idea"
const NO_THOUGHT_STUB = "Captured from reading."

/**
 * First ~n whitespace-collapsed words of `text`. Collapsing every run of
 * whitespace (including newlines) to a single space keeps the derived title
 * a single YAML scalar line — a `thought`/`selection` containing embedded
 * newlines can never inject an extra line into the frontmatter block this
 * title is written into.
 */
function firstWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0)
  return words.slice(0, n).join(" ")
}

/** Quotes `text` as a Markdown blockquote, one `> ` per line. */
function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n")
}

/**
 * Builds a `note` wiki page from a reading-companion selection + optional
 * user thought and applies it as a single atomic changeset, then logs an
 * `idea_captured` Tier-1 event carrying the changeset id.
 *
 * The note's path embeds a short id derived from the changeset id's own
 * random suffix (see makeChangesetId) rather than a bare timestamp, so two
 * captures minted within the same millisecond never collide on path (the
 * M5-ledgered `note-<timestamp>` bug this replaces).
 *
 * `selection`/`thought` are never sent to an LLM here — this is deterministic
 * note authoring, not a skill. They are still treated as untrusted data: the
 * derived `title` is whitespace-collapsed to a single line (so it can't
 * inject extra YAML lines into the frontmatter block), and the selection
 * embedded in the body is run through `neutralizeFenceMarkers` so it can
 * never forge a `<<<...>>>` fence boundary if this note is later spliced
 * into an LLM prompt (e.g. as ingest-emphasis context).
 */
export async function captureIdeaAsNote(
  input: CaptureIdeaInput,
): Promise<{ changesetId: string; path: string }> {
  const now = input.now ?? (() => new Date())

  // Neutralize fence markers up front, before either the title (a frontmatter
  // value) or the body is derived, so a literal `<<<...>>>` run in the raw
  // input can never survive anywhere in the composed note — not just in the
  // body's blockquote, but also in the derived title, in case this note is
  // later spliced into an LLM prompt as related-page context.
  const neutralizedSelection = neutralizeFenceMarkers(input.selection)
  const neutralizedThought = neutralizeFenceMarkers(input.thought)

  const titleSource = neutralizedThought.trim() !== "" ? neutralizedThought : neutralizedSelection
  const title = firstWords(titleSource, TITLE_WORD_COUNT) || FALLBACK_TITLE

  // Mint the changeset id first and reuse its random suffix as the note's
  // short id, so path-uniqueness rides on the same collision-resistant
  // source makeChangesetId already provides instead of a second generator.
  const changesetId = makeChangesetId()
  const shortId = changesetId.slice(changesetId.lastIndexOf("-") + 1)
  const path = `wiki/notes/note-${slugifyTitle(title)}-${shortId}.md`

  const frontmatter: Frontmatter = {
    type: "note",
    title,
    created: input.today,
    updated: input.today,
    tags: [],
    related: input.sourcePageId ? [input.sourcePageId] : [],
    sources: [],
  }

  const thoughtLine = neutralizedThought.trim() !== "" ? neutralizedThought.trim() : NO_THOUGHT_STUB
  const body = `${thoughtLine}\n\n${blockquote(neutralizedSelection)}\n`

  const draft: PageDraft = { path, frontmatter, body }
  const content = composePage(draft)

  const change: FileChange = { path, before: null, after: content }
  const changeset: Changeset = {
    id: changesetId,
    skill: "reading-companion",
    model: "tier:strong",
    timestamp: now().toISOString(),
    changes: [change],
  }

  await applyChangeset(input.storage, changeset)
  await logEvent(
    input.storage,
    { type: "idea_captured", paperKey: input.paperKey, changesetId: changeset.id },
    now,
  )

  return { changesetId: changeset.id, path }
}

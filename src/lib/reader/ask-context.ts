import type { VaultStorage } from "../vault/storage"
import { loadBundle } from "../vault/bundle"
import type { PaperRecord } from "../papers/types"
import { paperSlug } from "../wiki/authoring"
import { DigestSchema } from "../skills/digest"
import type { ReadingCompanionInput } from "../skills/reading-companion"

/** Minimum token length counted toward "salient terms" — short function words
 * (the/a/of/is/...) rarely carry topical signal and would otherwise dominate
 * the overlap score against every page's title. */
const MIN_TOKEN_LENGTH = 4
const MAX_WIKI_NEIGHBORS = 4
const WIKI_SNIPPET_CHARS = 300
/** Title-token matches count for more than tag-token matches — a page whose
 * *title* mentions a salient term from the selection is a much stronger
 * signal than a shared tag. */
const TITLE_MATCH_WEIGHT = 2
const TAG_MATCH_WEIGHT = 1

/** Same cache path formula `generateDigest` (src/lib/skills/digest.ts) writes
 * to, duplicated here rather than imported since that path builder isn't
 * exported — kept in sync by the shared `paperSlug` helper both sides use. */
function digestCachePath(paper: PaperRecord): string {
  return `.scispark/digests/${paperSlug(paper)}.json`
}

/** Best-effort read of a cached digest's `summary` field. Returns null on a
 * missing file, corrupt JSON, or schema-invalid content — the caller falls
 * back to the paper's abstract in every one of those cases. */
async function loadCachedDigestSummary(storage: VaultStorage, paper: PaperRecord): Promise<string | null> {
  const raw = await storage.read(digestCachePath(paper))
  if (raw == null) return null
  try {
    const parsed = DigestSchema.safeParse(JSON.parse(raw))
    return parsed.success && parsed.data.summary.trim() !== "" ? parsed.data.summary.trim() : null
  } catch {
    return null
  }
}

/** Lowercased, punctuation-split token set, filtered to `MIN_TOKEN_LENGTH`+
 * characters so short function words don't inflate overlap scores. */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH)
  return new Set(tokens)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

/**
 * Builds the "Title: ...\nAuthors: ...\n..." + summary/abstract block that
 * becomes `ReadingCompanionInput.paperMeta`. Prefers a cached digest's
 * `summary` (the same cache `generateDigest` reads/writes) over the paper's
 * raw abstract when one exists, per the M6 plan's Task 8 spec.
 */
async function buildPaperMeta(storage: VaultStorage, paper: PaperRecord): Promise<string> {
  const authorNames = paper.authors.map((a) => a.name).join(", ")
  const lines = [`Title: ${paper.title}`, `Authors: ${authorNames || "Unknown"}`]
  if (paper.year !== undefined) lines.push(`Year: ${paper.year}`)
  if (paper.venue !== undefined) lines.push(`Venue: ${paper.venue}`)

  const digestSummary = await loadCachedDigestSummary(storage, paper)
  const summaryText = digestSummary ?? paper.abstract?.trim() ?? ""
  if (summaryText !== "") {
    lines.push("", digestSummary ? "Summary:" : "Abstract:", summaryText)
  }

  return lines.join("\n")
}

/**
 * Finds wiki pages whose title/tags share salient (`MIN_TOKEN_LENGTH`+ char)
 * tokens with `selection`, scores them (title matches weighted over tag
 * matches), and returns the top `MAX_WIKI_NEIGHBORS` as compact
 * "id: title\n<first ~300 chars of body>" blocks joined by a separator.
 * Deterministic and DOM-free — pure token overlap over `loadBundle`, no LLM
 * call — so it's fully unit-testable (M6 plan Task 8, Step 1).
 */
async function buildWikiNeighborhood(storage: VaultStorage, selection: string): Promise<string> {
  const selectionTokens = tokenize(selection)
  if (selectionTokens.size === 0) return "(no related wiki pages found)"

  const bundle = await loadBundle(storage)
  const scored: Array<{ id: string; title: string; body: string; score: number }> = []

  for (const page of bundle.pages.values()) {
    const title = typeof page.frontmatter.title === "string" ? page.frontmatter.title : page.id
    const titleTokens = tokenize(title)
    const tagTokens = tokenize(asStringArray(page.frontmatter.tags).join(" "))

    let score = 0
    for (const t of titleTokens) if (selectionTokens.has(t)) score += TITLE_MATCH_WEIGHT
    for (const t of tagTokens) if (selectionTokens.has(t)) score += TAG_MATCH_WEIGHT

    if (score > 0) scored.push({ id: page.id, title, body: page.body, score })
  }

  if (scored.length === 0) return "(no related wiki pages found)"

  // Highest score first; ties broken by id so the result is deterministic.
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  return scored
    .slice(0, MAX_WIKI_NEIGHBORS)
    .map((p) => `${p.id}: ${p.title}\n${p.body.trim().slice(0, WIKI_SNIPPET_CHARS)}`)
    .join("\n\n---\n\n")
}

/**
 * Orchestrator-owned context assembly for the Reading-Companion skill
 * (blessed pattern, docs/design/04-agent-harness.md): the skill itself is a
 * storage-free LLM-calling unit, so this function — not the skill — reads the
 * vault (digest cache + wiki bundle) to build its input.
 *
 * `selection` is passed through verbatim (not neutralized/fenced here) —
 * `readingCompanionSkill`'s own `buildUserMessage` fences and neutralizes
 * every section (including SELECTION) before it reaches the model, so
 * fencing here too would double-neutralize.
 */
export async function buildAskContext(
  storage: VaultStorage,
  args: { paper: PaperRecord; selection: string; surroundingText: string; userQuestion: string },
): Promise<ReadingCompanionInput> {
  const [paperMeta, wikiNeighborhood] = await Promise.all([
    buildPaperMeta(storage, args.paper),
    buildWikiNeighborhood(storage, args.selection),
  ])

  return {
    selection: args.selection,
    surrounding: args.surroundingText,
    paperMeta,
    wikiNeighborhood,
    userQuestion: args.userQuestion,
  }
}

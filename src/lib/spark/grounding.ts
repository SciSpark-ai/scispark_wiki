import type { VaultStorage } from "../vault/storage"
import type { Bundle } from "../vault/bundle"
import { loadBundle } from "../vault/bundle"
import type { PaperIds, PaperRecord, SourceId } from "../papers/types"
import { paperKey, mergeRecords } from "../papers/types"
import { neutralizeFenceMarkers } from "../skills/ingest-analysis"

// ---------------------------------------------------------------------------
// Deep Spark grounding assembly: warm-start from the vault (design delta vs.
// ResearchStudio's cold Phase 0) + fresh literature retrieval via the M3
// proxy. Pure orchestration given an injected `searchFn` — no LLM call, so
// it's fully unit-testable with a fake searchFn + MemoryVaultStorage. See
// docs/superpowers/plans/2026-07-13-m9-spark.md Task 3.
// ---------------------------------------------------------------------------

export interface GroundingPaper {
  ids: PaperIds
  title: string
  year?: number
  abstract?: string
  source: string
}

export interface SparkGrounding {
  /** Compact, neutralized vault-page snippets relevant to the direction (not
   * itself fence-wrapped — `contextText` below is the fence-ready block). */
  vaultSnippets: string
  /** Vault page ids backing `vaultSnippets`, for the idea page's grounding links. */
  vaultPageIds: string[]
  /** Fresh literature retrieved via the proxy, deduped and capped. */
  freshPapers: GroundingPaper[]
  /** The fully fenced `<<<VAULT>>>` + `<<<LITERATURE>>>` block Deep-Spark
   * phases (bottleneck/ideation/scoop/audit) consume directly. */
  contextText: string
}

/** Same shape as the M5 `browserSearchFn` (src/lib/skills/feed.ts) — the app's
 * `/api/search/{source}` proxy passthrough, injected so this module never
 * calls an upstream provider directly. */
export type SearchFn = (source: string, query: string, limit: number) => Promise<PaperRecord[]>

// ---------------------------------------------------------------------------
// Warm vault start: clusterPageIds pages first (explicit ids are trusted
// regardless of page type), then a deterministic token-overlap search over
// the bundle restricted to concept/method/finding/paper pages — mirrors the
// M6 `buildWikiNeighborhood`/Task-2 `assembleVaultContext` approach.
// ---------------------------------------------------------------------------

const MIN_TOKEN_LENGTH = 4
const MAX_SNIPPET_PAGES = 6
const SNIPPET_CHARS = 300
const TITLE_MATCH_WEIGHT = 2
const TAG_MATCH_WEIGHT = 1

/** Page types the token-overlap warm-start search draws from — deliberately
 * excludes note/idea/author/topic/project/comparison pages, which are either
 * user-authored or not useful research grounding for ideation. */
const GROUNDING_PAGE_TYPES = new Set(["concept", "method", "finding", "paper"])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= MIN_TOKEN_LENGTH),
  )
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

interface SnippetPage {
  id: string
  title: string
  body: string
}

/** Resolves `clusterPageIds` against the bundle, silently dropping any id that
 * isn't a real page (a stale companion-trigger id should degrade gracefully). */
function pagesFromClusterIds(bundle: Bundle, clusterPageIds: string[]): SnippetPage[] {
  const pages: SnippetPage[] = []
  for (const id of clusterPageIds) {
    const page = bundle.pages.get(id)
    if (!page) continue
    const title = typeof page.frontmatter.title === "string" ? page.frontmatter.title : page.id
    pages.push({ id: page.id, title, body: page.body })
  }
  return pages
}

/** Deterministic, LLM-free token-overlap search over concept/method/finding/paper
 * pages for `direction` — title matches weighted over tag matches, ties broken
 * by id for determinism. */
function pagesByTokenOverlap(bundle: Bundle, direction: string): SnippetPage[] {
  const directionTokens = tokenize(direction)
  if (directionTokens.size === 0) return []

  const scored: Array<SnippetPage & { score: number }> = []
  for (const page of bundle.pages.values()) {
    if (!GROUNDING_PAGE_TYPES.has(page.frontmatter.type)) continue
    const title = typeof page.frontmatter.title === "string" ? page.frontmatter.title : page.id
    const titleTokens = tokenize(title)
    const tagTokens = tokenize(asStringArray(page.frontmatter.tags).join(" "))

    let score = 0
    for (const t of titleTokens) if (directionTokens.has(t)) score += TITLE_MATCH_WEIGHT
    for (const t of tagTokens) if (directionTokens.has(t)) score += TAG_MATCH_WEIGHT

    if (score > 0) scored.push({ id: page.id, title, body: page.body, score })
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored
}

/** Combines clusterPageIds pages (first, explicit ids trusted) with
 * token-overlap results (filling any remaining slots), deduped by id and
 * capped at `MAX_SNIPPET_PAGES`. */
function selectWarmVaultPages(bundle: Bundle, opts: { direction: string; clusterPageIds?: string[] }): SnippetPage[] {
  const clustered =
    opts.clusterPageIds && opts.clusterPageIds.length > 0 ? pagesFromClusterIds(bundle, opts.clusterPageIds) : []
  const overlap = pagesByTokenOverlap(bundle, opts.direction)

  const seen = new Set(clustered.map((p) => p.id))
  const combined = [...clustered]
  for (const page of overlap) {
    if (combined.length >= MAX_SNIPPET_PAGES) break
    if (seen.has(page.id)) continue
    seen.add(page.id)
    combined.push(page)
  }
  return combined
}

/** Compact "id: title\n<first ~SNIPPET_CHARS chars of body>" blocks,
 * neutralized so untrusted vault content can never forge a fence boundary. */
function renderSnippets(pages: SnippetPage[]): string {
  if (pages.length === 0) return "(no related vault pages found)"
  return pages
    .map((p) => neutralizeFenceMarkers(`${p.id}: ${p.title}\n${p.body.trim().slice(0, SNIPPET_CHARS)}`))
    .join("\n\n---\n\n")
}

// ---------------------------------------------------------------------------
// Fresh retrieval: deterministic keyword-query derivation (no LLM, v1 — an
// LLM query-former is a later enhancement) when the caller doesn't supply
// `queries`, run concurrently across every paper source through the injected
// `searchFn`, merged/deduped via the same `paperKey`/`mergeRecords` machinery
// `retrieveCandidates` (src/lib/skills/feed.ts) uses. A failed query never
// sinks the others — it contributes `[]`.
// ---------------------------------------------------------------------------

// Keyless-safe default (same as the M5 feed): arxiv + openalex need no API key.
// s2/pubmed require S2_API_KEY/NCBI_API_KEY and rate-limit hard when keyless, so
// blanketing all 4 per query (12–16 searches/run) risks throttling. Callers with
// keys configured can widen this via `opts.sources`.
const DEFAULT_SOURCES: readonly SourceId[] = ["arxiv", "openalex"]
const DEFAULT_PER_QUERY_LIMIT = 8
const MAX_FRESH_PAPERS = 20
const LITERATURE_ABSTRACT_CHARS = 400

/** Common English function/hedge words that pass the length filter but carry
 * no topical signal — filtered out of "salient terms" so derived queries
 * stay on-topic. */
const STOPWORDS = new Set([
  "with",
  "that",
  "this",
  "from",
  "into",
  "over",
  "under",
  "about",
  "using",
  "based",
  "toward",
  "towards",
  "study",
  "studies",
  "research",
  "paper",
  "papers",
  "approach",
  "approaches",
  "method",
  "methods",
  "when",
  "what",
  "why",
  "how",
  "does",
  "their",
  "there",
  "these",
  "those",
  "more",
  "than",
  "such",
  "have",
  "been",
  "being",
  "will",
  "would",
  "could",
  "some",
  "very",
])

/** Lowercased, punctuation-split, stopword-filtered, order-preserving-deduped
 * token list — the "salient terms" a direction is distilled to. */
function salientTerms(direction: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of direction.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TOKEN_LENGTH) continue
    if (STOPWORDS.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    terms.push(raw)
  }
  return terms
}

/**
 * Deterministically derives 1-4 keyword queries from `direction`'s salient
 * terms — pure, no LLM call (v1 per the plan). Query 1 is a broad phrase over
 * the first (up to) 5 salient terms; queries 2-4 are individual salient terms
 * not already covered verbatim by query 1, giving narrower per-term facet
 * coverage. Falls back to the trimmed raw direction when no term clears the
 * stopword/length filter, and to `[]` when `direction` is empty/whitespace.
 */
export function deriveQueries(direction: string): string[] {
  const terms = salientTerms(direction)
  if (terms.length === 0) {
    const trimmed = direction.trim()
    return trimmed ? [trimmed] : []
  }

  const queries: string[] = [terms.slice(0, 5).join(" ")]
  for (const term of terms) {
    if (queries.length >= 4) break
    if (queries.includes(term)) continue
    queries.push(term)
  }
  return queries
}

function toGroundingPaper(record: PaperRecord): GroundingPaper {
  return { ids: record.ids, title: record.title, year: record.year, abstract: record.abstract, source: record.source }
}

/** Runs every `query` across every default source concurrently through
 * `searchFn`, merges duplicates by `paperKey` (via `mergeRecords`, same
 * approach `retrieveCandidates` uses), and caps the result at
 * `MAX_FRESH_PAPERS` in first-seen order. A rejecting/throwing call
 * contributes `[]` rather than failing the whole retrieval. */
async function fetchFreshPapers(
  searchFn: SearchFn,
  queries: string[],
  perQueryLimit: number,
  sources: readonly SourceId[],
): Promise<PaperRecord[]> {
  const calls = queries.flatMap((query) => sources.map((source) => ({ source, query })))

  const perCallResults = await Promise.all(
    calls.map(async ({ source, query }) => {
      try {
        return await searchFn(source, query, perQueryLimit)
      } catch {
        return []
      }
    }),
  )

  const merged = new Map<string, PaperRecord>()
  const order: string[] = []
  for (const records of perCallResults) {
    for (const record of records) {
      const key = paperKey(record)
      const existing = merged.get(key)
      if (existing) {
        merged.set(key, mergeRecords(existing, record))
      } else {
        merged.set(key, record)
        order.push(key)
      }
    }
  }

  const capped: PaperRecord[] = []
  for (const key of order) {
    if (capped.length >= MAX_FRESH_PAPERS) break
    const record = merged.get(key)
    if (record) capped.push(record)
  }
  return capped
}

/** Numbered `[i] title (year) — abstract≤400ch` literature block, neutralized
 * per entry since paper metadata is untrusted input. */
function renderLiterature(papers: GroundingPaper[]): string {
  if (papers.length === 0) return "(no literature retrieved)"
  return papers
    .map((p, i) => {
      const title = neutralizeFenceMarkers(p.title)
      const year = p.year !== undefined ? String(p.year) : "n/a"
      const rawAbstract = p.abstract ?? ""
      const abstract = neutralizeFenceMarkers(
        rawAbstract.length > LITERATURE_ABSTRACT_CHARS ? rawAbstract.slice(0, LITERATURE_ABSTRACT_CHARS) : rawAbstract,
      )
      return `[${i + 1}] ${title} (${year}) — ${abstract}`
    })
    .join("\n")
}

/** Wraps `body` in a `<<<TAG>>> ... <<<END-TAG>>>` fence, neutralizing any
 * fence-marker runs inside `body` first so untrusted vault/literature text
 * can never forge a fence boundary of its own. */
function fence(tag: string, body: string): string {
  return `<<<${tag}>>>\n${neutralizeFenceMarkers(body)}\n<<<END-${tag}>>>`
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Assembles Deep Spark's grounding: a warm-start vault neighborhood (cluster
 * pages + token-overlap over concept/method/finding/paper pages) plus fresh
 * literature retrieved via the proxy (caller-supplied `queries` or
 * deterministically derived ones), merged/deduped/capped. Pure orchestration
 * given `searchFn` — no LLM call, so it's fully unit-testable with a fake
 * searchFn + `MemoryVaultStorage`. `contextText` is the fence-ready block the
 * bottleneck/ideation/scoop/audit phases consume directly.
 */
export async function assembleGrounding(
  storage: VaultStorage,
  opts: {
    direction: string
    clusterPageIds?: string[]
    searchFn: SearchFn
    queries?: string[]
    perQueryLimit?: number
    /** Sources to query; defaults to the keyless-safe arxiv+openalex. */
    sources?: readonly SourceId[]
  },
): Promise<SparkGrounding> {
  const bundle = await loadBundle(storage)
  const warmPages = selectWarmVaultPages(bundle, { direction: opts.direction, clusterPageIds: opts.clusterPageIds })
  const vaultSnippets = renderSnippets(warmPages)
  const vaultPageIds = warmPages.map((p) => p.id)

  const queries = opts.queries && opts.queries.length > 0 ? opts.queries : deriveQueries(opts.direction)
  const perQueryLimit = opts.perQueryLimit ?? DEFAULT_PER_QUERY_LIMIT
  const freshRecords = await fetchFreshPapers(opts.searchFn, queries, perQueryLimit, opts.sources ?? DEFAULT_SOURCES)
  const freshPapers = freshRecords.map(toGroundingPaper)

  const contextText = [fence("VAULT", vaultSnippets), fence("LITERATURE", renderLiterature(freshPapers))].join("\n\n")

  return { vaultSnippets, vaultPageIds, freshPapers, contextText }
}

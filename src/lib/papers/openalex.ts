import { fetchWithTimeout } from "./fetch-timeout"
import { PaperSourceError, nonEmpty, normalizeDoi, type PaperAuthor, type PaperRecord } from "./types"

const OPENALEX_WORKS_URL = "https://api.openalex.org/works"
const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const MAX_FIELDS = 5
// Max group_by page size per OpenAlex's docs — one grouped request covers up
// to 200 daily buckets, comfortably spanning trending's 8-week (56-day) window.
const GROUP_BY_PER_PAGE = 200

interface OpenAlexAuthor {
  id?: string | null
  display_name?: string | null
}

interface OpenAlexAuthorship {
  author?: OpenAlexAuthor | null
}

interface OpenAlexSource {
  display_name?: string | null
}

interface OpenAlexPrimaryLocation {
  source?: OpenAlexSource | null
  pdf_url?: string | null
}

interface OpenAlexOpenAccess {
  oa_url?: string | null
}

interface OpenAlexTopic {
  display_name?: string | null
  score?: number | null
}

interface OpenAlexIds {
  doi?: string | null
}

interface OpenAlexWork {
  id?: string | null
  doi?: string | null
  display_name?: string | null
  publication_year?: number | null
  publication_date?: string | null
  ids?: OpenAlexIds | null
  primary_location?: OpenAlexPrimaryLocation | null
  open_access?: OpenAlexOpenAccess | null
  authorships?: OpenAlexAuthorship[] | null
  cited_by_count?: number | null
  topics?: OpenAlexTopic[] | null
  abstract_inverted_index?: Record<string, number[]> | null
}

interface OpenAlexWorksResponse {
  results?: OpenAlexWork[] | null
  meta?: { count?: number } | null
}

export interface OpenAlexQuery {
  query: string
  limit?: number
  fromDate?: string
  toDate?: string
  /**
   * Ranking preference, chosen upstream by intent extraction: "date" →
   * newest-first (sort=publication_date:desc); "relevance" or omitted →
   * OpenAlex's default relevance_score ranking for a `search` query.
   */
  sort?: "relevance" | "date"
}

export interface OpenAlexDeps {
  fetchFn?: typeof fetch
  mailto?: string
  /**
   * OpenAlex API key (from OPENALEX_API_KEY / openalex.org/settings/api).
   * Raises the daily credit budget from ~$0.10 (keyless) to $1/day. Sent as
   * the `api_key` query param — NEVER logged (same privacy contract as the
   * query text itself).
   */
  apiKey?: string
  /** Injectable delay for retry backoff (tests pass a no-op to avoid real waits). */
  sleep?: (ms: number) => Promise<void>
  /** Total attempts including the first (default 3). */
  maxAttempts?: number
}

// Mirrors arxiv.ts's retry hardening: OpenAlex is politeness-rate-limited and sheds
// load under bursts with 429s (trending's per-week count queries fan out several
// calls back to back). Retry those transient statuses with backoff rather than
// failing the whole series on the first blip. Constants are kept local to this
// file (same as arxiv.ts keeps its own) rather than shared, to avoid coupling the
// two source modules.
const RETRYABLE_STATUS = (status: number): boolean => status === 429 || status >= 500
const DEFAULT_MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 8000

function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const ra = retryAfterHeader != null ? Number(retryAfterHeader) : NaN
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, BACKOFF_CAP_MS)
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Extracts the trailing path segment from an OpenAlex entity URL, e.g.
 * "https://openalex.org/W3138516171" -> "W3138516171". Returns undefined
 * for missing/empty input.
 */
function idTail(url: string | null | undefined): string | undefined {
  if (url == null) return undefined
  const trimmed = url.trim()
  if (trimmed === "") return undefined
  const segments = trimmed.split("/")
  const tail = segments[segments.length - 1]
  return tail === "" ? undefined : tail
}

/**
 * Reconstructs a plaintext abstract from OpenAlex's inverted index
 * representation (word -> array of positions). Returns undefined when the
 * index is missing, null, or empty.
 */
function reconstructAbstract(index: Record<string, number[]> | null | undefined): string | undefined {
  if (index == null) return undefined
  const entries = Object.entries(index)
  if (entries.length === 0) return undefined

  let maxPosition = -1
  for (const [, positions] of entries) {
    for (const position of positions) {
      if (position > maxPosition) maxPosition = position
    }
  }
  if (maxPosition < 0) return undefined

  const words: (string | undefined)[] = new Array(maxPosition + 1).fill(undefined)
  for (const [word, positions] of entries) {
    for (const position of positions) {
      words[position] = word
    }
  }

  return words.filter((w): w is string => w !== undefined).join(" ")
}

function mapAuthors(authorships: OpenAlexAuthorship[] | null | undefined): PaperAuthor[] {
  if (!authorships) return []
  const authors: PaperAuthor[] = []
  for (const authorship of authorships) {
    const author = authorship.author
    if (!author?.display_name) continue
    authors.push({
      name: author.display_name,
      openalexId: idTail(author.id),
    })
  }
  return authors
}

function mapFields(topics: OpenAlexTopic[] | null | undefined): string[] {
  if (!topics) return []
  return [...topics]
    .filter((t): t is OpenAlexTopic & { display_name: string; score: number } => t.display_name != null && t.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FIELDS)
    .map((t) => t.display_name)
}

function mapWork(work: OpenAlexWork): PaperRecord {
  return {
    ids: {
      doi: normalizeDoi(work.ids?.doi),
      openalex: idTail(work.id),
    },
    title: work.display_name ?? "",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: mapAuthors(work.authorships),
    year: work.publication_year ?? undefined,
    date: work.publication_date ?? undefined,
    venue: work.primary_location?.source?.display_name ?? undefined,
    citationCount: work.cited_by_count ?? undefined,
    oaUrl: nonEmpty(work.open_access?.oa_url),
    pdfUrl: nonEmpty(work.primary_location?.pdf_url),
    fields: mapFields(work.topics),
    source: "openalex",
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}

interface BuildUrlOpts {
  /** Sets group_by=<value> and forces per_page to GROUP_BY_PER_PAGE (a group_by response has no per-work rows, so the normal limit clamp doesn't apply). */
  groupBy?: string
  /** Extra `filter=` clauses, joined ahead of the date clauses (e.g. `primary_topic.id:T10689`). */
  filters?: string[]
}

/**
 * `primary_topic.id:<id>` clause for a topic key. `group_by` returns keys as
 * full entity URLs ("https://openalex.org/T10689"); OpenAlex accepts either
 * form in a filter, but the bare id keeps the request URL short and
 * unambiguous once URLSearchParams percent-encodes the value.
 */
function topicFilterClause(topicId: string): string {
  return `primary_topic.id:${idTail(topicId) ?? topicId}`
}

function buildUrl(q: OpenAlexQuery, deps: OpenAlexDeps, opts: BuildUrlOpts = {}): string {
  const url = new URL(OPENALEX_WORKS_URL)
  url.searchParams.set("search", q.query)
  url.searchParams.set("per_page", String(opts.groupBy ? GROUP_BY_PER_PAGE : clampLimit(q.limit)))
  if (deps.mailto) {
    url.searchParams.set("mailto", deps.mailto)
  }
  if (deps.apiKey) {
    url.searchParams.set("api_key", deps.apiKey)
  }
  const filterClauses: string[] = [...(opts.filters ?? [])]
  if (q.fromDate) {
    filterClauses.push(`from_publication_date:${q.fromDate}`)
  }
  if (q.toDate) {
    filterClauses.push(`to_publication_date:${q.toDate}`)
  }
  if (filterClauses.length > 0) {
    url.searchParams.set("filter", filterClauses.join(","))
  }
  if (opts.groupBy) {
    url.searchParams.set("group_by", opts.groupBy)
  } else if (q.sort === "date") {
    // Recency-intent search: newest-first. Relevance ("relevance"/omitted) is
    // OpenAlex's default for a `search` query, so we leave sort unset there.
    // Never applied to a group_by request (it has no per-work ordering).
    url.searchParams.set("sort", "publication_date:desc")
  }
  return url.toString()
}

/**
 * Shared fetch-with-retry loop used by both searchOpenAlex and
 * countOpenAlexWorks. Attempts the request up to maxAttempts times, retrying
 * on retryable HTTP statuses (429/5xx) and network/timeout errors with
 * backoff (honoring Retry-After when present); returns the parsed JSON body
 * on success or throws PaperSourceError on exhaustion / non-retryable status.
 */
async function fetchOpenAlexJson(url: string, deps: OpenAlexDeps): Promise<unknown> {
  const fetchFn = deps.fetchFn ?? fetch
  const sleep = deps.sleep ?? realSleep
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  let lastError: PaperSourceError | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetchWithTimeout(fetchFn, url)
    } catch (err) {
      // Network error — transient, retry with backoff.
      lastError = new PaperSourceError(err instanceof Error ? err.message : "OpenAlex request failed")
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt, null))
        continue
      }
      throw lastError
    }

    if (response.ok) {
      return (await response.json()) as unknown
    }

    lastError = new PaperSourceError(`OpenAlex request failed with status ${response.status}`, response.status)
    if (RETRYABLE_STATUS(response.status) && attempt < maxAttempts - 1) {
      await sleep(backoffDelayMs(attempt, response.headers.get("retry-after")))
      continue
    }
    throw lastError
  }

  // Unreachable: the loop returns or throws on every path.
  throw lastError ?? new PaperSourceError("OpenAlex request failed")
}

/**
 * Searches OpenAlex's /works endpoint and maps results into the unified
 * PaperRecord schema. Never logs the query text (privacy constraint).
 */
export async function searchOpenAlex(q: OpenAlexQuery, deps: OpenAlexDeps = {}): Promise<PaperRecord[]> {
  const url = buildUrl(q, deps)
  const body = (await fetchOpenAlexJson(url, deps)) as OpenAlexWorksResponse
  const results = body.results ?? []
  return results.map(mapWork)
}

/**
 * Returns the total OpenAlex work count for a query within a date range,
 * without fetching any paper records (per_page is fixed at 1). Used by
 * trending weekly aggregation to get real per-week counts cheaply.
 *
 * `topicId` additionally scopes the count to one `primary_topic.id`. That is
 * the leaderboard's PRIOR-count lookup (SP4 §3): a count carries no 200-bucket
 * horizon, so it reads a topic's true total where `groupWorksByTopic` would
 * simply omit the topic below its visibility threshold. Pass the SAME `query`
 * as the grouped call being compared against — the count is scoped by
 * `search=` too, so an unscoped lookup would return a much larger corpus-wide
 * figure and manufacture a fake decline (live check, Computer Science /
 * T10689, 2026-07-25: 16 scoped vs 149 unscoped for the same prior window,
 * against a scoped recent count of 27).
 */
export async function countOpenAlexWorks(
  q: { query: string; fromDate: string; toDate: string; topicId?: string },
  deps: OpenAlexDeps = {},
): Promise<number> {
  const url = buildUrl({ query: q.query, fromDate: q.fromDate, toDate: q.toDate, limit: 1 }, deps, {
    filters: q.topicId ? [topicFilterClause(q.topicId)] : undefined,
  })
  const body = (await fetchOpenAlexJson(url, deps)) as OpenAlexWorksResponse
  return body.meta?.count ?? 0
}

interface OpenAlexGroupByEntry {
  key?: unknown
  key_display_name?: unknown
  count?: unknown
}

interface OpenAlexGroupByResponse {
  group_by?: OpenAlexGroupByEntry[] | null
}

/**
 * NOTE (2026-07-25): there is deliberately NO `group_by=publication_date`
 * helper here. Trending once used one to buy a whole weekly series for 1
 * credit, but OpenAlex now rejects that grouping outright — HTTP 400 "Invalid
 * query parameters error" in every form tried (plain, with date filters, with
 * and without an API key), while `group_by=publication_year` and
 * `group_by=primary_topic.id` on the same endpoint return 200. The helper was
 * therefore permanently falling back to the per-week count ladder, and it is
 * removed rather than left as a path that can never succeed. Don't reintroduce
 * it without re-verifying against the live API first.
 */

export interface GroupEntry {
  key: string
  label: string
  count: number
}

/**
 * Shared body-parsing/mapping for the labeled group_by variants used by
 * trending's "heating topics" leaderboard (SP4): each bucket carries a
 * key_display_name that becomes the human-readable label. Drops entries with
 * no display name and OpenAlex's literal "unknown" bucket (its catch-all for
 * unclassified works — never a real topic/field).
 */
function mapGroupByEntries(groups: OpenAlexGroupByEntry[]): GroupEntry[] {
  const result: GroupEntry[] = []
  for (const g of groups) {
    if (g == null) continue
    const key = typeof g.key === "string" ? g.key : undefined
    const label = typeof g.key_display_name === "string" ? g.key_display_name : undefined
    const count = typeof g.count === "number" ? g.count : undefined
    if (key === undefined || label === undefined || count === undefined) continue
    if (key === "unknown") continue
    result.push({ key, label, count })
  }
  return result
}

/**
 * Fetches per-topic work counts for a query within a date range via a SINGLE
 * `group_by=primary_topic.id` request (1 OpenAlex credit). Used by trending's
 * "heating topics" leaderboard (SP4) to find which fine-grained topics are
 * trending within a field. Same retry/backoff/timeout contract as the other
 * OpenAlex calls; tolerates missing/malformed entries by skipping them.
 */
export async function groupWorksByTopic(
  q: { query: string; fromDate: string; toDate: string },
  deps: OpenAlexDeps = {},
): Promise<GroupEntry[]> {
  const url = buildUrl({ query: q.query, fromDate: q.fromDate, toDate: q.toDate }, deps, {
    groupBy: "primary_topic.id",
  })
  const body = (await fetchOpenAlexJson(url, deps)) as OpenAlexGroupByResponse
  return mapGroupByEntries(body.group_by ?? [])
}

/**
 * Fetches per-field work counts for a query within a date range via a SINGLE
 * `group_by=primary_topic.field.id` request (1 OpenAlex credit). Same shape
 * as groupWorksByTopic, one level up OpenAlex's topic hierarchy (field is the
 * coarser grouping topics roll up into).
 */
export async function groupWorksByTopicField(
  q: { query: string; fromDate: string; toDate: string },
  deps: OpenAlexDeps = {},
): Promise<GroupEntry[]> {
  const url = buildUrl({ query: q.query, fromDate: q.fromDate, toDate: q.toDate }, deps, {
    groupBy: "primary_topic.field.id",
  })
  const body = (await fetchOpenAlexJson(url, deps)) as OpenAlexGroupByResponse
  return mapGroupByEntries(body.group_by ?? [])
}

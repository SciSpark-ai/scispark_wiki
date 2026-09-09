import { XMLParser } from "fast-xml-parser"
import { fetchWithTimeout } from "./fetch-timeout"
import { PaperSourceError, nonEmpty, normalizeDoi, type PaperAuthor, type PaperRecord } from "./types"

// Drift-verified 2026-07-12 against info.arxiv.org/help/api/user-manual.html and a
// live call to export.arxiv.org: https works (200, correct Atom body), even though
// the manual's examples show http. Using https here since it was live-confirmed.
const ARXIV_QUERY_URL = "https://export.arxiv.org/api/query"
const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const ARRAY_TAGS = new Set(["entry", "author", "link", "category"])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
})

interface ArxivLink {
  "@_href"?: string
  "@_rel"?: string
  "@_type"?: string
  "@_title"?: string
}

interface ArxivAuthor {
  name?: string
}

interface ArxivCategory {
  "@_term"?: string
}

interface ArxivEntry {
  id?: string
  title?: string
  summary?: string
  published?: string
  updated?: string
  author?: ArxivAuthor[]
  link?: ArxivLink[]
  category?: ArxivCategory[]
  "arxiv:doi"?: string
  "arxiv:journal_ref"?: string
}

interface ArxivFeed {
  entry?: ArxivEntry[]
}

interface ArxivFeedResponse {
  feed?: ArxivFeed
}

export interface ArxivQuery {
  query: string
  limit?: number
  /**
   * Ranking preference, chosen upstream by intent extraction (not by this
   * adapter): "relevance" → arXiv's relevance ranking (omit sortBy); "date" or
   * OMITTED → newest-first (submittedDate desc). Omitted defaults to date to
   * preserve arXiv's historical newest-first behavior for server-side callers
   * (feed/spark/trending via `nodeSearchFn`, which pass no sort); the /papers
   * box passes an explicit value from the Search-Intent Skill. An empty/
   * whitespace query always browses newest-first regardless of this field.
   */
  sort?: "relevance" | "date"
  /**
   * Inclusive lower submission-date bound (YYYY-MM-DD) — SP2.1 feed
   * freshness. Composed as an AND-ed `submittedDate:[<from>0000 TO
   * 209912312359]` range clause onto BOTH plain and structured queries (a
   * structured query is parenthesized first so its own OR/ANDNOT grouping
   * survives). Omitted → no date constraint (all prior callers unchanged).
   */
  fromDate?: string
}

export interface ArxivDeps {
  fetchFn?: typeof fetch
  /** Injectable delay for retry backoff (tests pass a no-op to avoid real waits). */
  sleep?: (ms: number) => Promise<void>
  /** Total attempts including the first (default 3). */
  maxAttempts?: number
}

// arXiv's public API is politeness-rate-limited and sheds load under bursts with
// 429/503 (the Deep Spark scoop-check fans out many queries). Retry those transient
// statuses with backoff rather than failing the whole search on the first blip.
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
 * Decodes numeric character references (&#NNN; and &#xHHH;) in text.
 * Named entities are preserved by the XML parser already.
 */
function decodeNumericEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (match, code) => String.fromCharCode(parseInt(code, 16)))
}

/**
 * Collapses all runs of whitespace (including the newlines/indentation Atom
 * pads title and summary text with) into single spaces and trims the ends.
 */
function collapseWhitespace(text: string | null | undefined): string {
  if (text == null) return ""
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Extracts the arXiv identifier from an entry's <id> URL and strips the
 * trailing version suffix, e.g. "http://arxiv.org/abs/2406.01234v2" ->
 * "2406.01234", and legacy-format ids like
 * "http://arxiv.org/abs/math/0211159v1" -> "math/0211159". Returns
 * undefined for missing/empty input.
 */
function extractArxivId(id: string | null | undefined): string | undefined {
  if (id == null) return undefined
  const trimmed = id.trim()
  if (trimmed === "") return undefined
  const marker = "/abs/"
  const markerIndex = trimmed.indexOf(marker)
  const tail = markerIndex >= 0 ? trimmed.slice(markerIndex + marker.length) : trimmed
  const stripped = tail.replace(/v\d+$/, "")
  return stripped === "" ? undefined : stripped
}

function mapAuthors(authors: ArxivAuthor[] | null | undefined): PaperAuthor[] {
  if (!authors) return []
  const result: PaperAuthor[] = []
  for (const author of authors) {
    const name = collapseWhitespace(author.name)
    if (name === "") continue
    result.push({ name })
  }
  return result
}

function mapFields(categories: ArxivCategory[] | null | undefined): string[] {
  if (!categories) return []
  return categories
    .map((c) => c["@_term"])
    .filter((term): term is string => term != null && term !== "")
}

function findLink(
  links: ArxivLink[] | null | undefined,
  predicate: (link: ArxivLink) => boolean
): string | undefined {
  if (!links) return undefined
  return links.find(predicate)?.["@_href"] ?? undefined
}

function mapEntry(entry: ArxivEntry): PaperRecord {
  const published = entry.published ?? undefined
  const date = published ? published.slice(0, 10) : undefined
  const year = date ? Number(date.slice(0, 4)) : undefined

  const title = decodeNumericEntities(collapseWhitespace(entry.title))
  const abstract = entry.summary != null ? decodeNumericEntities(collapseWhitespace(entry.summary)) : undefined

  return {
    ids: {
      arxiv: extractArxivId(entry.id),
      doi: normalizeDoi(entry["arxiv:doi"]),
    },
    title,
    abstract,
    authors: mapAuthors(entry.author),
    year,
    date,
    venue: nonEmpty(entry["arxiv:journal_ref"]),
    citationCount: undefined,
    htmlUrl: nonEmpty(findLink(entry.link, (l) => l["@_rel"] === "alternate")),
    pdfUrl: nonEmpty(findLink(entry.link, (l) => l["@_title"] === "pdf" || (l["@_rel"] === "related" && l["@_type"] === "application/pdf"))),
    fields: mapFields(entry.category),
    source: "arxiv",
    publicationTypes: ["preprint"],
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}

// arXiv's native query syntax: field prefixes (the default `all:` plus
// `ti:`/`au:`/`abs:`/`cat:`/…) and UPPERCASE boolean operators (AND/OR/ANDNOT).
// The Feed strategy prompt explicitly instructs the LLM to emit these ("supports
// field prefixes and boolean operators — use them when they sharpen the query"),
// and those queries reach this adapter unchanged via `nodeSearchFn`. Such a
// query is already structured and must be handed to arXiv's parser VERBATIM —
// wrapping each whitespace token in `all:` and AND-joining would turn
// `a OR b` into `all:a AND all:OR AND all:b` (requires the literal word "OR",
// forces AND) and an `ANDNOT x` exclusion into a requirement, yielding ~0
// results. Only PLAIN free-text queries (the /papers box) get the AND-join.
const ARXIV_FIELD_PREFIX = /(?:^|[\s(])(?:all|ti|abs|au|co|jr|cat|rn|id):/i
const ARXIV_BOOLEAN = /(?:^|\s)(?:AND|OR|ANDNOT)(?:\s|$)/

function isStructuredArxivQuery(raw: string): boolean {
  return ARXIV_FIELD_PREFIX.test(raw) || ARXIV_BOOLEAN.test(raw)
}

function applySort(url: URL, sort: ArxivQuery["sort"]): void {
  // "relevance" → omit sortBy so arXiv relevance-ranks. "date" OR omitted →
  // newest-first (arXiv's historical default here — preserved so server-side
  // callers that pass no sort keep their prior behavior).
  if (sort === "relevance") return
  url.searchParams.set("sortBy", "submittedDate")
  url.searchParams.set("sortOrder", "descending")
}

/** `submittedDate` range clause for a YYYY-MM-DD lower bound. The upper bound
 * is a fixed far-future literal (arXiv's range syntax requires both ends;
 * nothing is ever submitted in the future) so this stays clock-free. */
function submittedDateClause(fromDate: string): string {
  return `submittedDate:[${fromDate.replaceAll("-", "")}0000 TO 209912312359]`
}

function buildUrl(q: ArxivQuery): string {
  const url = new URL(ARXIV_QUERY_URL)
  url.searchParams.set("max_results", String(clampLimit(q.limit)))

  const trimmed = q.query.trim()
  const terms = trimmed.split(/\s+/).filter((t) => t !== "")

  if (terms.length === 0) {
    // Browse mode (no keywords): surface the newest submissions (windowed
    // when a fromDate is given — the range clause alone is a valid query).
    url.searchParams.set("search_query", q.fromDate ? submittedDateClause(q.fromDate) : "all:")
    url.searchParams.set("sortBy", "submittedDate")
    url.searchParams.set("sortOrder", "descending")
    return url.toString()
  }

  let searchQuery: string
  if (isStructuredArxivQuery(trimmed)) {
    // Already arXiv syntax (field prefixes / boolean operators) — pass through
    // untouched so arXiv parses it as intended. A date window ANDs onto the
    // WHOLE query, parenthesized so its own OR/ANDNOT grouping survives.
    searchQuery = q.fromDate ? `(${trimmed}) AND ${submittedDateClause(q.fromDate)}` : trimmed
  } else {
    // Plain free-text keyword search. arXiv's `all:` match across space-separated
    // terms is loose (OR-ish), so the top page becomes papers that merely share a
    // common token (e.g. "attention", "decoding"), not the on-topic literature.
    // Require EVERY term via explicit AND clauses for precision. (Verified
    // 2026-07-15: an EEG auditory-attention search returned watermark/vision/
    // quantum ML papers under the old loose match.)
    const anded = terms.map((t) => `all:${t}`).join(" AND ")
    searchQuery = q.fromDate ? `${anded} AND ${submittedDateClause(q.fromDate)}` : anded
  }
  url.searchParams.set("search_query", searchQuery)

  applySort(url, q.sort)
  return url.toString()
}

/**
 * Searches arXiv's Atom-based /api/query endpoint and maps results into the
 * unified PaperRecord schema. Never logs the query text (privacy constraint).
 */
export async function searchArxiv(q: ArxivQuery, deps: ArxivDeps = {}): Promise<PaperRecord[]> {
  const fetchFn = deps.fetchFn ?? fetch
  const sleep = deps.sleep ?? realSleep
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const url = buildUrl(q)

  let lastError: PaperSourceError | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetchWithTimeout(fetchFn, url)
    } catch (err) {
      // Network error — transient, retry with backoff.
      lastError = new PaperSourceError(err instanceof Error ? err.message : "arXiv request failed")
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelayMs(attempt, null))
        continue
      }
      throw lastError
    }

    if (response.ok) {
      const xml = await response.text()
      const parsed = xmlParser.parse(xml) as ArxivFeedResponse
      const entries = parsed.feed?.entry ?? []
      return entries.map(mapEntry)
    }

    lastError = new PaperSourceError(`arXiv request failed with status ${response.status}`, response.status)
    if (RETRYABLE_STATUS(response.status) && attempt < maxAttempts - 1) {
      await sleep(backoffDelayMs(attempt, response.headers.get("retry-after")))
      continue
    }
    throw lastError
  }

  // Unreachable: the loop returns or throws on every path.
  throw lastError ?? new PaperSourceError("arXiv request failed")
}

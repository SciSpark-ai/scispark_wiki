import { PaperSourceError, normalizeDoi, type PaperAuthor, type PaperRecord } from "./types"

// Drift-verified 2026-07-12 against the live Semantic Scholar Academic Graph
// OpenAPI spec at https://api.semanticscholar.org/graph/v1/swagger.json
// (fetched successfully, HTTP 200) -- the /api-docs/graph page is a Redoc
// shell that loads that same spec client-side. A live search call
// (?query=transformer&limit=2&fields=...) returned 429 both on first try
// and again after a 30s retry (unauthenticated rate limit), so the fixture
// (s2-search.json) is constructed from the spec's documented FullPaper /
// AuthorInPaper example values rather than a live capture -- see the
// fixture's _fixtureNote for detail. Endpoint path, param names, response
// envelope (total/offset/next/data), and field names/casing below were all
// confirmed directly from the spec, not from memory.
const S2_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const SEARCH_FIELDS = [
  "title",
  "abstract",
  "authors",
  "year",
  "publicationDate",
  "venue",
  "citationCount",
  "externalIds",
  "openAccessPdf",
  "fieldsOfStudy",
]

interface S2ExternalIds {
  DOI?: string | null
  ArXiv?: string | null
  PubMed?: string | null
}

interface S2Author {
  name?: string | null
}

interface S2OpenAccessPdf {
  url?: string | null
}

interface S2Paper {
  paperId?: string | null
  title?: string | null
  abstract?: string | null
  authors?: S2Author[] | null
  year?: number | null
  publicationDate?: string | null
  venue?: string | null
  citationCount?: number | null
  externalIds?: S2ExternalIds | null
  openAccessPdf?: S2OpenAccessPdf | null
  fieldsOfStudy?: string[] | null
}

interface S2SearchResponse {
  total?: number
  offset?: number
  next?: number
  data?: S2Paper[] | null
}

export interface S2Query {
  query: string
  limit?: number
}

export interface S2Deps {
  fetchFn?: typeof fetch
  apiKey?: string
}

function mapAuthors(authors: S2Author[] | null | undefined): PaperAuthor[] {
  if (!authors) return []
  const result: PaperAuthor[] = []
  for (const author of authors) {
    if (!author.name) continue
    // S2's authorId is not an OpenAlex id, so openalexId is intentionally
    // left undefined here.
    result.push({ name: author.name, openalexId: undefined })
  }
  return result
}

function mapPaper(paper: S2Paper): PaperRecord {
  return {
    ids: {
      s2: paper.paperId ?? undefined,
      doi: normalizeDoi(paper.externalIds?.DOI),
      arxiv: paper.externalIds?.ArXiv ?? undefined,
      pmid: paper.externalIds?.PubMed ?? undefined,
    },
    title: paper.title ?? "",
    abstract: paper.abstract ?? undefined,
    authors: mapAuthors(paper.authors),
    year: paper.year ?? undefined,
    date: paper.publicationDate ?? undefined,
    venue: paper.venue ?? undefined,
    citationCount: paper.citationCount ?? undefined,
    pdfUrl: paper.openAccessPdf?.url ?? undefined,
    fields: paper.fieldsOfStudy ?? [],
    source: "s2",
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}

function buildUrl(q: S2Query): string {
  const url = new URL(S2_SEARCH_URL)
  url.searchParams.set("query", q.query)
  url.searchParams.set("limit", String(clampLimit(q.limit)))
  url.searchParams.set("fields", SEARCH_FIELDS.join(","))
  return url.toString()
}

/**
 * Searches Semantic Scholar's Academic Graph /paper/search endpoint and
 * maps results into the unified PaperRecord schema. Never logs the query
 * text (privacy constraint). Sends the x-api-key header only when an
 * apiKey is supplied; unauthenticated calls omit the header entirely
 * (works, at a lower rate limit). Non-200 responses -- including 429 --
 * are surfaced as PaperSourceError with the response status; the route
 * layer is responsible for any rate-limit-specific handling of that status.
 */
export async function searchS2(q: S2Query, deps: S2Deps = {}): Promise<PaperRecord[]> {
  const fetchFn = deps.fetchFn ?? fetch
  const url = buildUrl(q)
  const headers: Record<string, string> = {}
  if (deps.apiKey) {
    headers["x-api-key"] = deps.apiKey
  }

  let response: Response
  try {
    response = await fetchFn(url, { headers })
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "Semantic Scholar request failed")
  }

  if (!response.ok) {
    throw new PaperSourceError(`Semantic Scholar request failed with status ${response.status}`, response.status)
  }

  const body = (await response.json()) as S2SearchResponse
  const results = body.data ?? []
  return results.map(mapPaper)
}

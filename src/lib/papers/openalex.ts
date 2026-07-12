import { PaperSourceError, nonEmpty, normalizeDoi, type PaperAuthor, type PaperRecord } from "./types"

const OPENALEX_WORKS_URL = "https://api.openalex.org/works"
const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const MAX_FIELDS = 5

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
}

export interface OpenAlexQuery {
  query: string
  limit?: number
  fromDate?: string
}

export interface OpenAlexDeps {
  fetchFn?: typeof fetch
  mailto?: string
}

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

function buildUrl(q: OpenAlexQuery, deps: OpenAlexDeps): string {
  const url = new URL(OPENALEX_WORKS_URL)
  url.searchParams.set("search", q.query)
  url.searchParams.set("per_page", String(clampLimit(q.limit)))
  if (deps.mailto) {
    url.searchParams.set("mailto", deps.mailto)
  }
  if (q.fromDate) {
    url.searchParams.set("filter", `from_publication_date:${q.fromDate}`)
  }
  return url.toString()
}

/**
 * Searches OpenAlex's /works endpoint and maps results into the unified
 * PaperRecord schema. Never logs the query text (privacy constraint).
 */
export async function searchOpenAlex(q: OpenAlexQuery, deps: OpenAlexDeps = {}): Promise<PaperRecord[]> {
  const fetchFn = deps.fetchFn ?? fetch
  const url = buildUrl(q, deps)

  let response: Response
  try {
    response = await fetchFn(url)
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "OpenAlex request failed")
  }

  if (!response.ok) {
    throw new PaperSourceError(`OpenAlex request failed with status ${response.status}`, response.status)
  }

  const body = (await response.json()) as OpenAlexWorksResponse
  const results = body.results ?? []
  return results.map(mapWork)
}

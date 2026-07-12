import { XMLParser } from "fast-xml-parser"
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
}

export interface ArxivDeps {
  fetchFn?: typeof fetch
}

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
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}

function buildUrl(q: ArxivQuery): string {
  const url = new URL(ARXIV_QUERY_URL)
  url.searchParams.set("search_query", `all:${q.query}`)
  url.searchParams.set("max_results", String(clampLimit(q.limit)))
  url.searchParams.set("sortBy", "submittedDate")
  url.searchParams.set("sortOrder", "descending")
  return url.toString()
}

/**
 * Searches arXiv's Atom-based /api/query endpoint and maps results into the
 * unified PaperRecord schema. Never logs the query text (privacy constraint).
 */
export async function searchArxiv(q: ArxivQuery, deps: ArxivDeps = {}): Promise<PaperRecord[]> {
  const fetchFn = deps.fetchFn ?? fetch
  const url = buildUrl(q)

  let response: Response
  try {
    response = await fetchFn(url)
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "arXiv request failed")
  }

  if (!response.ok) {
    throw new PaperSourceError(`arXiv request failed with status ${response.status}`, response.status)
  }

  const xml = await response.text()
  const parsed = xmlParser.parse(xml) as ArxivFeedResponse
  const entries = parsed.feed?.entry ?? []
  return entries.map(mapEntry)
}

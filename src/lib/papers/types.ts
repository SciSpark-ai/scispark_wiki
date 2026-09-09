export type SourceId = "arxiv" | "openalex" | "s2" | "pubmed"

export interface PaperIds {
  doi?: string // lowercase, no https://doi.org/ prefix
  arxiv?: string // e.g. "2406.01234" (no version suffix)
  openalex?: string // e.g. "W2741809807"
  s2?: string // Semantic Scholar paperId
  pmid?: string
}

export interface PaperAuthor {
  name: string
  openalexId?: string
}

export interface PaperRecord {
  ids: PaperIds
  title: string
  abstract?: string
  authors: PaperAuthor[]
  year?: number
  date?: string // YYYY-MM-DD when known
  venue?: string
  citationCount?: number
  oaUrl?: string // best open-access landing/HTML url
  pdfUrl?: string
  htmlUrl?: string
  fields: string[] // topical field labels, source vocabulary
  source: SourceId // which adapter produced this record
  /** Verbatim publication types from the source, not AI importance labels. */
  publicationTypes?: string[]
  isRetracted?: boolean
}

export class PaperSourceError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = "PaperSourceError"
  }
}

const DOI_PREFIX_PATTERN = /^(?:https?:\/\/doi\.org\/|doi:)/i

/**
 * Filters empty strings (including whitespace-only) and nullish values to
 * undefined. Trims and returns undefined if the trimmed result is empty,
 * null, or undefined. Otherwise returns the trimmed string.
 */
export function nonEmpty(s: string | null | undefined): string | undefined {
  if (s == null) return undefined
  const trimmed = s.trim()
  if (trimmed === "") return undefined
  return trimmed
}

/**
 * Normalizes a DOI: strips leading https://doi.org/, http://doi.org/, or
 * doi: prefixes (case-insensitively), lowercases, and trims. Returns
 * undefined for empty, whitespace-only, null, or undefined input.
 */
export function normalizeDoi(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const stripped = trimmed.replace(DOI_PREFIX_PATTERN, "").trim()
  if (stripped === "") return undefined
  return stripped.toLowerCase()
}

/**
 * Stable dedupe key for a paper record. Precedence: doi > arxiv > pmid > s2
 * > openalex > lowercased/trimmed title. The key is prefixed with the id
 * kind so different id spaces can never collide.
 */
export function paperKey(p: PaperRecord): string {
  const { ids } = p
  if (ids.doi) return `doi:${normalizeDoi(ids.doi) ?? ids.doi.trim().toLowerCase()}`
  if (ids.arxiv) return `arxiv:${ids.arxiv.trim().toLowerCase()}`
  if (ids.pmid) return `pmid:${ids.pmid.trim().toLowerCase()}`
  if (ids.s2) return `s2:${ids.s2.trim().toLowerCase()}`
  if (ids.openalex) return `openalex:${ids.openalex.trim().toLowerCase()}`
  return `title:${p.title.trim().toLowerCase()}`
}

function preferDefined<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b
}

function longerString(a: string | undefined, b: string | undefined): string | undefined {
  if (a == null) return b
  if (b == null) return a
  return a.length >= b.length ? a : b
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}

function unionFields(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const field of [...a, ...b]) {
    if (!seen.has(field)) {
      seen.add(field)
      result.push(field)
    }
  }
  return result
}

/**
 * Merges two records believed to be the same paper from different sources.
 * ids are unioned (a's value wins on conflict); scalar fields prefer a
 * defined value over undefined (a wins if both are defined); abstract is
 * the longer of the two; citationCount is the max (undefined-safe); fields
 * are a deduped union preserving order; authors are whichever list is
 * longer; source is always a's.
 */
export function mergeRecords(a: PaperRecord, b: PaperRecord): PaperRecord {
  return {
    ids: { ...b.ids, ...a.ids },
    title: preferDefined(a.title, b.title) as string,
    abstract: longerString(a.abstract, b.abstract),
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    year: preferDefined(a.year, b.year),
    date: preferDefined(a.date, b.date),
    venue: preferDefined(a.venue, b.venue),
    citationCount: maxDefined(a.citationCount, b.citationCount),
    oaUrl: preferDefined(a.oaUrl, b.oaUrl),
    pdfUrl: preferDefined(a.pdfUrl, b.pdfUrl),
    htmlUrl: preferDefined(a.htmlUrl, b.htmlUrl),
    fields: unionFields(a.fields, b.fields),
    source: a.source,
    publicationTypes: [...new Set([...(a.publicationTypes ?? []), ...(b.publicationTypes ?? [])])],
    isRetracted: a.isRetracted || b.isRetracted || undefined,
  }
}

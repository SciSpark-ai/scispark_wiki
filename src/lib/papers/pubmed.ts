import { XMLParser } from "fast-xml-parser"
import { PaperSourceError, nonEmpty, normalizeDoi, type PaperAuthor, type PaperRecord } from "./types"

// Drift-verified 2026-07-12 against the live E-utilities "in-depth" manual
// (https://www.ncbi.nlm.nih.gov/books/NBK25499/) plus live esearch/efetch
// calls against eutils.ncbi.nlm.nih.gov (both HTTP 200). See
// .superpowers/sdd/m3-task-6-report.md for the full drift-guard writeup.
const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const MAX_FIELDS = 5
// isArray forces these five tags to arrays even when only one element is
// present, per the task contract -- this lets mapping code treat
// AbstractText/Author/ArticleId/MeshHeading/PubmedArticle uniformly instead
// of branching on "was there exactly one".
const ARRAY_TAGS = new Set(["PubmedArticle", "Author", "AbstractText", "ArticleId", "MeshHeading"])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
})

const MONTH_NAMES: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
}

// fast-xml-parser's default parseTagValue coerces purely-numeric text nodes
// (PMID, ArticleId text, Year/Day) to JS numbers, while month abbreviations
// like "Jul" stay strings -- XmlText normalizes both shapes back to string.
type XmlText = string | number

interface XmlTextNode {
  "#text"?: XmlText
  [key: string]: unknown
}

type MaybeTextNode = XmlText | XmlTextNode | undefined | null

interface PubmedDate {
  Year?: XmlText
  Month?: XmlText
  Day?: XmlText
  MedlineDate?: XmlText
}

interface PubmedArticleId extends XmlTextNode {
  "@_IdType"?: string
}

interface PubmedAuthor {
  LastName?: XmlText
  ForeName?: XmlText
  CollectiveName?: XmlText
}

interface PubmedAbstractText extends XmlTextNode {
  "@_Label"?: string
}

interface PubmedMeshDescriptor extends XmlTextNode {
  "@_MajorTopicYN"?: string
}

interface PubmedMeshHeading {
  DescriptorName?: PubmedMeshDescriptor
}

interface PubmedJournal {
  Title?: XmlText
  JournalIssue?: {
    PubDate?: PubmedDate
  }
}

interface PubmedArticleBody {
  ArticleTitle?: MaybeTextNode
  Abstract?: { AbstractText?: (XmlText | PubmedAbstractText)[] }
  AuthorList?: { Author?: PubmedAuthor[] }
  Journal?: PubmedJournal
  ArticleDate?: PubmedDate
}

interface PubmedMedlineCitation {
  PMID?: MaybeTextNode
  Article?: PubmedArticleBody
  MeshHeadingList?: { MeshHeading?: PubmedMeshHeading[] }
}

interface PubmedArticleEntry {
  MedlineCitation?: PubmedMedlineCitation
  PubmedData?: { ArticleIdList?: { ArticleId?: PubmedArticleId[] } }
}

interface PubmedArticleSetResponse {
  PubmedArticleSet?: { PubmedArticle?: PubmedArticleEntry[] }
}

interface EsearchResponse {
  esearchresult?: { idlist?: string[] }
}

export interface PubmedQuery {
  query: string
  limit?: number
}

export interface PubmedDeps {
  fetchFn?: typeof fetch
  apiKey?: string
}

/**
 * Extracts the plain-text value of a node that may be a bare XML text node
 * (string or number, thanks to fast-xml-parser's numeric coercion) or an
 * object carrying attributes alongside a "#text" child. Returns undefined
 * for anything else (missing, or an object with no "#text").
 */
function textOf(node: MaybeTextNode): string | undefined {
  if (node == null) return undefined
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (typeof node === "object" && "#text" in node && node["#text"] != null) {
    return String(node["#text"])
  }
  return undefined
}

/**
 * Flattens a possibly mixed-content XML node (e.g. an ArticleTitle with
 * nested <i>/<sub> markup) down to plain text. fast-xml-parser (without
 * preserveOrder) collapses interleaved text runs into a single "#text" key
 * and lists child elements as sibling keys, losing the original reading
 * order -- this walks every non-attribute value (text first, then child
 * elements in their parsed key order) and joins them with a space, which
 * recovers all the text even though exact interleaving order isn't
 * guaranteed to match the source markup.
 */
function flattenText(node: unknown): string {
  if (node == null) return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join(" ")
  if (typeof node === "object") {
    const parts: string[] = []
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith("@_")) continue
      const text = flattenText(value)
      if (text !== "") parts.push(text)
    }
    return parts.join(" ")
  }
  return ""
}

/**
 * Collapses whitespace runs (including newlines) to single spaces and trims.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function extractPmid(pmid: MaybeTextNode): string | undefined {
  return nonEmpty(textOf(pmid))
}

function extractDoi(articleIds: PubmedArticleId[] | null | undefined): string | undefined {
  if (!articleIds) return undefined
  const doiEntry = articleIds.find((entry) => entry["@_IdType"] === "doi")
  return normalizeDoi(textOf(doiEntry))
}

function mapAuthors(authors: PubmedAuthor[] | null | undefined): PaperAuthor[] {
  if (!authors) return []
  const result: PaperAuthor[] = []
  for (const author of authors) {
    const foreName = nonEmpty(textOf(author.ForeName))
    const lastName = nonEmpty(textOf(author.LastName))
    const personalName = [foreName, lastName].filter((part) => part != null).join(" ")
    const name = nonEmpty(personalName) ?? nonEmpty(textOf(author.CollectiveName))
    if (name == null) continue
    result.push({ name })
  }
  return result
}

/**
 * Joins AbstractText sections into a single abstract string, separated by
 * blank lines, prefixing each section's Label (e.g. "BACKGROUND: ...") when
 * present. AbstractText is forced to an array by ARRAY_TAGS, so a
 * single-section abstract still goes through this same path.
 */
function mapAbstract(sections: (XmlText | PubmedAbstractText)[] | null | undefined): string | undefined {
  if (!sections || sections.length === 0) return undefined
  const parts: string[] = []
  for (const section of sections) {
    const text = textOf(section)
    if (text == null || text.trim() === "") continue
    const label = typeof section === "object" ? nonEmpty(section["@_Label"]) : undefined
    parts.push(label ? `${label}: ${text}` : text)
  }
  return nonEmpty(parts.join("\n\n"))
}

/**
 * Builds a "YYYY-MM-DD" (or "YYYY-MM" / "YYYY" when day/month are missing)
 * date string from a PubDate/ArticleDate-shaped node. Month may be a
 * zero-padded numeric string/number (ArticleDate) or a three-letter
 * abbreviation like "Jul" (PubDate) -- both are normalized to "MM".
 */
function formatDate(year: string, month?: string, day?: string): string {
  const parts = [year.padStart(4, "0")]
  if (month == null) return parts.join("-")
  const numericMonth = /^\d+$/.test(month) ? month.padStart(2, "0") : MONTH_NAMES[month.slice(0, 3).toLowerCase()]
  if (numericMonth == null) return parts.join("-")
  parts.push(numericMonth)
  if (day == null) return parts.join("-")
  parts.push(day.padStart(2, "0"))
  return parts.join("-")
}

/**
 * Extracts {year, date} from a PubDate/ArticleDate-shaped node. Handles the
 * MedlineDate fallback (a free-text season/range string like "2024
 * Jan-Feb") by pulling just the leading 4-digit year out of it -- MedlineDate
 * only ever yields a year, never a full date.
 */
function mapDateParts(pubDate: PubmedDate | null | undefined): { year: number | undefined; date: string | undefined } {
  if (!pubDate) return { year: undefined, date: undefined }
  const medlineDate = textOf(pubDate.MedlineDate)
  if (medlineDate != null) {
    const match = medlineDate.match(/\d{4}/)
    const year = match ? Number(match[0]) : undefined
    return { year, date: undefined }
  }
  const yearText = textOf(pubDate.Year)
  if (yearText == null) return { year: undefined, date: undefined }
  const monthText = textOf(pubDate.Month)
  const dayText = textOf(pubDate.Day)
  const date = formatDate(yearText, monthText, dayText)
  return { year: Number(yearText), date }
}

function mapFields(headings: PubmedMeshHeading[] | null | undefined): string[] {
  if (!headings) return []
  const descriptors = headings
    .map((h) => h.DescriptorName)
    .filter((d): d is PubmedMeshDescriptor => d != null)
    .map((d) => ({ name: nonEmpty(textOf(d)), major: d["@_MajorTopicYN"] === "Y" }))
    .filter((d): d is { name: string; major: boolean } => d.name != null)

  const major = descriptors.filter((d) => d.major)
  const minor = descriptors.filter((d) => !d.major)
  return [...major, ...minor].slice(0, MAX_FIELDS).map((d) => d.name)
}

function mapArticle(entry: PubmedArticleEntry): PaperRecord {
  const citation = entry.MedlineCitation
  const article = citation?.Article

  const titleText = flattenText(article?.ArticleTitle)
  const title = collapseWhitespace(titleText)

  // ArticleDate is preferred over the (coarser, journal-issue-level) PubDate
  // when both are present, per the task contract.
  const articleDateParts = mapDateParts(article?.ArticleDate)
  const pubDateParts = mapDateParts(article?.Journal?.JournalIssue?.PubDate)
  const dateParts = article?.ArticleDate != null ? articleDateParts : pubDateParts

  return {
    ids: {
      pmid: extractPmid(citation?.PMID),
      doi: extractDoi(entry.PubmedData?.ArticleIdList?.ArticleId),
    },
    title,
    abstract: mapAbstract(article?.Abstract?.AbstractText),
    authors: mapAuthors(article?.AuthorList?.Author),
    year: dateParts.year,
    date: dateParts.date,
    venue: nonEmpty(textOf(article?.Journal?.Title)),
    citationCount: undefined,
    fields: mapFields(citation?.MeshHeadingList?.MeshHeading),
    source: "pubmed",
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}

function buildEsearchUrl(q: PubmedQuery, apiKey: string | undefined): string {
  const url = new URL(ESEARCH_URL)
  url.searchParams.set("db", "pubmed")
  url.searchParams.set("term", q.query)
  url.searchParams.set("retmax", String(clampLimit(q.limit)))
  url.searchParams.set("retmode", "json")
  url.searchParams.set("sort", "pub_date")
  if (apiKey) url.searchParams.set("api_key", apiKey)
  return url.toString()
}

function buildEfetchUrl(pmids: string[], apiKey: string | undefined): string {
  const url = new URL(EFETCH_URL)
  url.searchParams.set("db", "pubmed")
  url.searchParams.set("id", pmids.join(","))
  url.searchParams.set("retmode", "xml")
  if (apiKey) url.searchParams.set("api_key", apiKey)
  return url.toString()
}

/**
 * Searches PubMed via the two-step E-utilities flow (esearch for pmids,
 * then efetch for full records) and maps results into the unified
 * PaperRecord schema. Never logs the query text (privacy constraint). When
 * esearch returns no pmids, efetch is skipped entirely and [] is returned.
 */
export async function searchPubmed(q: PubmedQuery, deps: PubmedDeps = {}): Promise<PaperRecord[]> {
  const fetchFn = deps.fetchFn ?? fetch

  let esearchResponse: Response
  try {
    esearchResponse = await fetchFn(buildEsearchUrl(q, deps.apiKey))
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "PubMed esearch request failed")
  }
  if (!esearchResponse.ok) {
    throw new PaperSourceError(`PubMed esearch request failed with status ${esearchResponse.status}`, esearchResponse.status)
  }
  const esearchBody = (await esearchResponse.json()) as EsearchResponse
  const pmids = esearchBody.esearchresult?.idlist ?? []
  if (pmids.length === 0) return []

  let efetchResponse: Response
  try {
    efetchResponse = await fetchFn(buildEfetchUrl(pmids, deps.apiKey))
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "PubMed efetch request failed")
  }
  if (!efetchResponse.ok) {
    throw new PaperSourceError(`PubMed efetch request failed with status ${efetchResponse.status}`, efetchResponse.status)
  }
  const xml = await efetchResponse.text()
  const parsed = xmlParser.parse(xml) as PubmedArticleSetResponse
  const articles = parsed.PubmedArticleSet?.PubmedArticle ?? []
  return articles.map(mapArticle)
}

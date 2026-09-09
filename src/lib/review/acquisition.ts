import { XMLParser } from "fast-xml-parser"
import { normalizeDoi, type PaperRecord } from "../papers/types"
import { serverRelayFetch } from "../server/relay-fetch"
import { extractReadableText, relayUrl } from "../wiki/acquire"
import { hashReviewData } from "./budget"
import type { EvidenceRecord } from "./contracts"
import { contextOverlap } from "./context"
import { extractReviewPdf } from "./pdf"

const MAX_BYTES = 5_000_000
async function boundedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error("Article exceeds reading byte limit")
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks)
}
function titleMatches(title: string, text: string) {
  const terms = new Set(title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  return terms.size > 0 && contextOverlap(title, text.slice(0, 8000)) >= Math.min(4, terms.size)
}
function hasBody(text: string) {
  return text.length >= 500 && /\b(methods|methodology|materials|experiments|analysis|framework|model)\b/i.test(text)
    && /\b(results|discussion|conclusions?)\b/i.test(text)
}
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false })
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]

/** Bounded repository fallback using exact DOI identity, never a fuzzy result or
 * arbitrary publisher redirect. The relay permits only these EBI API paths. */
async function repositoryCandidate(paper: PaperRecord, fetchFn: typeof fetch): Promise<string | null> {
  const doi = normalizeDoi(paper.ids.doi)
  if (!doi || !/^10\.\d{4,9}\/[^\s"<>]{1,200}$/.test(doi)) return null
  const query = new URLSearchParams({ query: `DOI:"${doi}" AND OPEN_ACCESS:Y`, format: "xml", pageSize: "3" })
  const response = await fetchFn(relayUrl("", `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${query}`))
  if (!response.ok) return null
  const xml = Buffer.from(await boundedBytes(response)).toString("utf8")
  const records = array(parser.parse(xml)?.responseWrapper?.resultList?.result) as Array<{ doi?: string; pmcid?: string; isOpenAccess?: string }>
  const match = records.find((r) => normalizeDoi(r.doi) === doi && r.isOpenAccess === "Y" && /^PMC\d+$/.test(r.pmcid ?? ""))
  return match ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${match.pmcid}/fullTextXML` : null
}

/** Every network candidate uses the existing relay. Missing/blocked/full-text
 * parse failures are distinguished; unsupported hosts are not called paywalls. */
export async function acquireReviewEvidence(paper: PaperRecord, id: string,
  fetchFn: typeof fetch = serverRelayFetch("server-literature-review", { maxBytes: MAX_BYTES }), extractPdf = extractReviewPdf): Promise<EvidenceRecord | null> {
  let text = paper.abstract?.trim() ?? ""
  let access: EvidenceRecord["access"] = "abstract"
  let locator = "Abstract"
  const notes: string[] = []
  const candidates = [...new Set([
    ...(paper.ids.arxiv ? [`https://arxiv.org/html/${paper.ids.arxiv}`] : []),
    ...[paper.htmlUrl, paper.oaUrl, paper.pdfUrl].filter((u): u is string => Boolean(u)),
  ])].slice(0, 3)
  let repositoryTried = false
  for (let index = 0; index <= candidates.length; index++) {
    if (index === candidates.length) {
      if (repositoryTried) break
      repositoryTried = true
      try {
        const url = await repositoryCandidate(paper, fetchFn)
        if (url && !candidates.includes(url)) candidates.push(url)
        else { notes.push("No matching open-access repository text found"); break }
      } catch { notes.push("Open-access repository lookup failed; abstract retained"); break }
    }
    const url = candidates[index]
    try {
      const response = await fetchFn(relayUrl("", url))
      if (!response.ok) {
        let localRejection = false
        if (response.status === 403 && response.headers.get("content-type")?.includes("json")) {
          try { localRejection = (await response.json()).error === "url not allowed" } catch {}
        }
        notes.push(localRejection ? "Full-text URL blocked by the app relay policy; publisher access was not tested"
          : response.status === 401 || response.status === 403 ? "Full-text server denied access" : `Full-text request returned ${response.status}`)
        continue
      }
      const type = response.headers.get("content-type")?.toLowerCase() ?? ""
      const bytes = await boundedBytes(response)
      let readable = "", validIdentity = false
      if (type.includes("pdf")) {
        const extracted = await extractPdf(bytes)
        readable = extracted.text; validIdentity = titleMatches(paper.title, readable)
        notes.push(`Public PDF: read ${extracted.pagesRead} of ${extracted.totalPages} pages.`)
        if (extracted.shortened) notes.push("PDF shortened at the reading limit; later content was not read")
      } else if (type.includes("xml") && !type.includes("xhtml")) {
        const xml = Buffer.from(bytes).toString("utf8")
        const meta = parser.parse(xml)?.article?.front?.["article-meta"]
        const ids = array(meta?.["article-id"]) as Array<{ "@_pub-id-type"?: string; "#text"?: string }>
        const doi = ids.find((item) => item["@_pub-id-type"] === "doi")?.["#text"]
        const title = extractReadableText(xml.match(/<article-title\b[^>]*>[\s\S]*?<\/article-title>/i)?.[0] ?? "")
        const body = xml.match(/<body\b[^>]*>[\s\S]*?<\/body>/i)?.[0] ?? ""
        readable = `${title}\n\n${extractReadableText(body)}`
        validIdentity = Boolean(body) && titleMatches(paper.title, title) && (!paper.ids.doi || normalizeDoi(doi) === normalizeDoi(paper.ids.doi))
      } else if (type.includes("html")) {
        const html = Buffer.from(bytes).toString("utf8")
        const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0]
        readable = article ? extractReadableText(article) : ""; validIdentity = titleMatches(paper.title, readable)
      } else { notes.push("Unsupported full-text format; abstract retained"); continue }
      if (!validIdentity || !hasBody(readable)) { notes.push("Could not verify article identity and body; abstract retained"); continue }
      text = readable.slice(0, 45_000); access = "full-text"; locator = url
      if (readable.length > text.length) notes.push("Article text shortened to the first 45,000 characters; later sections were not read")
      break
    } catch { notes.push("Full-text request or bounded parsing failed; abstract retained") }
  }
  if (text.length < 30) return null
  return { id, title: paper.title, paper, text: text.slice(0, 45_000), access, locator,
    hash: hashReviewData(text.slice(0, 45_000)), retrievedAt: new Date().toISOString(), notes: [...new Set(notes)] }
}

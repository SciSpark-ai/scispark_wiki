import { normalizeDoi, type PaperRecord } from "./types"

function encodedPath(value: string): string {
  return value
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Returns the most authoritative external landing page available for a
 * paper. Stable scholarly identifiers come first so a temporary or blocked
 * PDF URL does not replace the canonical publisher/source record. Arbitrary
 * record URLs are accepted only when they use HTTP(S).
 */
export function originalPaperUrl(paper: PaperRecord): string | undefined {
  const doi = normalizeDoi(paper.ids.doi)
  if (doi) return `https://doi.org/${encodedPath(doi)}`

  const arxiv = paper.ids.arxiv?.trim()
  if (arxiv) return `https://arxiv.org/abs/${encodedPath(arxiv)}`

  const pmid = paper.ids.pmid?.trim()
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodedPath(pmid)}/`

  const recordUrl = safeHttpUrl(paper.htmlUrl) ?? safeHttpUrl(paper.oaUrl) ?? safeHttpUrl(paper.pdfUrl)
  if (recordUrl) return recordUrl

  const openalex = paper.ids.openalex?.trim()
  if (openalex) return `https://openalex.org/${encodedPath(openalex)}`

  const semanticScholar = paper.ids.s2?.trim()
  if (semanticScholar) return `https://www.semanticscholar.org/paper/${encodedPath(semanticScholar)}`

  return undefined
}

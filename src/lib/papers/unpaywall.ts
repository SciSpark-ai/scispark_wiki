import { PaperSourceError, nonEmpty } from "./types"

const UNPAYWALL_BASE_URL = "https://api.unpaywall.org/v2"
const NOT_FOUND_STATUS = 404

interface UnpaywallOaLocation {
  url_for_landing_page?: string | null
  url_for_pdf?: string | null
}

interface UnpaywallResponse {
  is_oa?: boolean | null
  best_oa_location?: UnpaywallOaLocation | null
}

export interface UnpaywallDeps {
  fetchFn?: typeof fetch
  email: string
}

export interface ResolveOaResult {
  oaUrl?: string
  pdfUrl?: string
  isOa: boolean
}

/**
 * Encodes a DOI for use as an Unpaywall path segment. DOIs always contain a
 * literal "/" separating prefix and suffix (e.g. "10.1038/nature12373"),
 * which must stay a path separator - only the characters within each
 * segment are percent-encoded, never the "/" itself.
 */
function encodeDoiPath(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/")
}

function buildUrl(doi: string, email: string): string {
  const url = new URL(`${UNPAYWALL_BASE_URL}/${encodeDoiPath(doi)}`)
  url.searchParams.set("email", email)
  return url.toString()
}

/**
 * Resolves the best open-access location for a DOI via the Unpaywall API.
 * A 404 (unknown DOI) is a normal, non-error answer and maps to
 * `{ isOa: false }`. Any other non-200 status or network failure surfaces
 * as a `PaperSourceError`.
 */
export async function resolveOa(doi: string, deps: UnpaywallDeps): Promise<ResolveOaResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const url = buildUrl(doi, deps.email)

  let response: Response
  try {
    response = await fetchFn(url)
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "Unpaywall request failed")
  }

  if (response.status === NOT_FOUND_STATUS) {
    return { isOa: false }
  }

  if (!response.ok) {
    throw new PaperSourceError(`Unpaywall request failed with status ${response.status}`, response.status)
  }

  const body = (await response.json()) as UnpaywallResponse
  const location = body.best_oa_location
  return {
    oaUrl: nonEmpty(location?.url_for_landing_page),
    pdfUrl: nonEmpty(location?.url_for_pdf),
    isOa: body.is_oa === true,
  }
}

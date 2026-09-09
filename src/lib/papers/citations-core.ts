import { TtlCache } from "../server/ttl-cache"
import { TokenBucket } from "../server/rate-limit"
import { PaperSourceError, normalizeDoi, type PaperIds } from "./types"
import { sourceFetch, withSourceDeadline } from "./source-requests"

// S2 Graph API /paper/{id}/references — same host/auth/timeout discipline as
// the existing searchS2 adapter (src/lib/papers/s2.ts), reused here rather
// than re-derived. `{id}` accepts S2's external-id-lookup syntax (e.g.
// "DOI:10.1038/..." or "ARXIV:1706.03762"), so no separate S2 paperId lookup
// is needed before fetching references.
const S2_REFERENCES_BASE = "https://api.semanticscholar.org/graph/v1/paper"
const REFERENCES_FIELDS = "externalIds,title"
const REFERENCES_LIMIT = 500

export interface CitationRef {
  ids: PaperIds
  title: string
}

interface S2ExternalIds {
  DOI?: string | null
  ArXiv?: string | null
  PubMed?: string | null
  CorpusId?: number | string | null
}

interface S2RefPaper {
  externalIds?: S2ExternalIds | null
  title?: string | null
}

interface S2ReferenceEntry {
  citedPaper?: S2RefPaper | null
}

interface S2ReferencesResponse {
  data?: S2ReferenceEntry[] | null
}

/**
 * Maps S2's externalIds onto our PaperIds. DOI/ArXiv/PubMed map 1:1 (DOI
 * normalized the same way searchS2 normalizes it); CorpusId — S2's own
 * numeric paper identifier, distinct from `paperId` — maps into our `s2`
 * slot per the M8 brief, since it's the only S2-specific identifier this
 * endpoint returns.
 */
function mapExternalIds(ids: S2ExternalIds | null | undefined): PaperIds {
  if (!ids) return {}
  const result: PaperIds = {}
  const doi = normalizeDoi(ids.DOI)
  if (doi) result.doi = doi
  if (ids.ArXiv) result.arxiv = ids.ArXiv
  if (ids.PubMed) result.pmid = ids.PubMed
  if (ids.CorpusId !== undefined && ids.CorpusId !== null && ids.CorpusId !== "") {
    result.s2 = String(ids.CorpusId)
  }
  return result
}

function buildReferencesUrl(externalId: string): string {
  return `${S2_REFERENCES_BASE}/${encodeURIComponent(externalId)}/references?fields=${REFERENCES_FIELDS}&limit=${REFERENCES_LIMIT}`
}

/**
 * Fetches and normalizes the reference list for one paper (identified by an
 * S2 external-id string, e.g. "DOI:..."/"ARXIV:...") from the Semantic
 * Scholar Graph API. Never logs `externalId` (privacy constraint — mirrors
 * searchS2/PaperSourceError not embedding query text either).
 *
 * A 404 (S2 has no record of this paper, or it has no references) resolves
 * to `[]` rather than throwing — the caller (`handleCitations`) treats that
 * as a normal empty result, not an upstream error. Any other non-2xx status,
 * or a network-level throw, is surfaced as `PaperSourceError`.
 */
export async function fetchReferences(
  externalId: string,
  opts: { fetchFn?: typeof fetch; apiKey?: string } = {},
): Promise<CitationRef[]> {
  return withSourceDeadline(undefined, (signal) => fetchReferencesWithSignal(externalId, { ...opts, signal }))
}

async function fetchReferencesWithSignal(
  externalId: string,
  opts: { fetchFn?: typeof fetch; apiKey?: string; signal: AbortSignal },
): Promise<CitationRef[]> {
  const fetchFn = opts.fetchFn ?? sourceFetch("s2")
  const headers: Record<string, string> = {}
  if (opts.apiKey) {
    headers["x-api-key"] = opts.apiKey
  }

  let response: Response
  try {
    response = await fetchFn(buildReferencesUrl(externalId), { headers, signal: opts.signal, redirect: "error" })
  } catch (err) {
    throw new PaperSourceError(err instanceof Error ? err.message : "Semantic Scholar references request failed")
  }

  if (response.status === 404) return []

  if (!response.ok) {
    throw new PaperSourceError(
      `Semantic Scholar references request failed with status ${response.status}`,
      response.status,
    )
  }

  const body = (await response.json()) as S2ReferencesResponse
  const entries = body.data ?? []
  const refs: CitationRef[] = []
  for (const entry of entries) {
    const cited = entry.citedPaper
    if (!cited) continue
    refs.push({ ids: mapExternalIds(cited.externalIds), title: cited.title ?? "" })
  }
  return refs
}

// ---------------------------------------------------------------------------
// handleCitations — GET /api/citations?id=<externalId> core handler.
// Framework-free (route.ts is a thin NextRequest/NextResponse wrapper), same
// shape as handleSearch/handleResolve: validate -> cache hit -> single-flight
// -> rate limit -> upstream call. Mirrors handleSearch's TtlCache +
// TokenBucket + single-flight discipline (search-core.ts) rather than
// handleResolve's simpler single-bucket shape, since citations sees the same
// "many identical concurrent requests for one id" pattern as search.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const CACHE_MAX_ENTRIES = 2000
const CITATIONS_CACHE_CONTROL = "public, s-maxage=86400"

const BUCKET_CAPACITY = 5
const BUCKET_REFILL_PER_SEC = 1
const BUCKET_KEY = "citations"
const BUCKET_RETRY_AFTER_SECONDS = "2"
const UPSTREAM_RATE_LIMIT_RETRY_AFTER_SECONDS = "5"

// "DOI:<non-empty tail>" or "ARXIV:<non-empty tail>", case-sensitive on the
// prefix (matches the brief's id shape exactly; S2 itself accepts lowercase
// prefixes too, but we only ever emit uppercase from loadCitationRefs, so
// keeping validation strict here catches typos early rather than silently
// passing malformed ids upstream).
const ID_PATTERN = /^(?:DOI|ARXIV):(.+)$/

function isValidExternalId(id: string): boolean {
  const match = ID_PATTERN.exec(id)
  return match !== null && match[1].trim().length > 0
}

const defaultCache = new TtlCache<CitationRef[]>({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES })
const defaultBucket = new TokenBucket({ capacity: BUCKET_CAPACITY, refillPerSec: BUCKET_REFILL_PER_SEC })

// Module-level single-flight registry, same rationale as search-core.ts's
// `inFlight`: concurrent identical requests share one upstream call, and
// entries are always removed once their shared promise settles.
const inFlight = new Map<string, Promise<CitationRef[]>>()

export interface HandleCitationsDeps {
  fetchFn?: typeof fetch
  apiKey?: string
  cache?: TtlCache<CitationRef[]>
  bucket?: TokenBucket
}

export interface HandleCitationsResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/**
 * Core handler for GET /api/citations?id=<externalId>. Framework-free so it
 * can be unit tested directly; `route.ts` is a thin wrapper that wires in
 * NextRequest/NextResponse and process.env.S2_API_KEY.
 *
 * Order of checks: missing/malformed id (400) -> cache hit (short-circuits,
 * no upstream call, no bucket touch) -> single-flight dedup -> rate limit
 * (429) when starting new upstream work -> upstream call (success 200 /
 * upstream 429 passthrough / other error 502). Only successful (200) results
 * are cached. Error bodies never echo `id` or upstream messages.
 */
export async function handleCitations(
  req: { id: string | null },
  deps: HandleCitationsDeps = {},
): Promise<HandleCitationsResponse> {
  const id = req.id
  if (!id || !isValidExternalId(id)) {
    return { status: 400, body: { error: "invalid id" } }
  }

  const cacheKey = JSON.stringify(id)
  const cache = deps.cache ?? defaultCache
  const cached = cache.get(cacheKey)
  if (cached) {
    return { status: 200, body: { references: cached }, headers: { "Cache-Control": CITATIONS_CACHE_CONTROL } }
  }

  let inflight = inFlight.get(cacheKey)
  const isOwner = !inflight
  if (!inflight) {
    const bucket = deps.bucket ?? defaultBucket
    if (!bucket.take(BUCKET_KEY)) {
      return { status: 429, body: { error: "rate limited" }, headers: { "Retry-After": BUCKET_RETRY_AFTER_SECONDS } }
    }

    inflight = fetchReferences(id, { fetchFn: deps.fetchFn, apiKey: deps.apiKey })
    inFlight.set(cacheKey, inflight)
    const settled = inflight
    // .finally's derived promise re-throws on rejection; since nothing else
    // awaits it, an unhandled one would surface as an unhandled rejection
    // even though `inflight` itself is properly awaited (and its rejection
    // handled) below. Swallow it here - it's purely for cleanup.
    inflight
      .finally(() => {
        if (inFlight.get(cacheKey) === settled) inFlight.delete(cacheKey)
      })
      .catch(() => {})
  }

  try {
    const result = await inflight
    if (isOwner) {
      cache.set(cacheKey, result)
    }
    return { status: 200, body: { references: result }, headers: { "Cache-Control": CITATIONS_CACHE_CONTROL } }
  } catch (err) {
    if (err instanceof PaperSourceError && err.status === 429) {
      return {
        status: 429,
        body: { error: "rate limited" },
        headers: { "Retry-After": UPSTREAM_RATE_LIMIT_RETRY_AFTER_SECONDS },
      }
    }
    return { status: 502, body: { error: "upstream error" } }
  }
}

import { TtlCache } from "../server/ttl-cache"
import { TokenBucket } from "../server/rate-limit"
import { PaperSourceError, nonEmpty, type PaperRecord } from "./types"
import { searchArxiv } from "./arxiv"
import { searchOpenAlex } from "./openalex"
import { searchS2 } from "./s2"
import { searchPubmed } from "./pubmed"

export type AdapterMap = {
  arxiv: typeof searchArxiv
  openalex: typeof searchOpenAlex
  s2: typeof searchS2
  pubmed: typeof searchPubmed
}

type SourceKey = keyof AdapterMap

const SOURCE_KEYS: SourceKey[] = ["arxiv", "openalex", "s2", "pubmed"]

const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

const CACHE_TTL_MS = 600_000
const CACHE_MAX_ENTRIES = 2000
const SEARCH_CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=3600"

const BUCKET_RETRY_AFTER_SECONDS = "2"
const UPSTREAM_RATE_LIMIT_RETRY_AFTER_SECONDS = "5"

const MAX_QUERY_LENGTH = 512

const defaultCache = new TtlCache<PaperRecord[]>({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES })

const defaultBuckets: Record<SourceKey, TokenBucket> = {
  arxiv: new TokenBucket({ capacity: 3, refillPerSec: 1 }),
  openalex: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
  s2: new TokenBucket({ capacity: 5, refillPerSec: 1 }),
  pubmed: new TokenBucket({ capacity: 5, refillPerSec: 3 }),
}

const defaultAdapters: AdapterMap = {
  arxiv: searchArxiv,
  openalex: searchOpenAlex,
  s2: searchS2,
  pubmed: searchPubmed,
}

// Module-level single-flight registry: concurrent identical requests
// (same cache key) share one upstream call. Not injectable - the injected
// cache/bucket seams already make tests deterministic, and this map's
// entries are always removed as soon as the shared promise settles, so it
// never leaks state across calls or test cases.
const inFlight = new Map<string, Promise<PaperRecord[]>>()

export interface HandleSearchDeps {
  fetchFn?: typeof fetch
  env?: Record<string, string | undefined>
  cache?: TtlCache<PaperRecord[]>
  buckets?: Record<string, TokenBucket>
  adapters?: Partial<AdapterMap>
}

export interface HandleSearchResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface HandleSearchParams {
  q?: string | null
  limit?: string | null
  from?: string | null
}

function isSourceKey(source: string): source is SourceKey {
  return (SOURCE_KEYS as string[]).includes(source)
}

/**
 * Parses and clamps a raw limit string to [MIN_LIMIT, MAX_LIMIT]. Missing,
 * blank, or unparseable input defaults to DEFAULT_LIMIT; any parseable
 * integer (including 0 or negative) is clamped into range rather than
 * treated as invalid.
 */
function parseLimit(raw: string | null | undefined): number {
  const trimmed = nonEmpty(raw)
  if (trimmed === undefined) return DEFAULT_LIMIT
  const n = parseInt(trimmed, 10)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n))
}

/**
 * Invokes the adapter for `source`, wiring per-adapter env-derived deps
 * (openalex mailto, s2/pubmed api keys) and `from` (openalex only, as
 * fromDate). Kept as an explicit switch rather than a generic dispatch so
 * each adapter's distinct Query/Deps shape stays type-checked.
 */
function callAdapter(
  source: SourceKey,
  adapters: AdapterMap,
  q: string,
  limit: number,
  from: string | undefined,
  fetchFn: typeof fetch | undefined,
  env: Record<string, string | undefined> | undefined,
): Promise<PaperRecord[]> {
  switch (source) {
    case "arxiv":
      return adapters.arxiv({ query: q, limit }, { fetchFn })
    case "openalex":
      return adapters.openalex({ query: q, limit, fromDate: from }, { fetchFn, mailto: env?.OPENALEX_MAILTO })
    case "s2":
      return adapters.s2({ query: q, limit }, { fetchFn, apiKey: env?.S2_API_KEY })
    case "pubmed":
      return adapters.pubmed({ query: q, limit }, { fetchFn, apiKey: env?.NCBI_API_KEY })
  }
}

/**
 * Core handler for GET /api/search/[source]?q=&limit=&from=. Framework-free
 * so it can be unit tested directly; `route.ts` is a thin wrapper that
 * wires in NextRequest/NextResponse and process.env.
 *
 * Order of checks: unknown source (404) -> missing/blank q (400) -> cache
 * hit (short-circuits, no upstream call, no bucket touch) -> single-flight
 * dedup (share an in-flight upstream call across concurrent identical
 * requests) -> rate limit (429) when starting new upstream work ->
 * upstream call (success 200 / upstream 429 passthrough / other error 502).
 * Only successful (200) results are cached; errors are never cached so a
 * subsequent request retries the upstream. Error bodies never echo `q` or
 * upstream messages.
 */
export async function handleSearch(
  source: string,
  params: HandleSearchParams,
  deps: HandleSearchDeps = {},
): Promise<HandleSearchResponse> {
  if (!isSourceKey(source)) {
    return { status: 404, body: { error: "unknown source" } }
  }

  const q = nonEmpty(params.q)
  if (q === undefined) {
    return { status: 400, body: { error: "missing q" } }
  }

  if (q.length > MAX_QUERY_LENGTH) {
    return { status: 400, body: { error: "query too long" } }
  }

  const limit = parseLimit(params.limit)
  const from = nonEmpty(params.from)

  const cacheKey = JSON.stringify([source, q, limit, from ?? null])

  const cache = deps.cache ?? defaultCache
  const cached = cache.get(cacheKey)
  if (cached) {
    return { status: 200, body: { papers: cached }, headers: { "Cache-Control": SEARCH_CACHE_CONTROL } }
  }

  const adapters: AdapterMap = { ...defaultAdapters, ...deps.adapters }

  let inflight = inFlight.get(cacheKey)
  const isOwner = !inflight
  if (!inflight) {
    const buckets = { ...defaultBuckets, ...deps.buckets }
    const bucket = buckets[source]
    if (!bucket.take(source)) {
      return { status: 429, body: { error: "rate limited" }, headers: { "Retry-After": BUCKET_RETRY_AFTER_SECONDS } }
    }

    inflight = callAdapter(source, adapters, q, limit, from, deps.fetchFn, deps.env)
    inFlight.set(cacheKey, inflight)
    const settled = inflight
    // .finally's derived promise re-throws on rejection; since nothing else
    // awaits it, an unhandled one would surface as an unhandled rejection
    // even though `inflight` itself is properly awaited (and its rejection
    // handled) below. Swallow it here - it's purely for cleanup.
    inflight.finally(() => {
      if (inFlight.get(cacheKey) === settled) inFlight.delete(cacheKey)
    }).catch(() => {})
  }

  try {
    const result = await inflight
    if (isOwner) {
      cache.set(cacheKey, result)
    }
    return { status: 200, body: { papers: result }, headers: { "Cache-Control": SEARCH_CACHE_CONTROL } }
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

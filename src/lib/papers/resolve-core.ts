import { TtlCache } from "../server/ttl-cache"
import { TokenBucket } from "../server/rate-limit"
import { PaperSourceError, normalizeDoi } from "./types"
import { resolveOa } from "./unpaywall"

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const CACHE_MAX_ENTRIES = 5000
const BUCKET_CAPACITY = 10
const BUCKET_REFILL_PER_SEC = 5
const BUCKET_KEY = "unpaywall"
const RETRY_AFTER_SECONDS = "1"
const RESOLVE_CACHE_CONTROL = "public, s-maxage=86400"

const defaultCache = new TtlCache<object>({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES })
const defaultBucket = new TokenBucket({ capacity: BUCKET_CAPACITY, refillPerSec: BUCKET_REFILL_PER_SEC })

export interface HandleResolveDeps {
  fetchFn?: typeof fetch
  email?: string
  cache?: TtlCache<object>
  bucket?: TokenBucket
}

export interface HandleResolveResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/**
 * Core handler for GET /api/resolve?doi=<doi>. Framework-free so it can be
 * unit tested directly; `route.ts` is a thin wrapper that wires in
 * NextRequest/NextResponse and process.env.
 *
 * Order of checks: missing email config (503) -> invalid doi shape (400) ->
 * cache hit (short-circuits, no upstream call) -> rate limit (429) ->
 * upstream call (success 200 / PaperSourceError 502).
 */
export async function handleResolve(rawDoi: string | null, deps: HandleResolveDeps): Promise<HandleResolveResponse> {
  const email = deps.email
  if (!email) {
    return { status: 503, body: { error: "resolver not configured" } }
  }

  const doi = normalizeDoi(rawDoi)
  if (!doi || !doi.startsWith("10.")) {
    return { status: 400, body: { error: "invalid doi" } }
  }

  const cache = deps.cache ?? defaultCache
  const cached = cache.get(doi)
  if (cached) {
    return {
      status: 200,
      body: { doi, ...cached },
      headers: { "Cache-Control": RESOLVE_CACHE_CONTROL },
    }
  }

  const bucket = deps.bucket ?? defaultBucket
  if (!bucket.take(BUCKET_KEY)) {
    return { status: 429, body: { error: "rate limited" }, headers: { "Retry-After": RETRY_AFTER_SECONDS } }
  }

  try {
    const result = await resolveOa(doi, { fetchFn: deps.fetchFn, email })
    cache.set(doi, result)
    return {
      status: 200,
      body: { doi, ...result },
      headers: { "Cache-Control": RESOLVE_CACHE_CONTROL },
    }
  } catch (err) {
    if (err instanceof PaperSourceError) {
      return { status: 502, body: { error: "upstream error" } }
    }
    throw err
  }
}

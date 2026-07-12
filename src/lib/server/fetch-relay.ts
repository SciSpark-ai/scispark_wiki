import { TokenBucket } from "./rate-limit"

/**
 * Allowlisted publisher/OA hosts for the /api/fetch CORS relay. Matching is
 * by exact host or dot-suffix ("www.arxiv.org" matches "arxiv.org") - never
 * substring `includes`, which lookalikes like "evil-arxiv.org" or
 * suffix-attacks like "arxiv.org.evil.com" would defeat.
 */
export const RELAY_ALLOWED_HOSTS = [
  "arxiv.org",
  "europepmc.org",
  "ncbi.nlm.nih.gov",
  "biorxiv.org",
  "medrxiv.org",
  "openalex.org",
]

// arXiv's own bulk API endpoint predates their https rollout and is still
// commonly linked as http:// - it is the single carve-out for the
// https-only rule.
const HTTP_EXCEPTION_HOST = "export.arxiv.org"

const MAX_REDIRECT_HOPS = 3
const DEFAULT_MAX_BYTES = 50_000_000

const IP_BUCKET_CAPACITY = 20
const IP_BUCKET_REFILL_PER_SEC = 0.5
const RATE_LIMIT_RETRY_AFTER_SECONDS = "5"

const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "text/html", "application/xml", "text/xml", "text/plain"])

const RELAY_CACHE_CONTROL = "public, s-maxage=3600"

// Generic, URL-free rejection bodies (privacy: never echo the requested URL
// or upstream details back to the caller).
const ERROR_BAD_URL = { error: "invalid url" }
const ERROR_FORBIDDEN = { error: "url not allowed" }
const ERROR_UNSUPPORTED_TYPE = { error: "unsupported content type" }
const ERROR_RATE_LIMITED = { error: "rate limited" }
const ERROR_UPSTREAM = { error: "upstream fetch failed" }

// Module-level bucket shared across requests within a serverless instance's
// lifetime (reset on cold start - acceptable per the M3 design notes).
const defaultIpBuckets = new TokenBucket({ capacity: IP_BUCKET_CAPACITY, refillPerSec: IP_BUCKET_REFILL_PER_SEC })

export interface HandleFetchRelayDeps {
  fetchFn?: typeof fetch
  ipBuckets?: TokenBucket
  /** Byte cap for the relayed body; defaults to 50 MB. Injectable for tests. */
  maxBytes?: number
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const h = new Headers({ "Content-Type": "application/json" })
  if (headers) {
    for (const [key, value] of Object.entries(headers)) h.set(key, value)
  }
  return new Response(JSON.stringify(body), { status, headers: h })
}

function isAllowedHost(hostname: string): boolean {
  return RELAY_ALLOWED_HOSTS.some((entry) => hostname === entry || hostname.endsWith("." + entry))
}

function parseUrl(raw: string | null): URL | null {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Validates a candidate URL (the original request, or a redirect hop)
 * against the relay's security rules. Returns the rejection status (403)
 * or null when the URL is allowed. Order: scheme -> userinfo -> allowlist.
 */
function rejectionStatus(url: URL): number | null {
  const isHttps = url.protocol === "https:"
  const isHttpException = url.protocol === "http:" && url.hostname === HTTP_EXCEPTION_HOST
  if (!isHttps && !isHttpException) return 403
  if (url.username || url.password) return 403
  if (!isAllowedHost(url.hostname)) return 403
  return null
}

/**
 * Wraps a byte stream with a hard cap: once the running total of bytes
 * enqueued exceeds `maxBytes`, the stream is terminated with an error
 * (`controller.error`) rather than silently truncated - callers reading the
 * relayed body will see the read reject/throw partway through. This is a
 * deliberate abort, not a clean truncation; documented in the plan as
 * "clients see a truncated/aborted body".
 */
function capStream(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > maxBytes) {
        controller.error(new Error("relayed response exceeded the size cap"))
        return
      }
      controller.enqueue(chunk)
    },
  })
}

/**
 * Core handler for GET /api/fetch?url=. Framework-free CORS relay for
 * public paper full texts. Every rule here is a security boundary:
 *
 * 1. IP rate limit checked first, before any network call.
 * 2. The URL must parse, use https (except http for export.arxiv.org),
 *    carry no userinfo, and target an allowlisted host (exact or subdomain
 *    match - never substring `includes`).
 * 3. Upstream is fetched with redirect: "manual"; each 3xx hop is resolved
 *    and re-validated against the same rules, up to 3 hops.
 * 4. The final response's Content-Type must be one of a small allowlist;
 *    the body is streamed through a byte-capped TransformStream; response
 *    headers are rebuilt from scratch (Content-Type, Content-Length when
 *    present, Cache-Control) so upstream Set-Cookie is never forwarded.
 *
 * No part of this function logs the requested URL, and no rejection body
 * echoes it back to the caller.
 */
export async function handleFetchRelay(
  rawUrl: string | null,
  clientKey: string,
  deps: HandleFetchRelayDeps = {},
): Promise<Response> {
  const buckets = deps.ipBuckets ?? defaultIpBuckets
  if (!buckets.take(clientKey)) {
    return jsonResponse(429, ERROR_RATE_LIMITED, { "Retry-After": RATE_LIMIT_RETRY_AFTER_SECONDS })
  }

  let url = parseUrl(rawUrl)
  if (!url) {
    return jsonResponse(400, ERROR_BAD_URL)
  }

  const initialRejection = rejectionStatus(url)
  if (initialRejection) {
    return jsonResponse(initialRejection, ERROR_FORBIDDEN)
  }

  const fetchFn = deps.fetchFn ?? fetch
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES

  let response: Response
  let hops = 0
  for (;;) {
    try {
      response = await fetchFn(url.toString(), { redirect: "manual" })
    } catch {
      // Network failure talking to an already-allowlisted host: generic
      // 502, no upstream error message or URL leaked to the caller.
      return jsonResponse(502, ERROR_UPSTREAM)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) break // Redirect with no Location: treat as the final (non-redirect) response.

      if (hops >= MAX_REDIRECT_HOPS) {
        return jsonResponse(403, ERROR_FORBIDDEN)
      }

      let nextUrl: URL
      try {
        nextUrl = new URL(location, url)
      } catch {
        return jsonResponse(400, ERROR_BAD_URL)
      }

      const hopRejection = rejectionStatus(nextUrl)
      if (hopRejection) {
        return jsonResponse(hopRejection, ERROR_FORBIDDEN)
      }

      hops += 1
      url = nextUrl
      continue
    }

    break
  }

  const contentType = response.headers.get("content-type") ?? ""
  const contentTypePrefix = contentType.split(";")[0].trim().toLowerCase()
  if (!ALLOWED_CONTENT_TYPES.has(contentTypePrefix)) {
    return jsonResponse(415, ERROR_UNSUPPORTED_TYPE)
  }

  const outHeaders = new Headers()
  outHeaders.set("Content-Type", contentType)
  const contentLength = response.headers.get("content-length")
  if (contentLength) outHeaders.set("Content-Length", contentLength)
  outHeaders.set("Cache-Control", RELAY_CACHE_CONTROL)

  const body = response.body ? response.body.pipeThrough(capStream(maxBytes)) : null

  return new Response(body, { status: response.status, headers: outHeaders })
}

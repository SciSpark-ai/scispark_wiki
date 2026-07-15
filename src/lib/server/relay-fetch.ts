import { handleFetchRelay } from "./fetch-relay"
import { handleResolve } from "../papers/resolve-core"

/**
 * Server-side stand-in for `fetch` that satisfies `acquireFullText`'s
 * `deps.fetchFn` when full-text acquisition runs server-side (M11's
 * digest/ingest skill routes). `acquireFullText` (src/lib/wiki/acquire.ts)
 * only ever calls its injected `fetchFn` with a relative same-origin URL —
 * `/api/fetch?url=...` (the CORS relay) or `/api/resolve?doi=...` (the
 * Unpaywall proxy) — because it was written for the browser, where a
 * relative URL resolves against `window.location` for free. Server-side
 * code has no such base, and a real HTTP round trip back to this app's own
 * routes would need an absolute URL (plus double the request/response
 * overhead) just to reach code that already runs in this same process. This
 * shim intercepts both paths and calls their already-framework-free core
 * handlers (`handleFetchRelay`, `handleResolve` — the same functions
 * `/api/fetch` and `/api/resolve`'s route.ts files delegate to) directly,
 * in-process, and wraps `handleResolve`'s `{status, body, headers}` return
 * into a `Response` so both paths satisfy `typeof fetch`.
 *
 * `clientKey` feeds `handleFetchRelay`'s per-IP rate limiter. There is no
 * request-level IP to key on here (the skill route handlers this feeds —
 * `jsonSkillRoute`/`ndjsonSkillRoute` — don't expose the raw `Request`), so
 * callers pass a fixed key (e.g. "server-ingest") distinct from `/api/fetch`
 * route.ts's own per-IP keys, so server-triggered acquisitions share one
 * rate-limit bucket instead of colliding with (or being starved by) real
 * browser-originated relay traffic.
 */
export function serverRelayFetch(clientKey: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, "http://localhost")

    if (url.pathname === "/api/fetch") {
      return handleFetchRelay(url.searchParams.get("url"), clientKey)
    }

    if (url.pathname === "/api/resolve") {
      const { status, body, headers } = await handleResolve(url.searchParams.get("doi"), {
        email: process.env.UNPAYWALL_EMAIL,
      })
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(headers ?? {}) },
      })
    }

    throw new Error(`serverRelayFetch: unsupported path "${url.pathname}"`)
  }) as typeof fetch
}

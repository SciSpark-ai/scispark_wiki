import { describe, it, expect, vi } from "vitest"
import { handleResolve } from "../resolve-core"
import { TtlCache } from "../../server/ttl-cache"
import { TokenBucket } from "../../server/rate-limit"
import fixture from "./fixtures/unpaywall.json"

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

function freshDeps(overrides: Partial<Parameters<typeof handleResolve>[1]> = {}) {
  return {
    email: "me@example.com",
    cache: new TtlCache<object>({ ttlMs: 60_000, maxEntries: 100 }),
    bucket: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
    ...overrides,
  }
}

describe("handleResolve", () => {
  it("returns 503 when the email is not configured", async () => {
    const result = await handleResolve("10.1038/nature12373", freshDeps({ email: undefined }))
    expect(result.status).toBe(503)
    expect(result.body).toEqual({ error: "resolver not configured" })
  })

  it("returns 400 for a doi missing the 10. prefix", async () => {
    const result = await handleResolve("not-a-doi", freshDeps())
    expect(result.status).toBe(400)
  })

  it("returns 400 for a null doi", async () => {
    const result = await handleResolve(null, freshDeps())
    expect(result.status).toBe(400)
  })

  it("returns 400 for an empty/whitespace doi", async () => {
    const result = await handleResolve("   ", freshDeps())
    expect(result.status).toBe(400)
  })

  it("returns 200 with the resolved result and Cache-Control on success", async () => {
    const fetchFn = fakeFetch(fixture)
    const result = await handleResolve("10.1038/nature12373", freshDeps({ fetchFn }))

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      doi: "10.1038/nature12373",
      isOa: true,
      oaUrl: fixture.best_oa_location.url_for_landing_page,
      pdfUrl: fixture.best_oa_location.url_for_pdf,
    })
    expect(result.headers?.["Cache-Control"]).toBe("public, s-maxage=86400")
  })

  it("short-circuits on a cache hit: fetch is called once across two calls", async () => {
    const fetchFn = fakeFetch(fixture)
    const deps = freshDeps({ fetchFn })

    const first = await handleResolve("10.1038/nature12373", deps)
    const second = await handleResolve("10.1038/nature12373", deps)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
  })

  it("returns 429 with Retry-After when the bucket is exhausted", async () => {
    const fetchFn = fakeFetch(fixture)
    const bucket = new TokenBucket({ capacity: 1, refillPerSec: 0 })
    const deps = freshDeps({ fetchFn, bucket })

    // Different DOIs so the second call can't be served from cache - it must hit the bucket.
    const first = await handleResolve("10.1038/nature12373", deps)
    const second = await handleResolve("10.1038/other-doi", deps)

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(second.headers?.["Retry-After"]).toBe("1")
  })

  it("returns 429 immediately when the bucket has zero capacity", async () => {
    const fetchFn = fakeFetch(fixture)
    const bucket = new TokenBucket({ capacity: 0, refillPerSec: 0 })
    const deps = freshDeps({ fetchFn, bucket })

    const result = await handleResolve("10.1038/nature12373", deps)

    expect(result.status).toBe(429)
    expect(result.headers?.["Retry-After"]).toBe("1")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("returns 502 without echoing the doi when the upstream errors", async () => {
    const fetchFn = fakeFetch({ error: "forbidden" }, 403)
    const result = await handleResolve("10.1038/nature12373", freshDeps({ fetchFn }))

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: "upstream error" })
    expect(JSON.stringify(result.body)).not.toContain("10.1038")
  })

  it("returns 502 without echoing the doi on a network-level failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    const result = await handleResolve("10.1038/nature12373", freshDeps({ fetchFn }))

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: "upstream error" })
  })

  it("normalizes a doi: prefix and casing before validating and caching", async () => {
    const fetchFn = fakeFetch(fixture)
    const deps = freshDeps({ fetchFn })

    const result = await handleResolve("https://doi.org/10.1038/NATURE12373", deps)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ doi: "10.1038/nature12373" })
  })
})

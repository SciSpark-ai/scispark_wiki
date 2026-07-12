import { describe, it, expect, vi } from "vitest"
import { handleSearch } from "../search-core"
import { TtlCache } from "../../server/ttl-cache"
import { TokenBucket } from "../../server/rate-limit"
import { PaperSourceError, type PaperRecord } from "../types"

function makePaper(title: string): PaperRecord {
  return { ids: {}, title, authors: [], fields: [], source: "arxiv" }
}

function stubAdapter(result: PaperRecord[] | Error) {
  return vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
}

function freshDeps(overrides: Partial<Parameters<typeof handleSearch>[2]> = {}) {
  return {
    cache: new TtlCache<PaperRecord[]>({ ttlMs: 60_000, maxEntries: 100 }),
    buckets: {
      arxiv: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
      openalex: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
      s2: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
      pubmed: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
    },
    ...overrides,
  }
}

describe("handleSearch", () => {
  it("returns 404 for an unknown source", async () => {
    const result = await handleSearch("unknown", { q: "transformer" }, freshDeps())
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: "unknown source" })
  })

  it("returns 400 for a missing q", async () => {
    const result = await handleSearch("arxiv", {}, freshDeps())
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: "missing q" })
  })

  it("returns 400 for a blank q", async () => {
    const result = await handleSearch("arxiv", { q: "   " }, freshDeps())
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: "missing q" })
  })

  it("clamps an over-large limit to 50", async () => {
    const adapter = stubAdapter([])
    const result = await handleSearch(
      "arxiv",
      { q: "transformer", limit: "999" },
      freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } }),
    )
    expect(result.status).toBe(200)
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }), expect.anything())
  })

  it("clamps a zero limit to 1", async () => {
    const adapter = stubAdapter([])
    const result = await handleSearch(
      "arxiv",
      { q: "transformer", limit: "0" },
      freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } }),
    )
    expect(result.status).toBe(200)
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }), expect.anything())
  })

  it("defaults garbage limit to 20", async () => {
    const adapter = stubAdapter([])
    const result = await handleSearch(
      "arxiv",
      { q: "transformer", limit: "not-a-number" },
      freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } }),
    )
    expect(result.status).toBe(200)
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }), expect.anything())
  })

  it("caches a successful result: adapter called once across two sequential calls", async () => {
    const papers = [makePaper("Attention Is All You Need")]
    const adapter = stubAdapter(papers)
    const deps = freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } })

    const first = await handleSearch("arxiv", { q: "transformer" }, deps)
    const second = await handleSearch("arxiv", { q: "transformer" }, deps)

    expect(adapter).toHaveBeenCalledTimes(1)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(first.headers?.["Cache-Control"]).toBe("public, s-maxage=600, stale-while-revalidate=3600")
  })

  it("never caches errors: adapter called twice on 502-then-success", async () => {
    const errorAdapter = vi
      .fn()
      .mockRejectedValueOnce(new PaperSourceError("boom"))
      .mockResolvedValueOnce([makePaper("Retry Success")])
    const deps = freshDeps({
      adapters: { arxiv: errorAdapter as unknown as typeof import("../arxiv").searchArxiv },
    })

    const first = await handleSearch("arxiv", { q: "retry-me" }, deps)
    const second = await handleSearch("arxiv", { q: "retry-me" }, deps)

    expect(first.status).toBe(502)
    expect(first.body).toEqual({ error: "upstream error" })
    expect(second.status).toBe(200)
    expect(errorAdapter).toHaveBeenCalledTimes(2)
  })

  it("returns 429 with Retry-After 2 when the per-source bucket is exhausted", async () => {
    const adapter = stubAdapter([])
    const bucket = new TokenBucket({ capacity: 0, refillPerSec: 0 })
    const deps = freshDeps({
      adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv },
      buckets: { arxiv: bucket, openalex: bucket, s2: bucket, pubmed: bucket },
    })

    const result = await handleSearch("arxiv", { q: "bucket-exhausted" }, deps)

    expect(result.status).toBe(429)
    expect(result.headers?.["Retry-After"]).toBe("2")
    expect(adapter).not.toHaveBeenCalled()
  })

  it("returns 429 with Retry-After 5 when the upstream itself signals a 429", async () => {
    const adapter = stubAdapter(new PaperSourceError("rate limited upstream", 429))
    const deps = freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } })

    const result = await handleSearch("arxiv", { q: "upstream-429" }, deps)

    expect(result.status).toBe(429)
    expect(result.headers?.["Retry-After"]).toBe("5")
  })

  it("returns 502 without echoing the query string on upstream error", async () => {
    const adapter = stubAdapter(new PaperSourceError("secret upstream message about super-secret-query"))
    const deps = freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } })

    const result = await handleSearch("arxiv", { q: "super-secret-query" }, deps)

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: "upstream error" })
    expect(JSON.stringify(result.body)).not.toContain("super-secret-query")
  })

  it("returns 502 for unknown/non-PaperSourceError errors too", async () => {
    const adapter = stubAdapter(new Error("totally unexpected"))
    const deps = freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } })

    const result = await handleSearch("arxiv", { q: "oops" }, deps)

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: "upstream error" })
  })

  it("wires env.OPENALEX_MAILTO into the openalex adapter", async () => {
    const adapter = stubAdapter([])
    const deps = freshDeps({
      env: { OPENALEX_MAILTO: "me@example.com" },
      adapters: { openalex: adapter as unknown as typeof import("../openalex").searchOpenAlex },
    })

    await handleSearch("openalex", { q: "transformer" }, deps)

    expect(adapter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mailto: "me@example.com" }))
  })

  it("wires env.S2_API_KEY into the s2 adapter", async () => {
    const adapter = stubAdapter([])
    const deps = freshDeps({
      env: { S2_API_KEY: "s2-secret" },
      adapters: { s2: adapter as unknown as typeof import("../s2").searchS2 },
    })

    await handleSearch("s2", { q: "transformer" }, deps)

    expect(adapter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "s2-secret" }))
  })

  it("wires env.NCBI_API_KEY into the pubmed adapter", async () => {
    const adapter = stubAdapter([])
    const deps = freshDeps({
      env: { NCBI_API_KEY: "ncbi-secret" },
      adapters: { pubmed: adapter as unknown as typeof import("../pubmed").searchPubmed },
    })

    await handleSearch("pubmed", { q: "transformer" }, deps)

    expect(adapter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "ncbi-secret" }))
  })

  it("passes from only to the openalex adapter", async () => {
    const openalexAdapter = stubAdapter([])
    const arxivAdapter = stubAdapter([])
    const deps = freshDeps({
      adapters: {
        openalex: openalexAdapter as unknown as typeof import("../openalex").searchOpenAlex,
        arxiv: arxivAdapter as unknown as typeof import("../arxiv").searchArxiv,
      },
    })

    await handleSearch("openalex", { q: "transformer", from: "2020-01-01" }, deps)
    await handleSearch("arxiv", { q: "transformer", from: "2020-01-01" }, deps)

    expect(openalexAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: "2020-01-01" }),
      expect.anything(),
    )
    expect(arxivAdapter).toHaveBeenCalledWith(expect.not.objectContaining({ fromDate: expect.anything() }), expect.anything())
  })

  it("single-flight: two concurrent identical requests share one upstream call", async () => {
    let resolveFn: (papers: PaperRecord[]) => void = () => {}
    const deferred = new Promise<PaperRecord[]>((resolve) => {
      resolveFn = resolve
    })
    const adapter = vi.fn(() => deferred)
    const deps = freshDeps({ adapters: { arxiv: adapter as unknown as typeof import("../arxiv").searchArxiv } })

    const call1 = handleSearch("arxiv", { q: "concurrent-dedup" }, deps)
    const call2 = handleSearch("arxiv", { q: "concurrent-dedup" }, deps)

    // Let both calls reach the point of sharing the in-flight promise before resolving.
    await Promise.resolve()
    await Promise.resolve()
    resolveFn([makePaper("Shared Result")])

    const [result1, result2] = await Promise.all([call1, call2])

    expect(adapter).toHaveBeenCalledTimes(1)
    expect(result1.status).toBe(200)
    expect(result2.status).toBe(200)
    expect(result1.body).toEqual(result2.body)
  })
})

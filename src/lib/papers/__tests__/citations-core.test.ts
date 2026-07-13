import { describe, it, expect, vi } from "vitest"
import { fetchReferences, handleCitations } from "../citations-core"
import { TtlCache } from "../../server/ttl-cache"
import { TokenBucket } from "../../server/rate-limit"
import { PaperSourceError } from "../types"
import type { CitationRef } from "../citations-core"

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

function freshDeps(overrides: Partial<Parameters<typeof handleCitations>[1]> = {}) {
  return {
    cache: new TtlCache<CitationRef[]>({ ttlMs: 60_000, maxEntries: 100 }),
    bucket: new TokenBucket({ capacity: 10, refillPerSec: 5 }),
    ...overrides,
  }
}

describe("fetchReferences", () => {
  it("normalizes references' externalIds into PaperIds", async () => {
    const fetchFn = fakeFetch({
      data: [
        {
          citedPaper: {
            title: "Attention Is All You Need",
            externalIds: { DOI: "10.5555/ATTN", ArXiv: "1706.03762", PubMed: "12345", CorpusId: 999 },
          },
        },
      ],
    })

    const refs = await fetchReferences("ARXIV:1706.03762", { fetchFn })

    expect(refs).toEqual([
      {
        ids: { doi: "10.5555/attn", arxiv: "1706.03762", pmid: "12345", s2: "999" },
        title: "Attention Is All You Need",
      },
    ])
  })

  it("defaults a missing title to an empty string and drops entries with no citedPaper", async () => {
    const fetchFn = fakeFetch({ data: [{ citedPaper: { externalIds: {} } }, { citedPaper: null }, {}] })

    const refs = await fetchReferences("DOI:10.1/x", { fetchFn })

    expect(refs).toEqual([{ ids: {}, title: "" }])
  })

  it("returns [] when data is absent", async () => {
    const fetchFn = fakeFetch({})
    const refs = await fetchReferences("DOI:10.1/x", { fetchFn })
    expect(refs).toEqual([])
  })

  it("returns [] on a 404 (S2 has no record — not an error)", async () => {
    const fetchFn = fakeFetch({ error: "not found" }, 404)
    const refs = await fetchReferences("DOI:10.1/unknown", { fetchFn })
    expect(refs).toEqual([])
  })

  it("throws PaperSourceError with status on a non-200/404 response", async () => {
    const fetchFn = fakeFetch({ error: "bad request" }, 400)
    await expect(fetchReferences("DOI:10.1/x", { fetchFn })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 400,
    })
  })

  it("wraps a network-level throw in PaperSourceError without a status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    await expect(fetchReferences("DOI:10.1/x", { fetchFn })).rejects.toBeInstanceOf(PaperSourceError)
  })

  it("does not set x-api-key when no apiKey is given, and sets it when one is", async () => {
    let capturedHeaders: HeadersInit | undefined
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    }) as unknown as typeof fetch

    await fetchReferences("DOI:10.1/x", { fetchFn })
    expect(new Headers(capturedHeaders).has("x-api-key")).toBe(false)

    await fetchReferences("DOI:10.1/x", { fetchFn, apiKey: "secret" })
    expect(new Headers(capturedHeaders).get("x-api-key")).toBe("secret")
  })

  it("builds the references URL with the encoded id, fields, and limit params", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    await fetchReferences("DOI:10.1038/s41586-021-03819-2", { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(
      "https://api.semanticscholar.org/graph/v1/paper/DOI%3A10.1038%2Fs41586-021-03819-2/references?fields=externalIds,title&limit=500",
    )
  })
})

describe("handleCitations", () => {
  it("returns 400 for a missing id", async () => {
    const result = await handleCitations({ id: null }, freshDeps())
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: "invalid id" })
  })

  it("returns 400 for junk ids (no valid prefix)", async () => {
    for (const id of ["", "garbage", "pmid:123", "doi:", "ARXIV:", "DOI:   "]) {
      const result = await handleCitations({ id }, freshDeps())
      expect(result.status).toBe(400)
    }
  })

  it("accepts a valid DOI id", async () => {
    const fetchFn = fakeFetch({ data: [] })
    const result = await handleCitations({ id: "DOI:10.1038/x" }, freshDeps({ fetchFn }))
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ references: [] })
  })

  it("accepts a valid ARXIV id", async () => {
    const fetchFn = fakeFetch({ data: [] })
    const result = await handleCitations({ id: "ARXIV:1706.03762" }, freshDeps({ fetchFn }))
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ references: [] })
  })

  it("404 upstream -> 200 with empty references", async () => {
    const fetchFn = fakeFetch({}, 404)
    const result = await handleCitations({ id: "DOI:10.1/unknown" }, freshDeps({ fetchFn }))
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ references: [] })
  })

  it("caches a successful result: fetch called once across two sequential calls", async () => {
    const fetchFn = fakeFetch({ data: [{ citedPaper: { title: "X", externalIds: { DOI: "10.1/x" } } }] })
    const deps = freshDeps({ fetchFn })

    const first = await handleCitations({ id: "DOI:10.1/y" }, deps)
    const second = await handleCitations({ id: "DOI:10.1/y" }, deps)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(second.body).toEqual(first.body)
    expect(first.headers?.["Cache-Control"]).toBe("public, s-maxage=86400")
  })

  it("never caches errors: fetch called twice on 502-then-success", async () => {
    const errorFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
    const deps = freshDeps({ fetchFn: errorFetch as unknown as typeof fetch })

    const first = await handleCitations({ id: "DOI:10.1/retry" }, deps)
    const second = await handleCitations({ id: "DOI:10.1/retry" }, deps)

    expect(first.status).toBe(502)
    expect(first.body).toEqual({ error: "upstream error" })
    expect(second.status).toBe(200)
    expect(errorFetch).toHaveBeenCalledTimes(2)
  })

  it("returns 429 with Retry-After 2 when the bucket is exhausted", async () => {
    const fetchFn = fakeFetch({ data: [] })
    const bucket = new TokenBucket({ capacity: 0, refillPerSec: 0 })
    const result = await handleCitations({ id: "DOI:10.1/x" }, freshDeps({ fetchFn, bucket }))

    expect(result.status).toBe(429)
    expect(result.headers?.["Retry-After"]).toBe("2")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("returns 429 with Retry-After 5 when the upstream itself signals a 429", async () => {
    const fetchFn = fakeFetch({ error: "rate limited" }, 429)
    const result = await handleCitations({ id: "DOI:10.1/x" }, freshDeps({ fetchFn }))

    expect(result.status).toBe(429)
    expect(result.headers?.["Retry-After"]).toBe("5")
  })

  it("never echoes the id in an error body", async () => {
    const fetchFn = fakeFetch({}, 500)
    const result = await handleCitations({ id: "DOI:10.1/super-secret-id" }, freshDeps({ fetchFn }))

    expect(result.status).toBe(502)
    expect(JSON.stringify(result.body)).not.toContain("super-secret-id")
  })

  it("single-flight: two concurrent identical requests share one upstream call", async () => {
    let resolveFn: (refs: CitationRef[]) => void = () => {}
    const deferred = new Promise<CitationRef[]>((resolve) => {
      resolveFn = resolve
    })
    // fetchReferences is invoked with fetchFn/apiKey; we stub at the fetchFn
    // layer so both concurrent handleCitations calls resolve through the
    // same underlying promise once the single-flight registry dedupes them.
    const fetchFn = vi.fn(() => deferred.then((refs) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: refs.map((r) => ({ citedPaper: { title: r.title, externalIds: {} } })),
      }),
    }))) as unknown as typeof fetch
    const deps = freshDeps({ fetchFn })

    const call1 = handleCitations({ id: "DOI:10.1/concurrent" }, deps)
    const call2 = handleCitations({ id: "DOI:10.1/concurrent" }, deps)

    await Promise.resolve()
    await Promise.resolve()
    resolveFn([{ ids: {}, title: "Shared Result" }])

    const [result1, result2] = await Promise.all([call1, call2])

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(result1.status).toBe(200)
    expect(result2.body).toEqual(result1.body)
  })
})

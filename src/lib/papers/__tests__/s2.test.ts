import { describe, it, expect, vi } from "vitest"
import { searchS2 } from "../s2"
import { PaperSourceError } from "../types"
import fixture from "./fixtures/s2-search.json"

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe("searchS2", () => {
  it("maps a paper record with a full set of fields (Literature Graph fixture)", async () => {
    const record = fixture.data[0]
    const fetchFn = fakeFetch({ data: [record] })

    const [paper] = await searchS2({ query: "transformer" }, { fetchFn })

    expect(paper.title).toBe("Construction of the Literature Graph in Semantic Scholar")
    expect(paper.ids.s2).toBe("5c5751d45e298cea054f32b392c12c61027d2fe7")
    expect(paper.ids.doi).toBe("10.18653/v1/2020.acl-main.447")
    expect(paper.ids.arxiv).toBeUndefined()
    expect(paper.ids.pmid).toBeUndefined()
    expect(paper.year).toBe(1997)
    expect(paper.date).toBe("2018-05-01")
    expect(paper.venue).toBe("Annual Meeting of the Association for Computational Linguistics")
    expect(paper.citationCount).toBe(453)
    expect(paper.pdfUrl).toBe("https://www.aclweb.org/anthology/2020.acl-main.447.pdf")
    expect(paper.fields).toEqual(["Computer Science"])
    expect(paper.authors).toEqual([{ name: "Oren Etzioni", openalexId: undefined }])
    expect(paper.source).toBe("s2")
  })

  it("maps arxiv and pmid ids from externalIds, and returns undefined pdfUrl when openAccessPdf is absent (second fixture record)", async () => {
    const record = fixture.data[1]
    const fetchFn = fakeFetch({ data: [record] })

    const [paper] = await searchS2({ query: "transformer" }, { fetchFn })

    expect(paper.ids.arxiv).toBe("1706.03762")
    expect(paper.ids.pmid).toBe("34567890")
    expect(paper.ids.doi).toBeUndefined()
    expect(paper.pdfUrl).toBeUndefined()
    expect(paper.date).toBeUndefined()
    expect(paper.fields).toEqual(["Computer Science", "Mathematics"])
  })

  it("maps a null abstract to undefined", async () => {
    const record = fixture.data[1]
    const fetchFn = fakeFetch({ data: [record] })

    const [paper] = await searchS2({ query: "transformer" }, { fetchFn })

    expect(paper.abstract).toBeUndefined()
  })

  it("maps a present abstract string through unchanged", async () => {
    const record = fixture.data[0]
    const fetchFn = fakeFetch({ data: [record] })

    const [paper] = await searchS2({ query: "transformer" }, { fetchFn })

    expect(paper.abstract).toBe(record.abstract)
  })

  it("returns [] when data is absent (total 0)", async () => {
    const fetchFn = fakeFetch({ total: 0, offset: 0 })

    const results = await searchS2({ query: "totalGarbageNonsense" }, { fetchFn })

    expect(results).toEqual([])
  })

  it("returns [] when data is an empty array", async () => {
    const fetchFn = fakeFetch({ total: 0, offset: 0, data: [] })

    const results = await searchS2({ query: "x" }, { fetchFn })

    expect(results).toEqual([])
  })

  it("does not set the x-api-key header when no apiKey is provided", async () => {
    let capturedHeaders: HeadersInit | undefined
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    }) as unknown as typeof fetch

    await searchS2({ query: "x" }, { fetchFn })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const headers = new Headers(capturedHeaders)
    expect(headers.has("x-api-key")).toBe(false)
  })

  it("sets the x-api-key header when apiKey is provided", async () => {
    let capturedHeaders: HeadersInit | undefined
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    }) as unknown as typeof fetch

    await searchS2({ query: "x" }, { fetchFn, apiKey: "secret-key-123" })

    const headers = new Headers(capturedHeaders)
    expect(headers.get("x-api-key")).toBe("secret-key-123")
  })

  it("throws PaperSourceError with status 429 on a rate-limited response", async () => {
    const fetchFn = fakeFetch({ message: "Too Many Requests", code: "429" }, 429)

    await expect(searchS2({ query: "x" }, { fetchFn })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 429,
    })
  })

  it("throws PaperSourceError with status on a non-200 response", async () => {
    const fetchFn = fakeFetch({ error: "Bad query parameters" }, 400)

    await expect(searchS2({ query: "x" }, { fetchFn })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 400,
    })
  })

  it("wraps a network-level throw in PaperSourceError without a status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    await expect(searchS2({ query: "x" }, { fetchFn })).rejects.toBeInstanceOf(PaperSourceError)
    try {
      await searchS2({ query: "x" }, { fetchFn })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PaperSourceError)
      expect((err as PaperSourceError).status).toBeUndefined()
    }
  })

  it("builds the request URL with query, limit, and fields params", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    await searchS2({ query: "quantum computing", limit: 5 }, { fetchFn })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.origin + url.pathname).toBe("https://api.semanticscholar.org/graph/v1/paper/search")
    expect(url.searchParams.get("query")).toBe("quantum computing")
    expect(url.searchParams.get("limit")).toBe("5")
    const fields = url.searchParams.get("fields")?.split(",") ?? []
    expect(fields).toEqual(
      expect.arrayContaining([
        "title",
        "abstract",
        "authors",
        "year",
        "publicationDate",
        "venue",
        "citationCount",
        "externalIds",
        "openAccessPdf",
        "fieldsOfStudy",
      ])
    )
  })

  it("clamps a limit above 50 down to 50", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    await searchS2({ query: "x", limit: 500 }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.searchParams.get("limit")).toBe("50")
  })

  it("clamps a limit below 1 up to 1", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    await searchS2({ query: "x", limit: 0 }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.searchParams.get("limit")).toBe("1")
  })

  it("defaults limit to 20 when no limit is given", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    await searchS2({ query: "x" }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.searchParams.get("limit")).toBe("20")
  })
})

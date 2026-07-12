import { describe, it, expect, vi } from "vitest"
import { searchOpenAlex } from "../openalex"
import { PaperSourceError } from "../types"
import fixture from "./fixtures/openalex-works.json"

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe("searchOpenAlex", () => {
  it("maps a work record with a full set of fields (Swin Transformer fixture)", async () => {
    const record = fixture.results[0]
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "transformer" }, { fetchFn })

    expect(paper.title).toBe("Swin Transformer: Hierarchical Vision Transformer using Shifted Windows")
    expect(paper.ids.doi).toBe("10.1109/iccv48922.2021.00986")
    expect(paper.ids.openalex).toBe("W3138516171")
    expect(paper.year).toBe(2021)
    expect(paper.date).toBe("2021-10-01")
    expect(paper.venue).toBe("2021 IEEE/CVF International Conference on Computer Vision (ICCV)")
    expect(paper.citationCount).toBe(record.cited_by_count)
    expect(paper.source).toBe("openalex")
    expect(paper.authors[0]).toEqual({ name: "Ze Liu", openalexId: "A5100349451" })
    expect(paper.authors.length).toBe(record.authorships.length)
    // record[0] has no open access url / pdf url in the fixture
    expect(paper.oaUrl).toBeUndefined()
    expect(paper.pdfUrl).toBeUndefined()
    // top <=5 topics by score, mapped to display_name
    const expectedFields = [...record.topics]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((t) => t.display_name)
    expect(paper.fields).toEqual(expectedFields)
    expect(paper.fields.length).toBeLessThanOrEqual(5)
  })

  it("maps oaUrl and pdfUrl when present (second fixture record)", async () => {
    const record = fixture.results[1]
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "transformer" }, { fetchFn })

    expect(paper.oaUrl).toBe(record.open_access.oa_url)
    expect(paper.pdfUrl).toBe(record.primary_location.pdf_url)
    expect(paper.venue).toBe(record.primary_location.source?.display_name)
  })

  it("reconstructs the abstract from abstract_inverted_index (hand-checkable case)", async () => {
    const fetchFn = fakeFetch({
      results: [
        {
          id: "https://openalex.org/W1",
          doi: null,
          display_name: "Minimal Work",
          publication_year: 2020,
          publication_date: "2020-01-01",
          ids: { openalex: "https://openalex.org/W1" },
          primary_location: null,
          open_access: null,
          authorships: [],
          cited_by_count: 0,
          topics: [],
          abstract_inverted_index: { Deep: [0], learning: [1], works: [2] },
        },
      ],
    })

    const [paper] = await searchOpenAlex({ query: "deep learning" }, { fetchFn })

    expect(paper.abstract).toBe("Deep learning works")
  })

  it("returns undefined abstract when abstract_inverted_index is missing", async () => {
    const record = { ...fixture.results[0] } as Record<string, unknown>
    delete record.abstract_inverted_index
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "transformer" }, { fetchFn })

    expect(paper.abstract).toBeUndefined()
  })

  it("returns undefined abstract when abstract_inverted_index is null", async () => {
    const record = { ...fixture.results[0], abstract_inverted_index: null }
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "transformer" }, { fetchFn })

    expect(paper.abstract).toBeUndefined()
  })

  it("reconstructs the real Swin Transformer fixture abstract with duplicated words at correct positions", async () => {
    const record = fixture.results[0]
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "transformer" }, { fetchFn })

    // Verify abstract starts with the expected first ~8 words in order
    expect(paper.abstract).toBeDefined()
    expect(paper.abstract).toMatch(/^This paper presents a new vision Transformer/)

    // Verify a duplicated word appears at multiple non-contiguous positions
    // "a" appears at indices [3, 14, 64, 125, 172] in the abstract_inverted_index
    const firstIndexOfA = paper.abstract!.indexOf(" a ")
    const lastIndexOfA = paper.abstract!.lastIndexOf(" a ")
    expect(firstIndexOfA).not.toBe(-1)
    expect(lastIndexOfA).not.toBe(-1)
    expect(firstIndexOfA).not.toBe(lastIndexOfA)
  })

  it("maps null author.id to openalexId undefined", async () => {
    const fetchFn = fakeFetch({
      results: [
        {
          id: "https://openalex.org/W1",
          doi: null,
          display_name: "Test Paper",
          publication_year: 2020,
          publication_date: "2020-01-01",
          ids: null,
          primary_location: null,
          open_access: null,
          authorships: [
            {
              author: {
                id: null,
                display_name: "Test Author",
              },
            },
          ],
          cited_by_count: 0,
          topics: [],
          abstract_inverted_index: null,
        },
      ],
    })

    const [paper] = await searchOpenAlex({ query: "test" }, { fetchFn })

    expect(paper.authors).toHaveLength(1)
    expect(paper.authors[0]).toEqual({ name: "Test Author", openalexId: undefined })
  })

  it("maps null display_name to title empty string", async () => {
    const fetchFn = fakeFetch({
      results: [
        {
          id: "https://openalex.org/W1",
          doi: null,
          display_name: null,
          publication_year: 2020,
          publication_date: "2020-01-01",
          ids: null,
          primary_location: null,
          open_access: null,
          authorships: [],
          cited_by_count: 0,
          topics: [],
          abstract_inverted_index: null,
        },
      ],
    })

    const [paper] = await searchOpenAlex({ query: "test" }, { fetchFn })

    expect(paper.title).toBe("")
  })

  it("builds the request URL with per_page clamp, mailto, and filter when fromDate is set", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch

    await searchOpenAlex(
      { query: "quantum computing", limit: 500, fromDate: "2023-01-01" },
      { fetchFn, mailto: "me@example.com" }
    )

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.origin + url.pathname).toBe("https://api.openalex.org/works")
    expect(url.searchParams.get("search")).toBe("quantum computing")
    // limit clamped to max 50 even though 500 was requested
    expect(url.searchParams.get("per_page")).toBe("50")
    expect(url.searchParams.get("mailto")).toBe("me@example.com")
    expect(url.searchParams.get("filter")).toBe("from_publication_date:2023-01-01")
  })

  it("clamps a limit below 1 up to 1", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch

    await searchOpenAlex({ query: "x", limit: 0 }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.searchParams.get("per_page")).toBe("1")
  })

  it("defaults per_page to 20 when no limit is given", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch

    await searchOpenAlex({ query: "x" }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.searchParams.get("per_page")).toBe("20")
  })

  it("omits mailto and filter params when not provided", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch

    await searchOpenAlex({ query: "x" }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.searchParams.has("mailto")).toBe(false)
    expect(url.searchParams.has("filter")).toBe(false)
  })

  it("throws PaperSourceError with status on a non-200 response", async () => {
    const fetchFn = fakeFetch({ error: "forbidden" }, 403)

    await expect(searchOpenAlex({ query: "x" }, { fetchFn })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 403,
    })
  })

  it("wraps a network-level throw in PaperSourceError without a status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    await expect(searchOpenAlex({ query: "x" }, { fetchFn })).rejects.toBeInstanceOf(PaperSourceError)
    try {
      await searchOpenAlex({ query: "x" }, { fetchFn })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PaperSourceError)
      expect((err as PaperSourceError).status).toBeUndefined()
    }
  })

  it("handles a missing/empty results array", async () => {
    const fetchFn = fakeFetch({})
    const results = await searchOpenAlex({ query: "x" }, { fetchFn })
    expect(results).toEqual([])
  })
})

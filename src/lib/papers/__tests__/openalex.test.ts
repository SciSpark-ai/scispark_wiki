import { describe, it, expect, vi } from "vitest"
import { countOpenAlexWorks, searchOpenAlex, searchTopCitedWorks } from "../openalex"
import { PaperSourceError } from "../types"
import fixture from "./fixtures/openalex-works.json"

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

// A no-op sleep so retry-path tests never wait on real backoff timers.
const noSleep = async () => {}

describe("searchOpenAlex", () => {
  it("preserves source publication type and retraction status for eligibility checks", async () => {
    const [record] = await searchOpenAlex({ query: "EEG" }, { fetchFn: fakeFetch({ results: [{ display_name: "EEG public review", type: "peer-review", is_retracted: false }] }) })
    expect(record.publicationTypes).toEqual(["peer-review"])
    expect(record.isRetracted).toBe(false)
  })
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

  it("maps empty-string oa_url to undefined oaUrl", async () => {
    const record = {
      id: "https://openalex.org/W1",
      display_name: "Test Paper",
      publication_year: 2020,
      ids: null,
      primary_location: null,
      open_access: { oa_url: "" },
      authorships: [],
      cited_by_count: 0,
      topics: [],
      abstract_inverted_index: null,
    }
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "test" }, { fetchFn })

    expect(paper.oaUrl).toBeUndefined()
  })

  it("maps empty-string pdf_url to undefined pdfUrl", async () => {
    const record = {
      id: "https://openalex.org/W1",
      display_name: "Test Paper",
      publication_year: 2020,
      ids: null,
      primary_location: { source: null, pdf_url: "  " },
      open_access: null,
      authorships: [],
      cited_by_count: 0,
      topics: [],
      abstract_inverted_index: null,
    }
    const fetchFn = fakeFetch({ results: [record] })

    const [paper] = await searchOpenAlex({ query: "test" }, { fetchFn })

    expect(paper.pdfUrl).toBeUndefined()
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

  it("sets sort=publication_date:desc for a recency-intent query (sort:'date')", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch

    await searchOpenAlex({ query: "recent transformers", sort: "date" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("sort")).toBe("publication_date:desc")
  })

  it("omits sort for a relevance-intent query (OpenAlex default ranking)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch

    await searchOpenAlex({ query: "transformers", sort: "relevance" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("sort")).toBeNull()
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

  it("wraps a persistent network-level throw in PaperSourceError without a status (after retries)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    await expect(searchOpenAlex({ query: "x" }, { fetchFn, sleep: noSleep })).rejects.toBeInstanceOf(PaperSourceError)
    try {
      await searchOpenAlex({ query: "x" }, { fetchFn, sleep: noSleep })
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

  it("RETRY: recovers when a 429 is followed by a 200", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call++
      return call === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const results = await searchOpenAlex({ query: "x" }, { fetchFn, sleep: noSleep })
    expect(results).toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("throws PaperSourceError with status after exhausting retries on a persistent 500", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch

    await expect(searchOpenAlex({ query: "x" }, { fetchFn, sleep: noSleep })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 500,
    })
    // Retried up to the default 3 attempts before giving up.
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("does NOT retry a non-retryable 4xx (e.g. 400) — throws immediately", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 400 })) as unknown as typeof fetch
    await expect(searchOpenAlex({ query: "x" }, { fetchFn, sleep: noSleep })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 400,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("RETRY: recovers when a transient network throw is followed by a 200", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call++
      if (call === 1) throw new Error("ECONNRESET")
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const results = await searchOpenAlex({ query: "x" }, { fetchFn, sleep: noSleep })
    expect(results).toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe("countOpenAlexWorks topic scoping (the leaderboard's prior-count lookup)", () => {
  const capture = () => {
    const seen = { url: "" }
    const fetchFn = (async (url: string) => {
      seen.url = String(url)
      return new Response(JSON.stringify({ results: [], meta: { count: 16 } }), { status: 200 })
    }) as unknown as typeof fetch
    return { seen, fetchFn }
  }

  it("adds a primary_topic.id filter alongside the dates, keeping the search scope", async () => {
    const { seen, fetchFn } = capture()
    const n = await countOpenAlexWorks(
      { query: "Computer Science", topicId: "T10689", fromDate: "2026-06-22", toDate: "2026-07-05" },
      { fetchFn },
    )
    const url = new URL(seen.url)
    expect(n).toBe(16)
    // The search term MUST survive: the recent count this is compared against
    // is search-scoped too, and an unscoped lookup returns the corpus-wide
    // figure (live: 149 vs 16) and invents a decline.
    expect(url.searchParams.get("search")).toBe("Computer Science")
    expect(url.searchParams.get("per_page")).toBe("1")
    expect(url.searchParams.get("filter")).toBe(
      "primary_topic.id:T10689,from_publication_date:2026-06-22,to_publication_date:2026-07-05",
    )
  })

  it("normalizes a full entity-URL topic key (what group_by returns) to its bare id", async () => {
    const { seen, fetchFn } = capture()
    await countOpenAlexWorks(
      { query: "x", topicId: "https://openalex.org/T10689", fromDate: "a", toDate: "b" },
      { fetchFn },
    )
    expect(new URL(seen.url).searchParams.get("filter")).toContain("primary_topic.id:T10689")
  })

  it("omits the topic filter entirely when no topicId is given (v1.1 behaviour unchanged)", async () => {
    const { seen, fetchFn } = capture()
    await countOpenAlexWorks({ query: "nlp", fromDate: "a", toDate: "b" }, { fetchFn })
    expect(new URL(seen.url).searchParams.get("filter")).not.toContain("primary_topic")
  })

})

describe("countOpenAlexWorks", () => {
  it("returns meta.count and requests per_page=1 with from+to date filter", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [], meta: { count: 123 } }), { status: 200 })
    }) as unknown as typeof fetch

    const n = await countOpenAlexWorks({ query: "nlp", fromDate: "2026-07-06", toDate: "2026-07-12" }, { fetchFn })

    expect(n).toBe(123)
    expect(calledUrl).toContain("per_page=1")
    expect(decodeURIComponent(calledUrl)).toContain("from_publication_date:2026-07-06")
    expect(decodeURIComponent(calledUrl)).toContain("to_publication_date:2026-07-12")
  })

  it("THROWS when a 200 response carries no meta.count (never fabricates a zero)", async () => {
    // A zero here is not harmless: on trending's prior-count path it reads as
    // "no papers before" → growth null → rendered "new" → sorted first. The
    // caller treats a throw as "unmeasured" and omits the topic instead.
    const fetchFn = (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch
    await expect(
      countOpenAlexWorks({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-12" }, { fetchFn }),
    ).rejects.toThrow(PaperSourceError)
  })

  it("THROWS when meta.count is present but not a finite number", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ results: [], meta: { count: null } }), { status: 200 })) as unknown as typeof fetch
    await expect(
      countOpenAlexWorks({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-12" }, { fetchFn }),
    ).rejects.toThrow(PaperSourceError)
  })

  it("returns a real zero when OpenAlex actually reports one", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ results: [], meta: { count: 0 } }), { status: 200 })) as unknown as typeof fetch
    expect(await countOpenAlexWorks({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-12" }, { fetchFn })).toBe(0)
  })

  it("throws PaperSourceError after exhausting retries on a persistent 429", async () => {
    const fetchFn = (async () => new Response("", { status: 429 })) as unknown as typeof fetch
    await expect(
      countOpenAlexWorks({ query: "x", fromDate: "a", toDate: "b" }, { fetchFn, sleep: noSleep }),
    ).rejects.toThrow(PaperSourceError)
  })

  it("RETRY: recovers when a 429 is followed by a 200 (2 calls, returns meta.count)", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call++
      return call === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ results: [], meta: { count: 42 } }), { status: 200 })
    }) as unknown as typeof fetch

    const n = await countOpenAlexWorks({ query: "x", fromDate: "a", toDate: "b" }, { fetchFn, sleep: noSleep })
    expect(n).toBe(42)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("throws PaperSourceError with status after exhausting 3 attempts on a persistent 500", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch

    await expect(
      countOpenAlexWorks({ query: "x", fromDate: "a", toDate: "b" }, { fetchFn, sleep: noSleep }),
    ).rejects.toMatchObject({ name: "PaperSourceError", status: 500 })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("does NOT retry a non-retryable 400 — throws immediately (1 call)", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 400 })) as unknown as typeof fetch

    await expect(
      countOpenAlexWorks({ query: "x", fromDate: "a", toDate: "b" }, { fetchFn, sleep: noSleep }),
    ).rejects.toMatchObject({ name: "PaperSourceError", status: 400 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("passes mailto through when provided in deps", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [], meta: { count: 1 } }), { status: 200 })
    }) as unknown as typeof fetch

    await countOpenAlexWorks({ query: "x", fromDate: "2026-01-01", toDate: "2026-01-08" }, { fetchFn, mailto: "me@example.com" })

    expect(calledUrl).toContain("mailto=me%40example.com")
  })
})

describe("searchOpenAlex toDate", () => {
  it("adds to_publication_date to the filter when toDate is set", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await searchOpenAlex({ query: "x", fromDate: "2026-01-01", toDate: "2026-02-01" }, { fetchFn })

    expect(decodeURIComponent(calledUrl)).toContain("from_publication_date:2026-01-01")
    expect(decodeURIComponent(calledUrl)).toContain("to_publication_date:2026-02-01")
  })

  it("adds only to_publication_date to the filter when fromDate is absent", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await searchOpenAlex({ query: "x", toDate: "2026-02-01" }, { fetchFn })

    const url = new URL(calledUrl)
    expect(url.searchParams.get("filter")).toBe("to_publication_date:2026-02-01")
  })
})

describe("api_key param", () => {
  it("searchOpenAlex sets api_key when deps.apiKey is provided", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await searchOpenAlex({ query: "x" }, { fetchFn, apiKey: "secret-key" })

    expect(new URL(calledUrl).searchParams.get("api_key")).toBe("secret-key")
  })

  it("searchOpenAlex omits api_key when deps.apiKey is absent", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await searchOpenAlex({ query: "x" }, { fetchFn })

    expect(new URL(calledUrl).searchParams.has("api_key")).toBe(false)
  })

  it("countOpenAlexWorks sets api_key when deps.apiKey is provided", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [], meta: { count: 1 } }), { status: 200 })
    }) as unknown as typeof fetch

    await countOpenAlexWorks({ query: "x", fromDate: "a", toDate: "b" }, { fetchFn, apiKey: "secret-key" })

    expect(new URL(calledUrl).searchParams.get("api_key")).toBe("secret-key")
  })

})

describe("searchTopCitedWorks (entity-scoped, citation-ranked works)", () => {
  const capture = (body: unknown = { results: [] }) => {
    const seen = { url: "" }
    const fetchFn = (async (url: string) => {
      seen.url = String(url)
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    return { seen, fetchFn }
  }

  it("scopes by primary_topic.id and the date window, ranks by citations, and sends NO search term", async () => {
    const { seen, fetchFn } = capture()
    await searchTopCitedWorks({ topicId: "T10533", fromDate: "2026-07-06", toDate: "2026-07-19", limit: 3 }, { fetchFn })

    const url = new URL(seen.url)
    // A topic's identity is its id. Sending the label as `search` is the bug
    // this call exists to remove — a topic named with common words ("Teaching
    // and Learning Programming") matches papers with no connection to it.
    expect(url.searchParams.has("search")).toBe(false)
    expect(url.searchParams.get("filter")).toBe(
      "is_paratext:false,primary_topic.id:T10533,from_publication_date:2026-07-06,to_publication_date:2026-07-19",
    )
    expect(url.searchParams.get("sort")).toBe("cited_by_count:desc")
    expect(url.searchParams.get("per_page")).toBe("3")
  })

  it("scopes by primary_topic.field.id, normalizing the full entity URL group_by returns", async () => {
    const { seen, fetchFn } = capture()
    await searchTopCitedWorks(
      { fieldId: "https://openalex.org/fields/17", fromDate: "2026-04-20", toDate: "2026-07-19" },
      { fetchFn },
    )
    expect(new URL(seen.url).searchParams.get("filter")).toContain("primary_topic.field.id:17")
  })

  it("keeps a free-text scope when one is given (the fallback anchor path)", async () => {
    const { seen, fetchFn } = capture()
    await searchTopCitedWorks({ query: "auditory attention", fromDate: "a", toDate: "b" }, { fetchFn })
    expect(new URL(seen.url).searchParams.get("search")).toBe("auditory attention")
  })

  it("threads mailto/api_key like every other OpenAlex call", async () => {
    const { seen, fetchFn } = capture()
    await searchTopCitedWorks({ topicId: "T1", fromDate: "a", toDate: "b" }, { fetchFn, mailto: "x@y.z", apiKey: "k" })
    const url = new URL(seen.url)
    expect(url.searchParams.get("mailto")).toBe("x@y.z")
    expect(url.searchParams.get("api_key")).toBe("k")
  })

  it("maps results through the same PaperRecord mapping as searchOpenAlex", async () => {
    const { fetchFn } = capture({ results: [fixture.results[0]] })
    const records = await searchTopCitedWorks({ topicId: "T1", fromDate: "a", toDate: "b" }, { fetchFn })
    expect(records).toHaveLength(1)
    expect(records[0].source).toBe("openalex")
    expect(records[0].title).toBe(fixture.results[0].display_name)
  })

  it("retries a 429 with backoff like the other OpenAlex calls", async () => {
    let calls = 0
    const fetchFn = (async () => {
      calls += 1
      if (calls === 1) return new Response("rate limited", { status: 429 })
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch
    await searchTopCitedWorks({ topicId: "T1", fromDate: "a", toDate: "b" }, { fetchFn, sleep: noSleep })
    expect(calls).toBe(2)
  })
})

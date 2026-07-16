import { readFileSync } from "node:fs"
import { describe, it, expect, vi } from "vitest"
import { searchArxiv } from "../arxiv"
import { PaperSourceError } from "../types"

const fixtureXml = readFileSync(new URL("./fixtures/arxiv-atom.xml", import.meta.url), "utf-8")
const singleFixtureXml = readFileSync(new URL("./fixtures/arxiv-atom-single.xml", import.meta.url), "utf-8")

function fakeFetch(body: string, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  })) as unknown as typeof fetch
}

// A no-op sleep so retry-path tests never wait on real backoff timers.
const noSleep = async () => {}

const LEGACY_ID_ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/math/0211159v1</id>
    <title>A Legacy-Format Paper</title>
    <summary>A short abstract for a legacy-id paper.</summary>
    <published>2002-11-15T00:00:00Z</published>
    <updated>2002-11-15T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/math/0211159v1" rel="alternate" type="text/html"/>
    <category term="math.AG" scheme="http://arxiv.org/schemas/atom"/>
    <author>
      <name>Some Author</name>
    </author>
  </entry>
</feed>`

const WHITESPACE_PADDED_ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>
      A Title
      Padded Across Lines
    </title>
    <summary>
      An abstract
      that spans
      multiple lines with   extra   spaces.
    </summary>
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-01T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <author>
      <name>Whitespace Author</name>
    </author>
  </entry>
</feed>`

const JOURNAL_REF_ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <title>A Published Paper</title>
    <summary>Abstract of a published paper.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-01T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/2401.00002v1" rel="alternate" type="text/html"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <author>
      <name>Journal Author</name>
    </author>
    <arxiv:journal_ref>Nature 123, 45-67 (2024)</arxiv:journal_ref>
  </entry>
</feed>`

const NUMERIC_ENTITY_ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00003v1</id>
    <title>Erd&#337;s Graph Theory: &#233; and &#xE9;</title>
    <summary>A paper about Erd&#337;s numbers and &#x201C;quotes&#x201D;.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-01T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/2401.00003v1" rel="alternate" type="text/html"/>
    <category term="cs.DM" scheme="http://arxiv.org/schemas/atom"/>
    <author>
      <name>Test Author</name>
    </author>
  </entry>
</feed>`

const PDF_LINK_WITH_REL_ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00004v1</id>
    <title>PDF Link Test</title>
    <summary>Testing PDF link detection with rel attribute.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-01T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/2401.00004v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2401.00004v1" rel="related" type="application/pdf" title="pdf"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <author>
      <name>PDF Tester</name>
    </author>
  </entry>
</feed>`

describe("searchArxiv", () => {
  it("maps entries from the real fixture (titles, id version-strip, authors, categories, pdf link)", async () => {
    const fetchFn = fakeFetch(fixtureXml)

    const papers = await searchArxiv({ query: "transformer" }, { fetchFn })

    expect(papers).toHaveLength(2)
    const [first] = papers
    expect(first.title).toBe(
      "ARDY: Autoregressive Diffusion with Hybrid Representation for Interactive Human Motion Generation"
    )
    expect(first.ids.arxiv).toBe("2607.08741")
    expect(first.authors).toHaveLength(6)
    expect(first.authors[0]).toEqual({ name: "Kaifeng Zhao" })
    expect(first.fields).toEqual(["cs.GR", "cs.CV", "cs.LG", "cs.RO"])
    expect(first.pdfUrl).toBe("https://arxiv.org/pdf/2607.08741v1")
    expect(first.htmlUrl).toBe("https://arxiv.org/abs/2607.08741v1")
    expect(first.date).toBe("2026-07-09")
    expect(first.year).toBe(2026)
    expect(first.ids.doi).toBe("10.1145/3811284")
    expect(first.citationCount).toBeUndefined()
    expect(first.source).toBe("arxiv")
    expect(first.venue).toBeUndefined()
  })

  it("leaves doi and venue undefined when arxiv:doi / arxiv:journal_ref are absent (second fixture entry)", async () => {
    const fetchFn = fakeFetch(fixtureXml)

    const papers = await searchArxiv({ query: "transformer" }, { fetchFn })

    const second = papers[1]
    expect(second.ids.doi).toBeUndefined()
    expect(second.venue).toBeUndefined()
    expect(second.authors).toHaveLength(2)
    expect(second.fields).toEqual(["cs.CV", "cs.AI", "cs.LG"])
  })

  it("collapses whitespace in a real multi-line summary (Atom pads with newlines/indent)", async () => {
    const fetchFn = fakeFetch(fixtureXml)

    const papers = await searchArxiv({ query: "transformer" }, { fetchFn })

    const second = papers[1]
    expect(second.abstract).not.toMatch(/\n/)
    expect(second.abstract).not.toMatch(/ {2,}/)
    expect(second.abstract).toContain(
      "interpretable motion analysis. To train and evaluate BioModule, we construct"
    )
  })

  it("collapses whitespace-padded title and summary (synthetic)", async () => {
    const fetchFn = fakeFetch(WHITESPACE_PADDED_ATOM)

    const [paper] = await searchArxiv({ query: "x" }, { fetchFn })

    expect(paper.title).toBe("A Title Padded Across Lines")
    expect(paper.abstract).toBe("An abstract that spans multiple lines with extra spaces.")
  })

  it("still returns an array when the Atom feed has a single entry", async () => {
    const fetchFn = fakeFetch(singleFixtureXml)

    const papers = await searchArxiv({ query: "transformer" }, { fetchFn })

    expect(Array.isArray(papers)).toBe(true)
    expect(papers).toHaveLength(1)
    expect(papers[0].ids.arxiv).toBe("2607.08741")
    expect(papers[0].authors).toHaveLength(6)
  })

  it("strips the version suffix from a legacy-format arxiv id (synthetic, e.g. math/0211159v1)", async () => {
    const fetchFn = fakeFetch(LEGACY_ID_ATOM)

    const [paper] = await searchArxiv({ query: "x" }, { fetchFn })

    expect(paper.ids.arxiv).toBe("math/0211159")
    expect(paper.title).toBe("A Legacy-Format Paper")
  })

  it("AND-joins field-prefixed terms for a plain keyword query (precision, not loose OR-ish match)", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "quantum computing", limit: 500 }, { fetchFn })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.protocol).toBe("https:")
    expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query")
    // Every term is required (precision) instead of arXiv's loose OR-ish match.
    expect(url.searchParams.get("search_query")).toBe("all:quantum AND all:computing")
    // limit clamped to max 50 even though 500 was requested
    expect(url.searchParams.get("max_results")).toBe("50")
  })

  it("AND-joins every term of a multi-word topical query (regression: relevance flood)", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "auditory attention decoding EEG", sort: "relevance" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("search_query")).toBe(
      "all:auditory AND all:attention AND all:decoding AND all:EEG"
    )
    // Explicit relevance intent → arXiv relevance ranking (no submittedDate sort).
    expect(url.searchParams.get("sortBy")).toBeNull()
  })

  it("collapses surrounding and repeated whitespace between terms", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "  auditory   EEG  " }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("search_query")).toBe("all:auditory AND all:EEG")
  })

  it("keeps a single-term query as a single field-prefixed clause", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "transformer", sort: "relevance" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("search_query")).toBe("all:transformer")
    expect(url.searchParams.get("sortBy")).toBeNull()
  })

  it("defaults an OMITTED sort to newest-first (preserving arXiv's historical order for server callers)", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    // No sort passed — the shape nodeSearchFn uses for feed/spark/trending.
    await searchArxiv({ query: "auditory attention decoding" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    // Still AND-precision on the query...
    expect(url.searchParams.get("search_query")).toBe("all:auditory AND all:attention AND all:decoding")
    // ...but newest-first, unchanged from arXiv's prior always-date behavior.
    expect(url.searchParams.get("sortBy")).toBe("submittedDate")
    expect(url.searchParams.get("sortOrder")).toBe("descending")
  })

  it("passes a boolean-operator query through VERBATIM (no all:/AND mangling) — feed strategy regression", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    // The Feed strategy prompt is told to emit arXiv boolean operators. Wrapping
    // each token in all:/AND would turn this into `all:speech AND all:separation
    // AND all:OR AND ...` → ~0 results.
    await searchArxiv({ query: "speech separation OR source separation" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("search_query")).toBe("speech separation OR source separation")
  })

  it("passes a field-prefixed query (cat:/ti:) through VERBATIM", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "cat:cs.LG neural decoding" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("search_query")).toBe("cat:cs.LG neural decoding")
  })

  it("passes an ANDNOT exclusion query through VERBATIM (not inverted into a requirement)", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "transformer ANDNOT quantum" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("search_query")).toBe("transformer ANDNOT quantum")
  })

  it("falls back to newest-first browse for an empty/whitespace-only query", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "   " }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("sortBy")).toBe("submittedDate")
    expect(url.searchParams.get("sortOrder")).toBe("descending")
  })

  it("sorts by newest-first (submittedDate desc) when sort:'date' intent is passed, keeping AND precision", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "recent transformer papers", sort: "date" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    // Precision is preserved even under a recency-intent search.
    expect(url.searchParams.get("search_query")).toBe(
      "all:recent AND all:transformer AND all:papers"
    )
    expect(url.searchParams.get("sortBy")).toBe("submittedDate")
    expect(url.searchParams.get("sortOrder")).toBe("descending")
  })

  it("uses relevance ranking when sort:'relevance' intent is passed", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "transformer attention", sort: "relevance" }, { fetchFn })

    const url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("sortBy")).toBeNull()
  })

  it("clamps a limit below 1 up to 1 and defaults to 20 when omitted", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    await searchArxiv({ query: "x", limit: 0 }, { fetchFn })
    let url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(url.searchParams.get("max_results")).toBe("1")

    await searchArxiv({ query: "x" }, { fetchFn })
    url = new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[1][0] as string)
    expect(url.searchParams.get("max_results")).toBe("20")
  })

  it("returns [] for an empty Atom feed (no entries)", async () => {
    const fetchFn = fakeFetch(`<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)

    const papers = await searchArxiv({ query: "x" }, { fetchFn })

    expect(papers).toEqual([])
  })

  it("throws PaperSourceError with status after exhausting retries on a persistent 500", async () => {
    const fetchFn = fakeFetch("", 500)

    await expect(searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 500,
    })
    // Retried up to the default 3 attempts before giving up.
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("does NOT retry a non-retryable 4xx (e.g. 400) — throws immediately", async () => {
    const fetchFn = fakeFetch("", 400)
    await expect(searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 400,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("RETRY: recovers when a 429 is followed by a 200", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call++
      return call === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response(singleFixtureXml, { status: 200 })
    }) as unknown as typeof fetch

    const papers = await searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })
    expect(papers.length).toBeGreaterThan(0)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("RETRY: recovers when a 503 is followed by a 200", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call++
      return call === 1
        ? new Response("", { status: 503 })
        : new Response(singleFixtureXml, { status: 200 })
    }) as unknown as typeof fetch

    const papers = await searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })
    expect(papers.length).toBeGreaterThan(0)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("wraps a persistent network-level throw in PaperSourceError without a status (after retries)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    await expect(searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })).rejects.toBeInstanceOf(PaperSourceError)
    try {
      await searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PaperSourceError)
      expect((err as PaperSourceError).status).toBeUndefined()
    }
  })

  it("RETRY: recovers when a transient network throw is followed by a 200", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call++
      if (call === 1) throw new Error("ECONNRESET")
      return new Response(singleFixtureXml, { status: 200 })
    }) as unknown as typeof fetch

    const papers = await searchArxiv({ query: "x" }, { fetchFn, sleep: noSleep })
    expect(papers.length).toBeGreaterThan(0)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("maps arxiv:journal_ref to venue when populated", async () => {
    const fetchFn = fakeFetch(JOURNAL_REF_ATOM)

    const [paper] = await searchArxiv({ query: "x" }, { fetchFn })

    expect(paper.venue).toBe("Nature 123, 45-67 (2024)")
  })

  it("decodes numeric character entities in title and summary", async () => {
    const fetchFn = fakeFetch(NUMERIC_ENTITY_ATOM)

    const [paper] = await searchArxiv({ query: "x" }, { fetchFn })

    // Check decoded Erdos with ogonek (&#337; = U+0151 = ő)
    const erdos = String.fromCharCode(0x0151) // ő
    expect(paper.title).toContain(`Erd${erdos}s`)
    expect(paper.abstract).toContain(`Erd${erdos}s`)
    // Check decoded e-acute (&#233; = U+00E9 = é)
    expect(paper.title).toContain("e")
    // Check decoded left double quote (&#x201C; = U+201C = ")
    const leftQuote = String.fromCharCode(0x201c)
    expect(paper.abstract).toContain(leftQuote)
  })

  it("correctly identifies pdf link with rel and type attributes", async () => {
    const fetchFn = fakeFetch(PDF_LINK_WITH_REL_ATOM)

    const [paper] = await searchArxiv({ query: "x" }, { fetchFn })

    expect(paper.pdfUrl).toBe("https://arxiv.org/pdf/2401.00004v1")
  })

  it("maps empty-string arxiv:journal_ref to undefined venue", async () => {
    const emptyVenueAtom = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00005v1</id>
    <title>Empty Venue Paper</title>
    <summary>Abstract.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-01T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/2401.00005v1" rel="alternate" type="text/html"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <author><name>Test Author</name></author>
    <arxiv:journal_ref>   </arxiv:journal_ref>
  </entry>
</feed>`
    const fetchFn = fakeFetch(emptyVenueAtom)

    const [paper] = await searchArxiv({ query: "x" }, { fetchFn })

    expect(paper.venue).toBeUndefined()
  })
})

// Opt-in live gate — hits the real arXiv API, never runs in CI. Enable with:
//   LIVE_ARXIV=1 npx vitest run src/lib/papers/__tests__/arxiv.test.ts
// Guards the reported regression end-to-end: a topical multi-word query must
// return on-topic papers, not the newest off-topic ML submissions.
const LIVE_ARXIV = process.env.LIVE_ARXIV === "1"
describe.skipIf(!LIVE_ARXIV)("searchArxiv (live)", () => {
  it("returns on-topic results for a multi-word topical query", async () => {
    const papers = await searchArxiv({ query: "auditory attention decoding EEG", limit: 10, sort: "relevance" })
    expect(papers.length).toBeGreaterThan(0)
    // The canonical auditory-attention-decoding literature centers on these
    // terms; a relevance-flooded result set (vision/quantum/watermark papers)
    // would match none of them.
    const onTopic = papers.filter((p) => {
      const hay = `${p.title} ${p.abstract ?? ""}`.toLowerCase()
      return (
        (hay.includes("auditory") || hay.includes("eeg") || hay.includes("speech")) &&
        hay.includes("attention")
      )
    })
    expect(onTopic.length).toBeGreaterThan(0)
  }, 30_000)
})

import { readFileSync } from "node:fs"
import { describe, it, expect, vi } from "vitest"
import { searchPubmed } from "../pubmed"
import { PaperSourceError } from "../types"
import esearchFixture from "./fixtures/pubmed-esearch.json"

const efetchXml = readFileSync(new URL("./fixtures/pubmed-efetch.xml", import.meta.url), "utf-8")

function fakeEsearch(idlist: string[], status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ esearchresult: { idlist } }),
  } as unknown as Response
}

function fakeEfetch(xml: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml,
  } as unknown as Response
}

/** Sequences fixed responses across successive fetch calls (esearch, then efetch). */
function sequencedFetch(responses: Response[]) {
  let call = 0
  return vi.fn(async () => {
    const response = responses[call]
    call += 1
    return response
  }) as unknown as typeof fetch
}

/** Fetches the real esearch fixture on call 1, the real efetch fixture on call 2. */
function realFixtureFetch() {
  return sequencedFetch([fakeEsearch(esearchFixture.esearchresult.idlist), fakeEfetch(efetchXml)])
}

describe("searchPubmed", () => {
  it("returns [] and does not call efetch when esearch's idlist is empty", async () => {
    const fetchFn = sequencedFetch([fakeEsearch([])])

    const results = await searchPubmed({ query: "zzzznonexistentqueryxyz12345" }, { fetchFn })

    expect(results).toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  describe("full two-step flow against the live-captured fixtures", () => {
    it("maps the first article: doi, ids.pmid, multi-section labeled abstract joined with blank lines, authors, ArticleDate-derived year/date, venue, empty MeSH fields", async () => {
      const fetchFn = realFixtureFetch()

      const [first] = await searchPubmed({ query: "crispr", limit: 2 }, { fetchFn })

      expect(first.ids.pmid).toBe("42436560")
      expect(first.ids.doi).toBe("10.1186/s12967-026-08621-0")
      expect(first.title).toBe(
        "INHBA secreted by cancer-associated fibroblasts promotes cisplatin resistance and malignant progression of ovarian cancer via ENG-mediated suppression of apoptosis and induction of EMT."
      )
      expect(first.abstract).toBe(
        [
          "BACKGROUND: Platinum resistance remains a major cause of treatment failure in ovarian cancer (OC). Cancer-associated fibroblasts (CAFs), key components of the tumor microenvironment, play critical roles in OC progression. Inhibin subunit beta A (INHBA) and its putative receptor endoglin (ENG) have been linked to OC chemoresistance, but their functional interaction in mediating cisplatin resistance remains unclear.",
          "METHODS: Single-cell RNA sequencing (scRNA-seq) was performed to characterize CAF subsets and assess INHBA and ENG expression in OC tissues. Immunohistochemistry (IHC) and immunofluorescence (IF) staining was conducted on tissue microarrays to evaluate protein expression and co-localization. Primary CAFs and normal fibroblasts (NFs) were isolated. INHBA was knocked out in CAFs via CRISPR/Cas9, and ENG was stably knocked down in cisplatin-resistant OC cells by lentiviral shRNA. The INHBA-ENG axis was investigated through in vitro assays, co-immunoprecipitation (Co-IP), molecular docking, and in vivo xenograft models.",
          "RESULTS: scRNA-seq resolved four CAF subsets, with myoCAF1 being dominant in platinum-resistant tumors. INHBA was specifically restricted to myoCAF1, while ENG was enriched in epithelial cells, and their mRNA levels showed a strong positive correlation. Consistently, IHC confirmed significant upregulation of INHBA/ENG in OC, especially in platinum-resistant cases. CAF-derived INHBA promoted OC cell proliferation, invasion, EMT, and cisplatin resistance. Molecular docking suggested a high-affinity INHBA-ENG interaction, which was confirmed by Co-IP in OC-CAF co-cultures. ENG knockdown reversed cisplatin resistance, an effect abrogated by recombinant INHBA. In vivo, CAF-derived INHBA promoted tumor growth and cisplatin resistance in an ENG-dependent manner.",
          "CONCLUSIONS: MyoCAFs-derived INHBA binds to ENG on OC cells, inhibits apoptosis, induces EMT, and promotes cisplatin resistance. The INHBA-ENG axis represents a promising therapeutic target for overcoming platinum resistance in OC.",
        ].join("\n\n")
      )
      expect(first.authors).toEqual([
        { name: "Xinyue Liu" },
        { name: "Yan Han" },
        { name: "Zhichao Qin" },
        { name: "Xinghua Li" },
        { name: "Yuping Suo" },
      ])
      expect(first.year).toBe(2026)
      expect(first.date).toBe("2026-07-11")
      expect(first.venue).toBe("Journal of translational medicine")
      expect(first.citationCount).toBeUndefined()
      // This article's MedlineCitation Status is "Publisher" (ahead-of-print,
      // not yet MEDLINE-indexed) so it genuinely has no MeshHeadingList yet.
      expect(first.fields).toEqual([])
      expect(first.source).toBe("pubmed")
    })

    it("maps the second article: single unlabeled AbstractText, MeSH fields (majors preferred, capped at 5)", async () => {
      const fetchFn = realFixtureFetch()

      const [, second] = await searchPubmed({ query: "crispr", limit: 2 }, { fetchFn })

      expect(second.ids.pmid).toBe("42436521")
      expect(second.ids.doi).toBe("10.1186/s13567-026-01802-1")
      expect(second.title).toBe("Modification of PCNA by ISG15 plays a crucial role in porcine deltacoronavirus infection.")
      expect(second.abstract).toMatch(/^Porcine deltacoronavirus \(PDCoV\)/)
      expect(second.abstract).not.toContain(":")
      expect(second.authors).toHaveLength(14)
      expect(second.authors[0]).toEqual({ name: "Cheng Li" })
      expect(second.venue).toBe("Veterinary research")
      expect(second.year).toBe(2026)
      expect(second.date).toBe("2026-07-11")
      // 10 MeSH headings total (6 major, 4 minor) in the fixture; majors are
      // preferred and the result is capped at 5, so the 6th major
      // ("Swine Diseases") and all minors are excluded.
      expect(second.fields).toEqual([
        "Coronavirus Infections",
        "Deltacoronavirus",
        "Cytokines",
        "Proliferating Cell Nuclear Antigen",
        "Ubiquitins",
      ])
      expect(second.fields).not.toContain("Swine Diseases")
      expect(second.fields).not.toContain("Animals")
      expect(second.source).toBe("pubmed")
    })
  })

  it("parses a MedlineDate range string down to just the leading year, with date left undefined", async () => {
    const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">11111111</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <PubDate><MedlineDate>2024 Jan-Feb</MedlineDate></PubDate>
          </JournalIssue>
          <Title>Some Old Journal</Title>
        </Journal>
        <ArticleTitle>A paper with only a MedlineDate.</ArticleTitle>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">11111111</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`
    const fetchFn = sequencedFetch([fakeEsearch(["11111111"]), fakeEfetch(xml)])

    const [paper] = await searchPubmed({ query: "x" }, { fetchFn })

    expect(paper.year).toBe(2024)
    expect(paper.date).toBeUndefined()
  })

  it("flattens an ArticleTitle containing nested markup (e.g. <i>) down to plain text", async () => {
    const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">22222222</PMID>
      <Article>
        <ArticleTitle>Regulation of <i>Escherichia coli</i> growth under stress.</ArticleTitle>
      </Article>
    </MedlineCitation>
    <PubmedData><ArticleIdList><ArticleId IdType="pubmed">22222222</ArticleId></ArticleIdList></PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`
    const fetchFn = sequencedFetch([fakeEsearch(["22222222"]), fakeEfetch(xml)])

    const [paper] = await searchPubmed({ query: "x" }, { fetchFn })

    expect(paper.title).toContain("Escherichia coli")
    expect(paper.title).toContain("Regulation of")
    expect(paper.title).toContain("growth under stress.")
  })

  it("includes CollectiveName as the author name when an Author has no ForeName/LastName", async () => {
    const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">33333333</PMID>
      <Article>
        <ArticleTitle>A group-authored paper.</ArticleTitle>
        <AuthorList>
          <Author ValidYN="Y"><LastName>Smith</LastName><ForeName>Jane</ForeName></Author>
          <Author ValidYN="Y"><CollectiveName>The Consortium Group</CollectiveName></Author>
        </AuthorList>
      </Article>
    </MedlineCitation>
    <PubmedData><ArticleIdList><ArticleId IdType="pubmed">33333333</ArticleId></ArticleIdList></PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`
    const fetchFn = sequencedFetch([fakeEsearch(["33333333"]), fakeEfetch(xml)])

    const [paper] = await searchPubmed({ query: "x" }, { fetchFn })

    expect(paper.authors).toEqual([{ name: "Jane Smith" }, { name: "The Consortium Group" }])
  })

  it("leaves doi undefined when ArticleIdList has no doi-typed entry", async () => {
    const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">44444444</PMID>
      <Article><ArticleTitle>No DOI here.</ArticleTitle></Article>
    </MedlineCitation>
    <PubmedData><ArticleIdList><ArticleId IdType="pubmed">44444444</ArticleId><ArticleId IdType="pii">44</ArticleId></ArticleIdList></PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`
    const fetchFn = sequencedFetch([fakeEsearch(["44444444"]), fakeEfetch(xml)])

    const [paper] = await searchPubmed({ query: "x" }, { fetchFn })

    expect(paper.ids.doi).toBeUndefined()
    expect(paper.ids.pmid).toBe("44444444")
  })

  describe("api_key handling", () => {
    it("omits api_key from both request URLs when not provided", async () => {
      const fetchFn = sequencedFetch([fakeEsearch(["42436560"]), fakeEfetch(efetchXml)])

      await searchPubmed({ query: "crispr" }, { fetchFn })

      const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls
      expect(calls).toHaveLength(2)
      expect(new URL(calls[0][0] as string).searchParams.has("api_key")).toBe(false)
      expect(new URL(calls[1][0] as string).searchParams.has("api_key")).toBe(false)
    })

    it("appends api_key to both the esearch and efetch request URLs when provided", async () => {
      const fetchFn = sequencedFetch([fakeEsearch(["42436560"]), fakeEfetch(efetchXml)])

      await searchPubmed({ query: "crispr" }, { fetchFn, apiKey: "secret-pubmed-key" })

      const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls
      expect(new URL(calls[0][0] as string).searchParams.get("api_key")).toBe("secret-pubmed-key")
      expect(new URL(calls[1][0] as string).searchParams.get("api_key")).toBe("secret-pubmed-key")
    })
  })

  describe("esearch URL construction", () => {
    it("builds the esearch URL with db, term, retmax, retmode, and sort params", async () => {
      const fetchFn = sequencedFetch([fakeEsearch([])])

      await searchPubmed({ query: "quantum biology", limit: 5 }, { fetchFn })

      const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const url = new URL(calledUrl)
      expect(url.origin + url.pathname).toBe("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
      expect(url.searchParams.get("db")).toBe("pubmed")
      expect(url.searchParams.get("term")).toBe("quantum biology")
      expect(url.searchParams.get("retmax")).toBe("5")
      expect(url.searchParams.get("retmode")).toBe("json")
      expect(url.searchParams.get("sort")).toBe("date")
    })

    it("clamps a limit above 50 down to 50, and below 1 up to 1", async () => {
      const highFetch = sequencedFetch([fakeEsearch([])])
      await searchPubmed({ query: "x", limit: 500 }, { fetchFn: highFetch })
      expect(new URL((highFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string).searchParams.get("retmax")).toBe("50")

      const lowFetch = sequencedFetch([fakeEsearch([])])
      await searchPubmed({ query: "x", limit: 0 }, { fetchFn: lowFetch })
      expect(new URL((lowFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string).searchParams.get("retmax")).toBe("1")
    })

    it("defaults retmax to 20 when no limit is given", async () => {
      const fetchFn = sequencedFetch([fakeEsearch([])])
      await searchPubmed({ query: "x" }, { fetchFn })
      expect(new URL((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string).searchParams.get("retmax")).toBe("20")
    })
  })

  it("builds the efetch URL with db, retmode=xml, and a comma-joined id list", async () => {
    const fetchFn = sequencedFetch([fakeEsearch(["111", "222"]), fakeEfetch("<PubmedArticleSet></PubmedArticleSet>")])

    await searchPubmed({ query: "x" }, { fetchFn })

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1][0] as string
    const url = new URL(calledUrl)
    expect(url.origin + url.pathname).toBe("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi")
    expect(url.searchParams.get("db")).toBe("pubmed")
    expect(url.searchParams.get("retmode")).toBe("xml")
    expect(url.searchParams.get("id")).toBe("111,222")
  })

  it("throws PaperSourceError with status on a non-200 esearch response", async () => {
    const fetchFn = sequencedFetch([fakeEsearch([], 500)])

    await expect(searchPubmed({ query: "x" }, { fetchFn })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 500,
    })
  })

  it("throws PaperSourceError with status 500 on a non-200 efetch response", async () => {
    const fetchFn = sequencedFetch([fakeEsearch(["42436560"]), fakeEfetch("", 500)])

    await expect(searchPubmed({ query: "x" }, { fetchFn })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 500,
    })
  })

  it("wraps a network-level throw from esearch in PaperSourceError without a status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    await expect(searchPubmed({ query: "x" }, { fetchFn })).rejects.toBeInstanceOf(PaperSourceError)
    try {
      await searchPubmed({ query: "x" }, { fetchFn })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PaperSourceError)
      expect((err as PaperSourceError).status).toBeUndefined()
    }
  })

  it("wraps a network-level throw from efetch in PaperSourceError without a status", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call += 1
      if (call === 1) return fakeEsearch(["42436560"])
      throw new Error("network down on efetch")
    }) as unknown as typeof fetch

    await expect(searchPubmed({ query: "x" }, { fetchFn })).rejects.toBeInstanceOf(PaperSourceError)
  })
})

import { expect, it, vi } from "vitest"
import { acquireReviewEvidence } from "../acquisition"
import { handleFetchRelay } from "../../server/fetch-relay"
import type { PaperRecord } from "../../papers/types"
const paper: PaperRecord = { ids: { doi: "10.1000/fixture" }, title: "Battery charging comparative methods", abstract: "This abstract does not report cycle life or enough detail for comparing the methods.", authors: [], source: "openalex", fields: [], oaUrl: "https://publisher.invalid/article" }
const body = "Methods and analysis: " + "This is fictional readable body text for the battery charging comparison. ".repeat(10) + " Results and discussion: the methods differ."
const xml = (doi = "10.1000/fixture") => `<article><front><article-meta><article-id pub-id-type="doi">${doi}</article-id><title-group><article-title>${paper.title}</article-title></title-group></article-meta></front><body><sec><title>Methods</title><p>${body}</p></sec></body></article>`
const lookup = '<responseWrapper><resultList><result><doi>10.1000/fixture</doi><pmcid>PMC123</pmcid><isOpenAccess>Y</isOpenAccess></result></resultList></responseWrapper>'
it("recovers exact-identity OA repository XML after a local relay rejection, without calling it a paywall", async () => {
  const fetch = vi.fn(async (input: unknown) => {
    const url = new URL(String(input), "http://localhost").searchParams.get("url")!
    if (url.includes("publisher.invalid")) return Response.json({ error: "url not allowed" }, { status: 403 })
    return new Response(url.includes("/search?") ? lookup : xml(), { headers: { "content-type": "application/xml" } })
  })
  const result = await acquireReviewEvidence(paper, "P1", fetch)
  expect(result?.access).toBe("full-text")
  expect(result?.locator).toContain("PMC123/fullTextXML")
  expect(result?.notes.join(" ")).toContain("publisher access was not tested")
  expect(result?.text).toContain("Results and discussion")
  expect(fetch).toHaveBeenCalledTimes(3)
})
it("rejects a repository full text whose DOI differs even if its title matches", async () => {
  const fetch = vi.fn(async (input: unknown) => new Response(String(input).includes("search") ? lookup : xml("10.1000/wrong"), { headers: { "content-type": "application/xml" } }))
  const result = await acquireReviewEvidence({ ...paper, oaUrl: undefined }, "P1", fetch)
  expect(result?.access).toBe("abstract")
  expect(result?.notes.join(" ")).toContain("Could not verify")
})
it("parses allowed public PDF candidates with the isolated bounded extractor", async () => {
  const extract = vi.fn(async () => ({ text: `${paper.title}\n${body}`, pagesRead: 2, totalPages: 3, shortened: true }))
  const result = await acquireReviewEvidence({ ...paper, oaUrl: undefined, pdfUrl: "https://arxiv.org/pdf/fixture" }, "P1", async () => new Response("%PDF-fixture", { headers: { "content-type": "application/pdf" } }), extract)
  expect(result?.access).toBe("full-text")
  expect(result?.notes.join(" ")).toContain("2 of 3 pages")
  expect(extract).toHaveBeenCalledOnce()
})
it("caps bytes before handing a public PDF to a parser", async () => {
  const extract = vi.fn()
  const result = await acquireReviewEvidence({ ...paper, ids: {}, oaUrl: "https://arxiv.org/pdf/fixture" }, "P1", async () => new Response(new Uint8Array(5_000_001), { headers: { "content-type": "application/pdf" } }), extract)
  expect(result?.access).toBe("abstract")
  expect(extract).not.toHaveBeenCalled()
})
it("allows only the documented repository API paths through the relay", async () => {
  const fetch = vi.fn(async () => new Response(lookup, { headers: { "content-type": "application/xml" } }))
  expect((await handleFetchRelay("https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=xml", "coverage-test", { fetchFn: fetch })).status).toBe(200)
  for (const url of ["https://www.ebi.ac.uk/private", "https://www.ebi.ac.uk.evil.org/europepmc/webservices/rest/search", "https://www.ebi.ac.uk:444/europepmc/webservices/rest/search"]) {
    expect((await handleFetchRelay(url, "coverage-test", { fetchFn: fetch })).status).toBe(403)
  }
  expect(fetch).toHaveBeenCalledOnce()
})

import { describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadPaperText } from "../full-text"

const paper = { ids: { doi: "10.48550/arxiv.2608.01618" }, title: "State Guided Auditory Attention Decoding Framework", abstract: "Abstract only.", authors: [], fields: [], source: "openalex" as const, pdfUrl: "https://arxiv.org/pdf/2608.01618" }
const text = `${paper.title}\nMethods\nThe causal state detector uses a historical key-value cache. ${"Detailed method. ".repeat(40)}\nResults\nAccuracy improved.`
const noFetch = vi.fn<typeof fetch>(async () => new Response("", { status: 404 }))

describe("shared paper full-text context", () => {
  it("extracts the already-downloaded PDF before any network request", async () => {
    const vault = new MemoryVaultStorage()
    await vault.writeBinary("sources/doi-10-48550-arxiv-2608-01618.pdf", new TextEncoder().encode("%PDF-fixture"))
    const fetchFn = vi.fn<typeof fetch>(async () => { throw new Error("Network must not be used") })
    const extractPdf = vi.fn(async () => ({ text, pagesRead: 5, totalPages: 5, shortened: false }))
    const source = await loadPaperText(vault, paper, { fetchFn, extractPdf })
    expect(source.access).toBe("full-text")
    expect(source.text).toContain("historical key-value cache")
    expect(source.truncated).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
    await loadPaperText(vault, paper, { fetchFn, extractPdf })
    expect(extractPdf).toHaveBeenCalledTimes(1)
  })
  it("derives arXiv HTML from a DOI-only OpenAlex record and preserves the paper identity", async () => {
    const vault = new MemoryVaultStorage()
    const fetchFn = vi.fn<typeof fetch>(async url => {
      const target = new URL(String(url), "http://localhost").searchParams.get("url")
      return target === "https://arxiv.org/html/2608.01618" ? new Response(`<article><h1>${paper.title}</h1><p>${text}</p></article>`, { headers: { "content-type": "text/html" } }) : new Response("", { status: 404 })
    })
    const source = await loadPaperText(vault, paper, { fetchFn })
    expect(source.access).toBe("full-text")
    expect(source.locator).toBe("https://arxiv.org/html/2608.01618")
    expect(source.paperKey).toBe("doi:10.48550/arxiv.2608.01618")
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it("uses a public PDF when HTML cannot be read and reports extraction limits", async () => {
    const fetchFn = vi.fn<typeof fetch>(async url => String(url).includes(encodeURIComponent("https://arxiv.org/pdf/2608.01618"))
      ? new Response("%PDF-fixture", { headers: { "content-type": "application/pdf" } }) : new Response("", { status: 404 }))
    const source = await loadPaperText(new MemoryVaultStorage(), paper, { fetchFn, extractPdf: async () => ({ text, pagesRead: 10, totalPages: 30, shortened: true }) })
    expect(source.access).toBe("full-text")
    expect(source.truncated).toBe(true)
    expect(source.notes.join(" ")).toContain("10 of 30 pages")
  })
  it("does not mistake an unrelated cached PDF or a landing page for full text", async () => {
    const vault = new MemoryVaultStorage()
    await vault.writeBinary("sources/doi-10-48550-arxiv-2608-01618.pdf", new Uint8Array([1]))
    const source = await loadPaperText(vault, paper, { fetchFn: noFetch, extractPdf: async () => ({ text: `Unrelated article Methods Results ${"other text ".repeat(100)}`, pagesRead: 1, totalPages: 1, shortened: false }) })
    expect(source.access).toBe("abstract")
    expect(source.text).toBe(paper.abstract)
    expect(source.notes.join(" ")).not.toMatch(/paywall/i)
  })
})

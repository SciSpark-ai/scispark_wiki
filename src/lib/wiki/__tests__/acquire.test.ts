import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { acquireFullText, extractReadableText, snapshotSource } from "../acquire"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { PaperRecord } from "../../papers/types"

const FIXTURE_HTML = readFileSync(
  fileURLToPath(new URL("./fixtures/sample-article.html", import.meta.url)),
  "utf-8",
)

const LONG_HTML = `<html><body>${"<p>" + "word ".repeat(200) + "</p>"}</body></html>`
const SHORT_HTML = `<html><body><p>too short</p></body></html>`

function basePaper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: {},
    title: "A Test Paper",
    abstract: "This is the fallback abstract text.",
    authors: [{ name: "A. Researcher" }],
    fields: [],
    source: "openalex",
    ...overrides,
  }
}

function htmlResponse(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } })
}

describe("acquireFullText", () => {
  it("tries the arXiv HTML mirror first, relay-wrapped, when ids.arxiv is present", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({ ids: { arxiv: "2406.01234" } })
    await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls[0]).toBe(
      `/api/fetch?url=${encodeURIComponent("https://arxiv.org/html/2406.01234")}`,
    )
  })

  it("prefixes relay calls with apiBase when provided", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({ ids: { arxiv: "2406.01234" } })
    await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch, apiBase: "https://relay.example" })

    expect(calls[0]).toBe(
      `https://relay.example/api/fetch?url=${encodeURIComponent("https://arxiv.org/html/2406.01234")}`,
    )
  })

  it("maps a successful candidate to kind html, with text, html, and sourceUrl", async () => {
    const fetchFn = vi.fn(async () => htmlResponse(LONG_HTML))
    const paper = basePaper({ ids: { arxiv: "2406.01234" } })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(result.kind).toBe("html")
    expect(result.text.length).toBeGreaterThanOrEqual(500)
    expect(result.html).toBe(LONG_HTML)
    expect(result.sourceUrl).toBe("https://arxiv.org/html/2406.01234")
  })

  it("falls through to the next candidate when a candidate's extracted text is too short", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (calls.length === 1) return htmlResponse(SHORT_HTML)
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({
      ids: { arxiv: "2406.01234" },
      htmlUrl: "https://example.org/paper/html",
    })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls).toHaveLength(2)
    expect(calls[1]).toBe(`/api/fetch?url=${encodeURIComponent("https://example.org/paper/html")}`)
    expect(result.kind).toBe("html")
    expect(result.sourceUrl).toBe("https://example.org/paper/html")
  })

  it("skips a candidate that returns a non-200 status", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (calls.length === 1) return htmlResponse("not found", 404)
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({
      ids: { arxiv: "2406.01234" },
      htmlUrl: "https://example.org/paper/html",
    })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls).toHaveLength(2)
    expect(result.kind).toBe("html")
  })

  it("skips a candidate whose content-type is not html-ish", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (calls.length === 1) return htmlResponse(LONG_HTML, 200, "application/pdf")
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({
      ids: { arxiv: "2406.01234" },
      htmlUrl: "https://example.org/paper/html",
    })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls).toHaveLength(2)
    expect(result.kind).toBe("html")
  })

  it("tries htmlUrl, then oaUrl, in order after arXiv", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      return htmlResponse(SHORT_HTML)
    })

    const paper = basePaper({
      htmlUrl: "https://example.org/html",
      oaUrl: "https://example.org/oa",
    })

    await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls).toEqual([
      `/api/fetch?url=${encodeURIComponent("https://example.org/html")}`,
      `/api/fetch?url=${encodeURIComponent("https://example.org/oa")}`,
    ])
  })

  it("falls back to the abstract when all candidates fail", async () => {
    const fetchFn = vi.fn(async () => htmlResponse(SHORT_HTML))
    const paper = basePaper({
      ids: { arxiv: "2406.01234" },
      htmlUrl: "https://example.org/html",
      oaUrl: "https://example.org/oa",
      abstract: "The fallback abstract.",
    })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(result).toEqual({ kind: "abstract", text: "The fallback abstract." })
  })

  it("falls back to an empty string when all candidates fail and there is no abstract", async () => {
    const fetchFn = vi.fn(async () => htmlResponse(SHORT_HTML))
    const paper = basePaper({ abstract: undefined })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(result).toEqual({ kind: "abstract", text: "" })
  })

  it("resolves via /api/resolve when the paper only has a DOI, then fetches the resolved oaUrl", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.startsWith("/api/resolve")) {
        return new Response(
          JSON.stringify({ doi: "10.1000/xyz123", oaUrl: "https://resolved.example/landing", isOa: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({ ids: { doi: "10.1000/xyz123" } })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls[0]).toBe(`/api/resolve?doi=${encodeURIComponent("10.1000/xyz123")}`)
    expect(calls[1]).toBe(`/api/fetch?url=${encodeURIComponent("https://resolved.example/landing")}`)
    expect(result.kind).toBe("html")
    expect(result.sourceUrl).toBe("https://resolved.example/landing")
  })

  it("does not call /api/resolve when htmlUrl already succeeded", async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      return htmlResponse(LONG_HTML)
    })

    const paper = basePaper({
      ids: { doi: "10.1000/xyz123" },
      htmlUrl: "https://example.org/html",
    })

    await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(calls).toEqual([`/api/fetch?url=${encodeURIComponent("https://example.org/html")}`])
  })

  it("falls back to abstract when DOI resolve itself fails", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith("/api/resolve")) return new Response("nope", { status: 502 })
      return htmlResponse(SHORT_HTML)
    })

    const paper = basePaper({ ids: { doi: "10.1000/xyz123" }, abstract: "abs" })

    const result = await acquireFullText(paper, { fetchFn: fetchFn as unknown as typeof fetch })

    expect(result).toEqual({ kind: "abstract", text: "abs" })
  })
})

describe("extractReadableText", () => {
  const extracted = extractReadableText(FIXTURE_HTML)

  it("removes script and style block content entirely", () => {
    expect(extracted).not.toContain("console.log")
    expect(extracted).not.toContain("trackPageView")
    expect(extracted).not.toContain("font-family")
    expect(extracted).not.toContain("display: none")
  })

  it("removes nav, header, and footer block content", () => {
    expect(extracted).not.toContain("Site Header Should Be Removed")
    expect(extracted).not.toContain("Home")
    expect(extracted).not.toContain("Copyright 2026")
  })

  it("preserves paragraph text as separate lines/paragraphs", () => {
    expect(extracted).toContain("A Study of Widgets & Gadgets")
    expect(extracted).toContain("This paper introduces a new method for widget analysis.")
    expect(extracted).toContain("Related Work")
    const paraIndex = extracted.indexOf("This paper introduces")
    const nextParaIndex = extracted.indexOf("We evaluate on three datasets")
    expect(paraIndex).toBeGreaterThan(-1)
    expect(nextParaIndex).toBeGreaterThan(paraIndex)
  })

  it("decodes named and numeric HTML entities", () => {
    expect(extracted).toContain("A Study of Widgets & Gadgets")
    expect(extracted).toContain('"robust" estimators, requiring that x < y for all comparisons')
    expect(extracted).toContain("O'Brien")
  })

  it("collapses more than two consecutive newlines down to at most two", () => {
    expect(extracted).not.toMatch(/\n{3,}/)
  })

  it("has no leftover angle-bracket tags", () => {
    expect(extracted).not.toMatch(/<[a-zA-Z!/][^>]*>/)
  })
})

describe("snapshotSource", () => {
  it("writes to sources/<sanitized paperKey>.html and returns that path", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: { doi: "10.1038/Nature.12373" } })

    const path = await snapshotSource(storage, paper, FIXTURE_HTML)

    expect(path).toBe("sources/doi-10-1038-nature-12373.html")
    expect(await storage.read(path)).toBe(FIXTURE_HTML)
  })

  it("sanitizes arxiv-based paper keys the same way", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: { arxiv: "2406.01234" } })

    const path = await snapshotSource(storage, paper, "<html>hi</html>")

    expect(path).toBe("sources/arxiv-2406-01234.html")
  })

  it("truncates very long sanitized keys to 100 characters", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: {}, title: "T".repeat(200) })

    const path = await snapshotSource(storage, paper, "<html></html>")

    // "sources/" (8) + slug (<=100) + ".html" (5)
    expect(path.startsWith("sources/")).toBe(true)
    expect(path.endsWith(".html")).toBe(true)
    const slug = path.slice("sources/".length, -".html".length)
    expect(slug.length).toBeLessThanOrEqual(100)
  })
})

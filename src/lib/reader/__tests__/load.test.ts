import { describe, it, expect, vi } from "vitest"
import { loadReaderContent } from "../load"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { sanitizeSlug } from "../../wiki/acquire"
import { paperKey, type PaperRecord } from "../../papers/types"

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

const LONG_HTML = `<html><body>${"<p>" + "word ".repeat(200) + "</p>"}</body></html>`

function htmlResponse(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } })
}

describe("loadReaderContent", () => {
  it("returns html from an existing sources/ snapshot without calling fetch", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: { arxiv: "2406.01234" } })
    const path = `sources/${sanitizeSlug(paperKey(paper))}.html`
    await storage.write(path, "<p>snapshot content</p>")
    const fetchFn = vi.fn()

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result).toEqual({ kind: "html", html: "<p>snapshot content</p>", snapshotPath: path })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("acquires html via the relay, snapshots it, and returns it when no snapshot exists", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: { arxiv: "2406.01234" } })
    const fetchFn = vi.fn(async () => htmlResponse(LONG_HTML))
    const expectedPath = `sources/${sanitizeSlug(paperKey(paper))}.html`

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result.kind).toBe("html")
    if (result.kind === "html") {
      expect(result.html).toBe(LONG_HTML)
      expect(result.sourceUrl).toBe("https://arxiv.org/html/2406.01234")
      expect(result.snapshotPath).toBe(expectedPath)
    }
    const written = await storage.read(expectedPath)
    expect(written).toBe(LONG_HTML)
  })

  it("returns kind none with a reason when acquireFullText falls back to abstract only", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: {} }) // no arxiv/html/oa/doi candidates at all
    const fetchFn = vi.fn()

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result).toEqual({
      kind: "none",
      reason: "Full text unavailable (paywalled or no open-access HTML).",
    })
  })

  it("never throws when the fetch function itself throws, mapping to kind none", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: { arxiv: "2406.01234" } })
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    })

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result.kind).toBe("none")
  })

  it("returns pdf bytes from an existing sources/ pdf snapshot without calling fetch", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: { arxiv: "2406.01234" } })
    const path = `sources/${sanitizeSlug(paperKey(paper))}.pdf`
    const bytes = new Uint8Array([1, 2, 3, 4])
    await storage.writeBinary(path, bytes)
    const fetchFn = vi.fn()

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result).toEqual({ kind: "pdf", bytes, snapshotPath: path })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("fetches a pdf candidate via the relay and snapshots it when no html candidate succeeds", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: {}, pdfUrl: "https://example.com/paper.pdf" })
    const bytes = new Uint8Array([5, 6, 7, 8])
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/fetch?url=${encodeURIComponent("https://example.com/paper.pdf")}`)
      return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } })
    })
    const expectedPath = `sources/${sanitizeSlug(paperKey(paper))}.pdf`

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result.kind).toBe("pdf")
    if (result.kind === "pdf") {
      expect(Array.from(result.bytes)).toEqual(Array.from(bytes))
      expect(result.snapshotPath).toBe(expectedPath)
    }
    const stored = await storage.readBinary(expectedPath)
    expect(stored).not.toBeNull()
    expect(Array.from(stored as Uint8Array)).toEqual(Array.from(bytes))
  })

  it("falls to kind none when a pdf candidate exists but the relay doesn't return a pdf content-type", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper({ ids: {}, pdfUrl: "https://example.com/paywall.html" })
    const fetchFn = vi.fn(
      async () =>
        new Response("<html>paywall</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    )

    const result = await loadReaderContent(storage, paper, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result.kind).toBe("none")
  })
})

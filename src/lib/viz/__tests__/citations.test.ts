import { describe, it, expect, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import type { Frontmatter } from "../../vault/types"
import { CITATIONS_DIR, deriveCitationFlow, loadCitationRefs } from "../citations"
import type { CitationRef } from "../../papers/citations-core"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

async function bundleFrom(files: Record<string, [Frontmatter, string]>) {
  const storage = new MemoryVaultStorage()
  for (const [path, [frontmatter, body]] of Object.entries(files)) {
    await storage.write(path, serializeDocument(frontmatter, body))
  }
  return { storage, bundle: await loadBundle(storage) }
}

function ref(ids: CitationRef["ids"], title = "Ref"): CitationRef {
  return { ids, title }
}

describe("deriveCitationFlow — edges", () => {
  it("A cites B (both in vault, matched by doi) -> one edge", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
      "wiki/papers/b.md": [fm("paper", "B", { doi: "10.1/b" }), "x"],
    })
    const refsByPageId = new Map<string, CitationRef[]>([["wiki/papers/a", [ref({ doi: "10.1/b" })]]])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.edges).toEqual([{ citing: "wiki/papers/a", cited: "wiki/papers/b" }])
  })

  it("matches a reference via arxiv when doi is absent", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { arxiv: "1706.03762" }), "x"],
      "wiki/papers/b.md": [fm("paper", "B", { arxiv: "1810.04805" }), "x"],
    })
    const refsByPageId = new Map<string, CitationRef[]>([
      ["wiki/papers/a", [ref({ arxiv: "1810.04805" })]],
    ])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.edges).toEqual([{ citing: "wiki/papers/a", cited: "wiki/papers/b" }])
  })

  it("a reference to a paper not in the vault produces no edge", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const refsByPageId = new Map<string, CitationRef[]>([
      ["wiki/papers/a", [ref({ doi: "10.1/not-in-vault" })]],
    ])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.edges).toEqual([])
  })

  it("dedupes repeated references to the same cited paper", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
      "wiki/papers/b.md": [fm("paper", "B", { doi: "10.1/b" }), "x"],
    })
    const refsByPageId = new Map<string, CitationRef[]>([
      ["wiki/papers/a", [ref({ doi: "10.1/b" }), ref({ doi: "10.1/b" })]],
    ])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.edges).toHaveLength(1)
  })

  it("drops a self-citation (a paper's reference list happens to include itself)", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const refsByPageId = new Map<string, CitationRef[]>([
      ["wiki/papers/a", [ref({ doi: "10.1/a" })]],
    ])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.edges).toEqual([])
  })

  it("a reference matching both doi and arxiv of the same vault paper still yields one edge", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
      "wiki/papers/b.md": [fm("paper", "B", { doi: "10.1/b", arxiv: "1706.03762" }), "x"],
    })
    const refsByPageId = new Map<string, CitationRef[]>([
      ["wiki/papers/a", [ref({ doi: "10.1/b", arxiv: "1706.03762" })]],
    ])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.edges).toEqual([{ citing: "wiki/papers/a", cited: "wiki/papers/b" }])
  })
})

describe("deriveCitationFlow — coverage stats", () => {
  it("papersTotal counts every paper page; papersWithData only those present in refsByPageId", async () => {
    const { bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
      "wiki/papers/b.md": [fm("paper", "B", { doi: "10.1/b" }), "x"],
      "wiki/papers/c.md": [fm("paper", "C"), "x"], // no doi/arxiv at all
    })
    const refsByPageId = new Map<string, CitationRef[]>([["wiki/papers/a", []]])

    const flow = deriveCitationFlow(bundle, refsByPageId)

    expect(flow.papersTotal).toBe(3)
    expect(flow.papersWithData).toBe(1)
  })

  it("empty bundle -> zero edges and zero counts", async () => {
    const { bundle } = await bundleFrom({})
    const flow = deriveCitationFlow(bundle, new Map())
    expect(flow).toEqual({ edges: [], papersWithData: 0, papersTotal: 0 })
  })
})

describe("loadCitationRefs", () => {
  it("reads a cached reference list for an eligible paper", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const cachePath = `${CITATIONS_DIR}/10-1-a.json`
    await storage.write(
      cachePath,
      JSON.stringify({ fetchedAt: "2026-07-13T00:00:00.000Z", references: [ref({ doi: "10.1/b" })] }),
    )

    const refsByPageId = await loadCitationRefs(storage, bundle)

    expect(refsByPageId.get("wiki/papers/a")).toEqual([ref({ doi: "10.1/b" })])
  })

  it("skips papers with neither doi nor arxiv entirely", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A"), "x"],
    })
    const fetchImpl = vi.fn()

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchMissing: true, fetchImpl })

    expect(refsByPageId.has("wiki/papers/a")).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("without fetchMissing, an uncached eligible paper is simply omitted (no fetch)", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const fetchImpl = vi.fn()

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchImpl })

    expect(refsByPageId.has("wiki/papers/a")).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fetchMissing fetches an uncached eligible paper via /api/citations and writes the cache", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/citations?id=${encodeURIComponent("DOI:10.1/a")}`)
      return {
        ok: true,
        json: async () => ({ references: [ref({ doi: "10.1/b" }, "B")] }),
      }
    }) as unknown as typeof fetch

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchMissing: true, fetchImpl })

    expect(refsByPageId.get("wiki/papers/a")).toEqual([ref({ doi: "10.1/b" }, "B")])

    const cachePath = `${CITATIONS_DIR}/10-1-a.json`
    const cached = await storage.read(cachePath)
    expect(cached).not.toBeNull()
    const parsed = JSON.parse(cached as string)
    expect(parsed.references).toEqual([ref({ doi: "10.1/b" }, "B")])
    expect(typeof parsed.fetchedAt).toBe("string")
  })

  it("prefers arxiv over doi for the fetch id when both are present", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a", arxiv: "1706.03762" }), "x"],
    })
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/citations?id=${encodeURIComponent("ARXIV:1706.03762")}`)
      return { ok: true, json: async () => ({ references: [] }) }
    }) as unknown as typeof fetch

    await loadCitationRefs(storage, bundle, { fetchMissing: true, fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("a fetch failure (network throw) skips that paper silently, no throw", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchMissing: true, fetchImpl })

    expect(refsByPageId.has("wiki/papers/a")).toBe(false)
    expect(await storage.read(`${CITATIONS_DIR}/10-1-a.json`)).toBeNull()
  })

  it("a non-OK response skips that paper silently, no throw", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
    })
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchMissing: true, fetchImpl })

    expect(refsByPageId.has("wiki/papers/a")).toBe(false)
  })

  it("one paper's fetch failure doesn't block another paper's successful fetch", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/papers/a.md": [fm("paper", "A", { doi: "10.1/a" }), "x"],
      "wiki/papers/b.md": [fm("paper", "B", { doi: "10.1/b" }), "x"],
    })
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(encodeURIComponent("DOI:10.1/a"))) throw new Error("boom")
      return { ok: true, json: async () => ({ references: [] }) }
    }) as unknown as typeof fetch

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchMissing: true, fetchImpl })

    expect(refsByPageId.has("wiki/papers/a")).toBe(false)
    expect(refsByPageId.has("wiki/papers/b")).toBe(true)
  })

  it("non-paper pages and paper pages missing entirely from the vault are ignored", async () => {
    const { storage, bundle } = await bundleFrom({
      "wiki/concepts/x.md": [fm("concept", "X", { doi: "10.1/x" } as Partial<Frontmatter>), "x"],
    })
    const refsByPageId = await loadCitationRefs(storage, bundle)
    expect(refsByPageId.size).toBe(0)
  })
})

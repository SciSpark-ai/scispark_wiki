import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadBundle } from "../../vault/bundle"
import { buildIdeaPage } from "../idea-page"

describe("buildIdeaPage", () => {
  it("builds a wiki/ideas/idea-<slug>.md draft the bundle loader parses, with status/depth and bare-slugged related[]", async () => {
    const draft = buildIdeaPage({
      slugSeed: "Efficient Long-Context Attention via Conditioning",
      title: "Efficient Long-Context Attention via Conditioning",
      status: "sparked",
      depth: "quick",
      groundingPageIds: ["wiki/papers/a-great-paper", "wiki/concepts/attention"],
      body: "# Efficient Long-Context Attention via Conditioning\n\nSome idea body.\n",
      today: "2026-07-13",
    })

    expect(draft.path).toBe("wiki/ideas/idea-efficient-long-context-attention-via-conditioning.md")
    expect(draft.frontmatter.type).toBe("idea")
    expect(draft.frontmatter.status).toBe("sparked")
    expect(draft.frontmatter.depth).toBe("quick")
    expect(draft.frontmatter.related).toEqual(["a-great-paper", "attention"])
    expect(draft.frontmatter.tags).toEqual([])
    expect(draft.frontmatter.sources).toEqual([])
    expect(draft.frontmatter.created).toBe("2026-07-13")
    expect(draft.frontmatter.updated).toBe("2026-07-13")

    const storage = new MemoryVaultStorage()
    await storage.write(draft.path, draft.content)
    const bundle = await loadBundle(storage)
    expect(bundle.errors).toEqual([])
    const page = bundle.pages.get(draft.path.slice(0, -3))
    expect(page).toBeDefined()
    expect(page!.frontmatter.type).toBe("idea")
    expect(page!.frontmatter.status).toBe("sparked")
    expect(page!.frontmatter.depth).toBe("quick")
    expect(page!.body).toContain("Some idea body.")
  })

  it("dedupes and sanitizes groundingPageIds into related[] via sanitizeSlugList", () => {
    const draft = buildIdeaPage({
      slugSeed: "Idea With Dupes",
      title: "Idea With Dupes",
      status: "in-progress",
      depth: "deep",
      groundingPageIds: ["wiki/concepts/x", "concepts/x", "wiki/methods/y"],
      body: "Body.\n",
      today: "2026-07-13",
    })

    expect(draft.frontmatter.related).toEqual(["x", "y"])
    expect(draft.frontmatter.depth).toBe("deep")
    expect(draft.frontmatter.status).toBe("in-progress")
  })

  it("slugifies slugSeed independently of title", () => {
    const draft = buildIdeaPage({
      slugSeed: "Seed Title !!",
      title: "A Completely Different Title",
      status: "scooped",
      depth: "quick",
      groundingPageIds: [],
      body: "Body.\n",
      today: "2026-07-13",
    })

    expect(draft.path).toBe("wiki/ideas/idea-seed-title.md")
    expect(draft.frontmatter.title).toBe("A Completely Different Title")
    expect(draft.frontmatter.related).toEqual([])
  })
})

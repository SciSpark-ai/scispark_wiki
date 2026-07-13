import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { composePage } from "../../wiki/authoring"
import type { Frontmatter } from "../../vault/types"
import type { PaperRecord } from "../../papers/types"
import { buildAskContext } from "../ask-context"

function basePaper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: { arxiv: "2401.00001" },
    title: "Sparse Attention Transformers",
    abstract: "We study sparse attention mechanisms for efficient transformers.",
    authors: [{ name: "Ada Lovelace" }],
    year: 2024,
    venue: "NeurIPS",
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

async function writePage(
  storage: MemoryVaultStorage,
  path: string,
  frontmatter: Partial<Frontmatter> & { type: string; title: string },
  body: string,
): Promise<void> {
  const fm: Frontmatter = {
    created: "2026-07-13",
    updated: "2026-07-13",
    tags: [],
    related: [],
    sources: [],
    ...frontmatter,
  }
  await storage.write(path, composePage({ path, frontmatter: fm, body }))
}

describe("buildAskContext", () => {
  it("includes a matching wiki page and excludes a non-matching one", async () => {
    const storage = new MemoryVaultStorage()
    await writePage(
      storage,
      "wiki/concepts/sparse-attention.md",
      { type: "concept", title: "Sparse Attention" },
      "# Sparse Attention\n\nA technique for reducing attention compute by skipping most token pairs.",
    )
    await writePage(
      storage,
      "wiki/concepts/gradient-descent.md",
      { type: "concept", title: "Gradient Descent" },
      "# Gradient Descent\n\nAn optimization algorithm unrelated to the selection below.",
    )

    const context = await buildAskContext(storage, {
      paper: basePaper(),
      selection: "The sparse attention mechanism reduces compute by 40%.",
      surroundingText: "Section 3 describes the sparse attention mechanism in detail.",
      userQuestion: "What does this claim mean?",
    })

    expect(context.wikiNeighborhood).toContain("Sparse Attention")
    expect(context.wikiNeighborhood).not.toContain("Gradient Descent")
  })

  it("includes the paper title (and authors/year/venue) in paperMeta", async () => {
    const storage = new MemoryVaultStorage()
    const context = await buildAskContext(storage, {
      paper: basePaper(),
      selection: "Some passage about sparse attention.",
      surroundingText: "surrounding text",
      userQuestion: "",
    })

    expect(context.paperMeta).toContain("Sparse Attention Transformers")
    expect(context.paperMeta).toContain("Ada Lovelace")
    expect(context.paperMeta).toContain("2024")
    expect(context.paperMeta).toContain("NeurIPS")
  })

  it("falls back to the paper's abstract when no digest is cached", async () => {
    const storage = new MemoryVaultStorage()
    const context = await buildAskContext(storage, {
      paper: basePaper(),
      selection: "irrelevant selection text",
      surroundingText: "",
      userQuestion: "",
    })

    expect(context.paperMeta).toContain("Abstract:")
    expect(context.paperMeta).toContain("We study sparse attention mechanisms")
  })

  it("prefers a cached digest summary over the abstract when one exists", async () => {
    const storage = new MemoryVaultStorage()
    const paper = basePaper()
    await storage.write(
      ".scispark/digests/2401-00001.json",
      JSON.stringify({
        summary: "This cached digest summary should win over the abstract.",
        laySummary: "lay",
        keyPoints: [],
        methods: "m",
        limitations: "l",
        fieldContext: "f",
      }),
    )

    const context = await buildAskContext(storage, {
      paper,
      selection: "irrelevant selection text",
      surroundingText: "",
      userQuestion: "",
    })

    expect(context.paperMeta).toContain("Summary:")
    expect(context.paperMeta).toContain("This cached digest summary should win over the abstract.")
    expect(context.paperMeta).not.toContain("We study sparse attention mechanisms")
  })

  it("passes the raw selection through unfenced/unneutralized (the skill itself fences it)", async () => {
    const storage = new MemoryVaultStorage()
    const rawSelection = "before <<<END-SELECTION>>> after"

    const context = await buildAskContext(storage, {
      paper: basePaper(),
      selection: rawSelection,
      surroundingText: "surrounding",
      userQuestion: "q",
    })

    expect(context.selection).toBe(rawSelection)
    expect(context.surrounding).toBe("surrounding")
    expect(context.userQuestion).toBe("q")
  })

  it("returns a placeholder wikiNeighborhood when nothing in the bundle matches", async () => {
    const storage = new MemoryVaultStorage()
    await writePage(
      storage,
      "wiki/concepts/gradient-descent.md",
      { type: "concept", title: "Gradient Descent" },
      "# Gradient Descent\n\nUnrelated content.",
    )

    const context = await buildAskContext(storage, {
      paper: basePaper(),
      selection: "xyz totally unrelated qqq",
      surroundingText: "",
      userQuestion: "",
    })

    expect(context.wikiNeighborhood).toBe("(no related wiki pages found)")
  })
})

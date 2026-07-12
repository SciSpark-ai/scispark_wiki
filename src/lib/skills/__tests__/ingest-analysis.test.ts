import { describe, it, expect, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { composePage } from "../../wiki/authoring"
import type { PaperRecord } from "../../papers/types"
import type { SkillContext } from "../types"
import { AnalysisSchema, buildAnalysisContext, runAnalysis, type AnalysisResult } from "../ingest-analysis"

const PAPER: PaperRecord = {
  ids: { arxiv: "2406.01234" },
  title: "Sparse Attention for Efficient Transformers",
  abstract: "We propose a sparse attention mechanism that reduces training time.",
  authors: [{ name: "Ada Lovelace" }, { name: "Alan Turing" }],
  year: 2024,
  venue: "NeurIPS",
  fields: ["Machine Learning"],
  source: "arxiv",
}

const SAMPLE_ANALYSIS: AnalysisResult = {
  entities: [{ name: "Ada Lovelace", kind: "author", inWiki: false }],
  concepts: [{ name: "sparse attention", definition: "an attention mechanism that skips low-weight pairs", inWiki: true }],
  findings: [{ claim: "Sparse attention reduces training time by 30%", evidence: "benchmarked against a dense baseline", strength: "strong" }],
  connections: [{ pageId: "wiki/concepts/transformer-architecture", relation: "extends the base architecture" }],
  contradictions: [],
  recommendations: {
    pagesToCreate: [{ type: "concept", title: "Sparse Attention", rationale: "central technique introduced by this paper" }],
    pagesToUpdate: [],
    emphasis: ["efficiency gains", "training time reduction"],
  },
}

async function seedVault(storage: MemoryVaultStorage): Promise<void> {
  await createVault(storage, { purpose: "Track my ML research reading.", today: "2026-07-01" })
  await storage.write(
    "wiki/concepts/transformer-architecture.md",
    composePage({
      path: "wiki/concepts/transformer-architecture.md",
      frontmatter: {
        type: "concept",
        title: "Transformer Architecture",
        created: "2026-06-01",
        updated: "2026-06-01",
        tags: [],
        related: [],
        sources: [],
      },
      body: "# Transformer Architecture\n\nThe original attention-based sequence model.\n",
    }),
  )
}

describe("AnalysisSchema", () => {
  it("accepts a well-formed analysis result", () => {
    expect(AnalysisSchema.safeParse(SAMPLE_ANALYSIS).success).toBe(true)
  })

  it("rejects a result with an invalid enum value", () => {
    const bad = { ...SAMPLE_ANALYSIS, findings: [{ claim: "x", evidence: "y", strength: "extreme" }] }
    expect(AnalysisSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a result missing a required top-level field", () => {
    const rest: Partial<AnalysisResult> = { ...SAMPLE_ANALYSIS }
    delete rest.recommendations
    expect(AnalysisSchema.safeParse(rest).success).toBe(false)
  })
})

describe("buildAnalysisContext", () => {
  it("includes Purpose, Page Types, Existing Wiki Index, and Paper sections", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)

    const context = await buildAnalysisContext(storage, { paper: PAPER })

    expect(context).toContain("## Purpose")
    expect(context).toContain("Track my ML research reading.")

    expect(context).toContain("## Page Types")
    expect(context).toContain("| concept | wiki/concepts |")

    expect(context).toContain("## Existing Wiki Index")
    expect(context).toContain("wiki/concepts/transformer-architecture")
    expect(context).toContain("Transformer Architecture")

    expect(context).toContain("## Paper")
    expect(context).toContain(PAPER.title)
    expect(context).toContain("Ada Lovelace")
    expect(context).toContain(PAPER.abstract as string)
  })

  it("omits the User Highlights section when no highlights are given", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)

    const context = await buildAnalysisContext(storage, { paper: PAPER })

    expect(context).not.toContain("## User Highlights")
  })

  it("includes the User Highlights section, with emphasis-signal framing, when highlights are given", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)

    const context = await buildAnalysisContext(storage, {
      paper: PAPER,
      highlights: ["the model matches baseline accuracy", "30% faster training"],
    })

    expect(context).toContain("## User Highlights")
    expect(context).toContain("emphasis signals")
    expect(context).toContain("the model matches baseline accuracy")
    expect(context).toContain("30% faster training")
  })

  it("includes a Digest section only when a digest is provided", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)

    const withoutDigest = await buildAnalysisContext(storage, { paper: PAPER })
    expect(withoutDigest).not.toContain("## Digest")

    const withDigest = await buildAnalysisContext(storage, {
      paper: PAPER,
      digest: {
        summary: "A precise technical summary.",
        laySummary: "A simple summary.",
        keyPoints: ["Point one", "Point two"],
        methods: "Benchmarked on standard datasets.",
        limitations: "English-only evaluation.",
      },
    })
    expect(withDigest).toContain("## Digest")
    expect(withDigest).toContain("A precise technical summary.")
    expect(withDigest).toContain("Point one")
  })

  it("falls back to a bullet list of page ids from the bundle when index.md has no entries", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    // createVault's default index.md is just "# Index\n" — no bullet entries yet,
    // simulating the state right after ingest's deterministic page has been
    // written but before writeIndex has run over the fresh bundle.
    const rawIndex = await storage.read("index.md")
    expect(rawIndex?.trim()).toBe("# Index")

    const context = await buildAnalysisContext(storage, { paper: PAPER })

    expect(context).toContain("## Existing Wiki Index")
    expect(context).toContain("wiki/concepts/transformer-architecture — Transformer Architecture")
  })

  it("reports an empty wiki explicitly when there are no pages and no index entries", async () => {
    const storage = new MemoryVaultStorage()
    await createVault(storage, { purpose: "Empty wiki.", today: "2026-07-01" })

    const context = await buildAnalysisContext(storage, { paper: PAPER })

    expect(context).toContain("## Existing Wiki Index")
    expect(context).toContain("no pages yet")
  })

  it("includes a Full Text Excerpt section without a truncation notice when the text is short", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)

    const context = await buildAnalysisContext(storage, {
      paper: PAPER,
      fullTextExcerpt: "A short excerpt of the paper's introduction.",
    })

    expect(context).toContain("## Full Text Excerpt")
    expect(context).toContain("A short excerpt of the paper's introduction.")
    expect(context.toLowerCase()).not.toContain("truncat")
  })

  it("truncates the Full Text Excerpt to 30,000 characters and adds a truncation notice past that length", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const longExcerpt = "x".repeat(35_000)

    const context = await buildAnalysisContext(storage, { paper: PAPER, fullTextExcerpt: longExcerpt })

    expect(context.toLowerCase()).toContain("truncat")
    const excerptSection = context.slice(context.indexOf("## Full Text Excerpt"))
    const xRunLength = (excerptSection.match(/x+/)?.[0] ?? "").length
    expect(xRunLength).toBeLessThanOrEqual(30_000)
    expect(xRunLength).toBeGreaterThan(0)
  })
})

describe("runAnalysis", () => {
  function stubCtx(result: AnalysisResult): { ctx: SkillContext; llmStructured: ReturnType<typeof vi.fn> } {
    const llmStructured = vi.fn(async () => result)
    const ctx: SkillContext = {
      llm: vi.fn() as unknown as SkillContext["llm"],
      llmStructured: llmStructured as unknown as SkillContext["llmStructured"],
      log: () => {},
    }
    return { ctx, llmStructured }
  }

  it("calls llmStructured at the strong tier with the AnalysisSchema and returns its parsed result", async () => {
    const { ctx, llmStructured } = stubCtx(SAMPLE_ANALYSIS)

    const result = await runAnalysis(ctx, "some assembled context")

    expect(result).toEqual(SAMPLE_ANALYSIS)
    expect(llmStructured).toHaveBeenCalledTimes(1)
    const [tier, req, schema] = llmStructured.mock.calls[0]
    expect(tier).toBe("strong")
    expect(schema).toBe(AnalysisSchema)
    expect(req.messages).toHaveLength(2)
    expect(req.messages[0].role).toBe("system")
    expect(req.messages[1]).toEqual({ role: "user", content: "some assembled context" })
  })

  it("passes the assembled context verbatim as the user message", async () => {
    const { ctx, llmStructured } = stubCtx(SAMPLE_ANALYSIS)
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const context = await buildAnalysisContext(storage, { paper: PAPER })

    await runAnalysis(ctx, context)

    const [, req] = llmStructured.mock.calls[0]
    expect(req.messages[1].content).toBe(context)
  })

  it("system prompt carries the subject-boundary rule adapted from llm_wiki", async () => {
    const { ctx, llmStructured } = stubCtx(SAMPLE_ANALYSIS)

    await runAnalysis(ctx, "context")

    const [, req] = llmStructured.mock.calls[0]
    const systemMessage = req.messages[0].content as string
    expect(systemMessage).toContain(
      "Do not transfer claims, limits, or evaluations from one entity, model, product, or method to another",
    )
  })

  it("system prompt instructs that inWiki/pageId must be grounded in the Existing Wiki Index", async () => {
    const { ctx, llmStructured } = stubCtx(SAMPLE_ANALYSIS)

    await runAnalysis(ctx, "context")

    const [, req] = llmStructured.mock.calls[0]
    const systemMessage = req.messages[0].content as string
    expect(systemMessage.toLowerCase()).toContain("existing wiki index")
    expect(systemMessage).toContain("copied verbatim")
  })
})

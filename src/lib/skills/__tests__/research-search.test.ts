import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { SearchFn } from "../feed"
import {
  ResearchSearchPlanSchema,
  ResearchSearchRankingSchema,
  researchSearchPlanSkill,
  runResearchSearch,
} from "../research-search"
import { runSkill } from "../runner"

const NOW = () => new Date("2026-09-04T12:00:00.000Z")
const SETTINGS = { ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }

function structured(value: unknown): LLMResult {
  return {
    text: JSON.stringify(value),
    json: value,
    usage: { inputTokens: 40, outputTokens: 20 },
    model: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

function paper(title: string, doi: string, source: PaperRecord["source"]): PaperRecord {
  return {
    ids: { doi },
    title,
    abstract: `${title} abstract`,
    authors: [{ name: "Ada Researcher" }],
    year: 2026,
    date: "2026-08-01",
    venue: "Journal of Tests",
    citationCount: 3,
    fields: ["Testing"],
    source,
  }
}

async function seededVault(): Promise<MemoryVaultStorage> {
  const storage = new MemoryVaultStorage()
  await storage.write("profile.md", "# Profile\n\n## Research fields\n\n- auditory neuroscience\n")
  await storage.write("interests.md", "# Interests\n\n## Active topics\n\n- attention decoding\n")
  return storage
}

describe("research-search schemas", () => {
  it("strictly bounds plans and ranking values", () => {
    expect(ResearchSearchPlanSchema.safeParse({
      interpretation: "Recent auditory-attention decoding work",
      sort: "date",
      fromDate: "2024-09-04",
      queries: [{ source: "arxiv", query: "auditory attention decoding", rationale: "cover methods" }],
    }).success).toBe(true)
    expect(ResearchSearchRankingSchema.safeParse({ items: [{ key: "doi:10.1/a", score: 101, whyMatch: "x" }] }).success).toBe(false)
  })

  it("gives the planner the saved research profile, allowed sources, and exact current date", async () => {
    const storage = await seededVault()
    const provider = new MockProvider([structured({
      interpretation: "Auditory attention decoding",
      sort: "relevance",
      fromDate: null,
      queries: [{ source: "openalex", query: "auditory attention decoding", rationale: "core terminology" }],
    })])

    await runSkill({
      skill: researchSearchPlanSkill,
      input: {
        query: "Find work on decoding attention",
        userContextText: "<<<PROFILE>>>\nauditory neuroscience\n<<<END>>>",
        allowedSources: ["openalex"],
        currentDate: "2026-09-04",
      },
      storage,
      settings: SETTINGS,
      providerOverride: { fast: provider },
      now: NOW,
    })

    const userMessage = provider.calls[0].req.messages.find((message) => message.role === "user")?.content ?? ""
    expect(userMessage).toContain("CURRENT-DATE: 2026-09-04")
    expect(userMessage).toContain("ALLOWED-SOURCES: openalex")
    expect(userMessage).toContain("auditory neuroscience")
    expect(userMessage).toContain("<<<RESEARCH-QUESTION>>>")
  })
})

describe("runResearchSearch", () => {
  it("keeps successful source results when another source fails and records the incomplete coverage", async () => {
    const storage = await seededVault()
    const provider = new MockProvider([
      structured({ interpretation: "Attention", sort: "relevance", fromDate: null, queries: [
        { source: "s2", query: "attention", rationale: "cross-check" },
        { source: "openalex", query: "attention", rationale: "broader index" },
      ] }), structured({ items: [] }),
    ])
    const searchFn: SearchFn = async (source) => {
      if (source === "s2") throw new Error("429")
      return [paper("Attention", "10.1/test", "openalex")]
    }
    const result = await runResearchSearch(storage, { query: "attention" }, { settings: SETTINGS, searchFn, providerOverride: { fast: provider }, now: NOW })
    expect(result.items).toHaveLength(1)
    expect(result.warnings[0]).toContain("s2")
  })
  it("does not append fallback candidates beyond a complete 15-paper ranking", async () => {
    const storage = await seededVault()
    const papers = Array.from({ length: 20 }, (_, i) => paper(`Study ${i}`, `10.1/${i}`, "openalex"))
    const provider = new MockProvider([
      structured({ interpretation: "Attention", sort: "relevance", fromDate: null, queries: [{ source: "openalex", query: "attention", rationale: "methods" }] }),
      structured({ items: papers.slice(0, 15).map((p) => ({ key: `doi:${p.ids.doi}`, score: 90, whyMatch: "Relevant method." })) }),
    ])
    const result = await runResearchSearch(storage, { query: "attention" }, { settings: SETTINGS, searchFn: async () => papers, providerOverride: { fast: provider }, now: NOW })
    expect(result.items).toHaveLength(15)
  })
  it("intersects requested and model-generated sources with saved preferences", async () => {
    const storage = await seededVault()
    await storage.write(".scispark/settings.json", JSON.stringify({ paperSources: { enabledSources: ["pubmed", "openalex"] } }))
    const provider = new MockProvider([
      structured({ interpretation: "Attention", sort: "relevance", fromDate: null, queries: [
        { source: "arxiv", query: "attention", rationale: "not enabled" },
        { source: "openalex", query: "attention", rationale: "enabled" },
      ] }), structured({ items: [] }),
    ])
    const searchFn = vi.fn<SearchFn>().mockResolvedValue([paper("Attention", "10.1/test", "openalex")])
    const result = await runResearchSearch(storage, { query: "attention", sources: ["arxiv", "openalex"] }, { settings: SETTINGS, searchFn, providerOverride: { fast: provider }, now: NOW })
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(searchFn.mock.calls[0][0]).toBe("openalex")
    expect(result.plan.queries).toHaveLength(1)
    expect(provider.calls[0].req.messages[1].content).toContain("ALLOWED-SOURCES: openalex")
  })
  it("rejects a disabled-only scope before spending or retrieving", async () => {
    const storage = await seededVault()
    await storage.write(".scispark/settings.json", JSON.stringify({ paperSources: { enabledSources: ["pubmed"] } }))
    const searchFn = vi.fn<SearchFn>(), provider = new MockProvider([])
    await expect(runResearchSearch(storage, { query: "attention", sources: ["arxiv"] }, { settings: SETTINGS, searchFn, providerOverride: { fast: provider } })).rejects.toThrow("enabled paper source")
    expect(searchFn).not.toHaveBeenCalled()
    expect(provider.calls).toHaveLength(0)
  })
  it("plans across sources, interleaves and deduplicates retrieval, then returns AI-ranked explanations", async () => {
    const storage = await seededVault()
    const paperA = paper("Attention decoding A", "10.1/a", "arxiv")
    const paperAMerged = { ...paperA, source: "openalex" as const, citationCount: 8, ids: { doi: "10.1/a", openalex: "W1" } }
    const paperB = paper("Attention decoding B", "10.1/b", "openalex")
    const provider = new MockProvider([
      structured({
        interpretation: "Recent auditory-attention decoding methods",
        sort: "date",
        fromDate: "2024-09-04",
        queries: [
          { source: "arxiv", query: "auditory attention decoding EEG", rationale: "find technical methods" },
          { source: "openalex", query: "auditory attention decoding", rationale: "cover the broader literature" },
        ],
      }),
      structured({
        items: [
          { key: "doi:10.1/b", score: 96, whyMatch: "Directly compares decoding methods for the requested task." },
          { key: "doi:10.1/a", score: 88, whyMatch: "Applies an EEG method aligned with the research profile." },
        ],
      }),
    ])
    const searchFn: SearchFn = async (source) => source === "arxiv" ? [paperA] : [paperAMerged, paperB]
    const stages: string[] = []

    const result = await runResearchSearch(storage, {
      query: "What are the latest methods for auditory attention decoding?",
      sources: ["arxiv", "openalex"],
    }, {
      settings: SETTINGS,
      providerOverride: { fast: provider },
      searchFn,
      onStage: (stage) => stages.push(stage),
      now: NOW,
    })

    expect(stages).toEqual(["planning", "searching", "ranking"])
    expect(result.stats).toEqual({ retrieved: 3, deduplicated: 2 })
    expect(result.items.map((item) => item.paper.title)).toEqual(["Attention decoding B", "Attention decoding A"])
    expect(result.items[1].paper.citationCount).toBe(8)
    expect(result.items[1].foundBy).toHaveLength(2)
    expect(result.items[0].whyMatch).toContain("requested task")
    expect(result.plan.fromDate).toBe("2024-09-04")
  })

  it("keeps retrieved papers with an honest warning when AI ranking fails", async () => {
    const storage = await seededVault()
    const provider = new MockProvider([
      structured({
        interpretation: "Attention decoding",
        sort: "relevance",
        fromDate: null,
        queries: [{ source: "openalex", query: "attention decoding", rationale: "match the core topic" }],
      }),
      structured({ wrong: [] }),
      structured({ stillWrong: [] }),
    ])
    const searchFn: SearchFn = async () => [paper("Fallback paper", "10.1/fallback", "openalex")]

    const result = await runResearchSearch(storage, { query: "attention decoding", sources: ["openalex"] }, {
      settings: SETTINGS,
      providerOverride: { fast: provider },
      searchFn,
      now: NOW,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].paper.title).toBe("Fallback paper")
    expect(result.items[0].whyMatch).toContain("match the core topic")
    expect(result.warnings).toEqual(["AI ranking was unavailable, so these papers remain in source order."])
  })
})

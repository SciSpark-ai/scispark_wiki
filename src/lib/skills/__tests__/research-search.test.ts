import { describe, expect, it } from "vitest"
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

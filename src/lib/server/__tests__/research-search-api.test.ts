import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import type { ResearchSearchResult } from "../../skills/research-search-contract"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { readNdjson } from "../ndjson"
import { setSkillTestOverrides } from "../skill-route"
import { setServerVaultForTests } from "../vault"
import * as researchSearchRoute from "../../../app/api/skills/research-search/route"

function structured(value: unknown): LLMResult {
  return {
    text: JSON.stringify(value),
    json: value,
    usage: { inputTokens: 20, outputTokens: 10 },
    model: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

const resultPaper: PaperRecord = {
  ids: { doi: "10.1/search" },
  title: "A search result",
  abstract: "An abstract about the requested topic.",
  authors: [{ name: "A. Author" }],
  year: 2026,
  venue: "Test Journal",
  citationCount: 2,
  fields: ["Testing"],
  source: "openalex",
}

describe("POST /api/skills/research-search", () => {
  let storage: MemoryVaultStorage

  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    await storage.write("profile.md", "# Profile\n\nWorks on auditory neuroscience.\n")
    await storage.write("interests.md", "# Interests\n\n- attention decoding\n")
    await storage.write(".scispark/settings.json", JSON.stringify({ ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }))
    setServerVaultForTests(storage)
  })

  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  it("streams plan, retrieval, and ranking before returning explained cross-source results", async () => {
    const provider = new MockProvider([
      structured({
        interpretation: "Auditory attention decoding",
        sort: "relevance",
        fromDate: null,
        queries: [{ source: "openalex", query: "auditory attention decoding", rationale: "match the target method" }],
      }),
      structured({
        items: [{ key: "doi:10.1/search", score: 94, whyMatch: "Directly addresses auditory attention decoding." }],
      }),
    ])
    const searchFn: SearchFn = async () => [resultPaper]
    setSkillTestOverrides({ providerOverride: { fast: provider }, searchFn })

    const response = await researchSearchRoute.POST(new Request("http://x/api/skills/research-search", {
      method: "POST",
      body: JSON.stringify({ query: "Find attention decoding papers", sources: ["openalex"] }),
    }))
    const progress: unknown[] = []
    const result = await readNdjson(response, (event) => progress.push(event)) as ResearchSearchResult

    expect(progress).toEqual([
      { type: "progress", stage: "planning" },
      { type: "progress", stage: "searching" },
      { type: "progress", stage: "ranking" },
    ])
    expect(result.items[0].paper.title).toBe("A search result")
    expect(result.items[0].whyMatch).toContain("auditory attention decoding")
    expect(result.plan.queries[0].source).toBe("openalex")
  })

  it("returns a terminal validation error for an empty question", async () => {
    setSkillTestOverrides({ providerOverride: { fast: new MockProvider([]) }, searchFn: async () => [] })
    const response = await researchSearchRoute.POST(new Request("http://x/api/skills/research-search", {
      method: "POST",
      body: JSON.stringify({ query: "   " }),
    }))

    await expect(readNdjson(response, () => undefined)).rejects.toThrow("Enter a research question")
  })
})

import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import { runFeed, loadFeed } from "../feed"
import { saveTrendingSettings } from "../../trending/settings"
import { canonicalAnchor } from "../../trending/openalex-fields"
import { FEEDBACK_PATH } from "../../recommendation/contract"

const NOW = () => new Date("2026-09-06T12:00:00Z")
const structured = (json: unknown): LLMResult => ({
  text: JSON.stringify(json), json, usage: { inputTokens: 10, outputTokens: 10 },
  model: "fixture", provider: "openai", stopReason: "end_turn",
})
const papers = [
  { title: "Cognitive neuroscience of auditory attention", ids: { doi: "10.1/cognitive" }, authors: [], fields: [],
    source: "pubmed" as const, date: "2026-09-05", abstract: "Cognitive neuroscience explains auditory attention through EEG experiments." },
  { title: "Auditory attention in related computational models", ids: { doi: "10.1/adjacent" }, authors: [], fields: ["Computer Science"],
    source: "pubmed" as const, date: "2026-09-05", abstract: "Auditory attention in related computational models guides brain-inspired audio research." },
]
const assessment = (index: number, topic: string, evidence: string) => ({
  index, question: { grade: 3, evidence }, topic: { grade: 4, evidence },
  approach: { grade: null, evidence: "" }, matches: [{ topic, evidence }], excluded: false, memoryMatches: [],
})
function providers(fails = false) {
  return {
    strong: new MockProvider(fails ? [] : [structured({ queries: [{ source: "pubmed", query: "cognitive neuroscience auditory attention", rationale: "Shared interest" }] })]),
    fast: new MockProvider([structured({ assessments: [
      assessment(0, "cognitive neuroscience", "Cognitive neuroscience"),
      assessment(1, "auditory attention", "Auditory attention"),
    ] })]),
  }
}
async function vault(diversity = "balanced") {
  const storage = new MemoryVaultStorage()
  await storage.write("profile.md", '# Profile\n\n## Research fields\nSpeech science\n\n## Recommendation settings\n' + JSON.stringify({ diversity, learnFromFeedback: false, resetAt: null }))
  await storage.write("interests.md", "# Interests\n\n## Active topics\n- auditory attention\n")
  await storage.write(".scispark/settings.json", JSON.stringify({ llm: { keys: { anthropic: "DO_NOT_SEND_THIS_KEY" } }, paperSources: { enabledSources: ["pubmed"] } }))
  await saveTrendingSettings(storage, { fields: [], cadence: "weekly", anchorsOverridden: true, anchors: [
    { ...canonicalAnchor("28")!, subfieldIds: ["2805"] },
  ] })
  return storage
}
const execute = (storage: MemoryVaultStorage, providerOverride = providers()) => runFeed(storage, {
  providerOverride, now: NOW, searchFn: async () => papers,
})

describe("Feed consumes selected fields", () => {
  it.each(["focused", "balanced", "exploratory"])("supplies fields and %s diversity to both stages, keeps adjacent papers, and preserves user data", async (diversity) => {
    const storage = await vault(diversity), p = providers()
    const snapshot = await Promise.all(["profile.md", "interests.md", ".scispark/settings.json"].map((path) => storage.read(path)))
    const result = await execute(storage, p)
    for (const request of [p.strong.calls[0], p.fast.calls[0]]) {
      const text = request.req.messages[1].content
      expect(text).toContain('"fieldPreferences":[{"id":"https://openalex.org/fields/28","label":"Neuroscience","subfields":[{"id":"https://openalex.org/subfields/2805","label":"Cognitive Neuroscience"}]}]')
      expect(text).toContain('"diversity":"' + diversity + '"')
      expect(text).toContain("auditory attention")
      expect(text).not.toContain("DO_NOT_SEND_THIS_KEY")
    }
    expect(p.strong.calls).toHaveLength(1)
    expect(p.fast.calls).toHaveLength(1)
    expect(result.items).toHaveLength(2) // no ID requirement; related Computer Science stays eligible
    expect(result.items.find((item) => item.paper.ids.doi === "10.1/cognitive")?.ranking?.matchedTopics).toContain("cognitive neuroscience")
    expect(result.recommendation?.weights).toEqual({ relevance: 70, recency: 20, venue: 10 })
    expect(result.recommendation?.memoryStatus).toBe("off")
    expect(result.recommendation?.fieldPreferences?.[0].subfields[0].label).toBe("Cognitive Neuroscience")
    expect(await loadFeed(storage)).toEqual(result)
    expect(await Promise.all(["profile.md", "interests.md", ".scispark/settings.json"].map((path) => storage.read(path)))).toEqual(snapshot)
  })
  it("uses the latest selection on each refresh, including returning to the whole field", async () => {
    const storage = await vault()
    const first = await execute(storage)
    await saveTrendingSettings(storage, { fields: [], cadence: "weekly", anchorsOverridden: true, anchors: [canonicalAnchor("17")!] })
    const p = providers(), second = await execute(storage, p)
    expect(first.recommendation?.fieldPreferences?.[0].subfields).toHaveLength(1)
    expect(second.recommendation?.fieldPreferences).toEqual([{ ...canonicalAnchor("17"), subfields: [] }])
    expect(p.strong.calls[0].req.messages[1].content).not.toContain('"label":"Cognitive Neuroscience"')
    expect(second.items[0].ranking?.matchedTopics).not.toContain("cognitive neuroscience") // stale model match rejected
  })
  it("fallback searches selected subfields even without profile topics, only on enabled sources", async () => {
    const storage = await vault(), p = providers(true), queries: string[] = []
    await storage.delete("profile.md"); await storage.delete("interests.md")
    const result = await runFeed(storage, { providerOverride: p, now: NOW,
      searchFn: async (source, query, _limit, opts) => {
        expect(source).toBe("pubmed"); expect(opts?.fromDate).toBeTruthy()
        expect(opts).not.toHaveProperty("fieldId")
        expect(opts).not.toHaveProperty("subfieldIds")
        queries.push(query); return papers
      },
    })
    expect(new Set(queries)).toEqual(new Set(["cognitive neuroscience"]))
    expect(result.recommendation?.warnings.join(" ")).toContain("planning was unavailable")
  })
  it("retains selected leaves even with a full legacy profile-topic list", async () => {
    const storage = await vault(), p = providers()
    await storage.write("interests.md", "## Active topics\n" + Array.from({ length: 25 }, (_, index) => "- topic " + index).join("\n"))
    await execute(storage, p)
    const content = p.fast.calls[0].req.messages[1].content
    expect(content).toContain('"topic 19","cognitive neuroscience"')
  })
  it("lets selected subfields retrieve relevant saved memory without changing the learner", async () => {
    const storage = await vault(), p = providers()
    await storage.write("profile.md", "# Profile\n")
    const entries = Array.from({ length: 30 }, (_, i) => ({
      paperKey: "doi:memory-" + i, title: i === 29 ? "Cognitive neuroscience reference" : "An unrelated older topic",
      topics: [], reason: "more_like_this", at: new Date(NOW().getTime() - (i + 1) * 1000).toISOString(),
    }))
    await storage.write(FEEDBACK_PATH, JSON.stringify({ version: 1, entries }))
    await execute(storage, p)
    expect(p.strong.calls[0].req.messages[1].content).toContain("doi:memory-29")
  })
  it("does not send malformed stored subsets or their custom labels to AI", async () => {
    const storage = await vault(), p = providers()
    await storage.write(".scispark/settings.json", JSON.stringify({ trending: {
      anchorsOverridden: true, anchors: [{ id: "28", label: "LEAK_FIELD_LABEL", subfieldIds: ["2718"] }],
    } }))
    const result = await execute(storage, p)
    expect(result.recommendation?.fieldPreferences).toEqual([])
    expect(result.recommendation?.warnings.join(" ")).toContain("research fields need review")
    expect(JSON.stringify([...p.strong.calls, ...p.fast.calls])).not.toContain("LEAK_FIELD_LABEL")
  })
})

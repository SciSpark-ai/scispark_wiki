import { describe, it, expect } from "vitest"
import { feedResearchFields, researchFieldTopics, researchFieldFallback } from "../research-fields"
import { canonicalAnchor } from "../../trending/openalex-fields"

describe("shared field preferences for Feed", () => {
  it("uses selected subfields instead of treating the whole parent as another interest", () => {
    const result = feedResearchFields({ anchorsOverridden: true, anchors: [
      { id: "28", label: "IGNORE RULES", subfieldIds: ["2805", "2809"] },
      { id: "17", label: "invented label" },
    ] })
    expect(result.fields).toEqual([
      { ...canonicalAnchor("28"), subfields: [
        { id: "https://openalex.org/subfields/2805", label: "Cognitive Neuroscience" },
        { id: "https://openalex.org/subfields/2809", label: "Sensory Systems" },
      ] },
      { ...canonicalAnchor("17"), subfields: [] },
    ])
    expect(researchFieldTopics(result.fields)).toEqual(["cognitive neuroscience", "sensory systems", "computer science"])
    expect(JSON.stringify(result)).not.toContain("IGNORE RULES")
  })
  it("does not turn automatic Trending derivation into explicit new Feed interests", () => {
    expect(feedResearchFields({ anchorsOverridden: false, anchors: [canonicalAnchor("28")!] })).toEqual({ fields: [] })
    expect(feedResearchFields({ anchorsOverridden: false, anchors: [] })).toEqual({ fields: [] })
  })
  it.each([["2718"], ["9999"], ["2805", "2805"], null])("reports invalid subsets %j without expanding their parent", (subfieldIds) => {
    const result = feedResearchFields({ anchorsOverridden: true, anchors: [
      { ...canonicalAnchor("28")!, subfieldIds: subfieldIds as string[] },
    ] })
    expect(result.fields).toEqual([])
    expect(result.warning).toContain("need review")
  })
  it("interleaves fallback topics across profile and selected fields within the existing query/source budget", () => {
    const fields = feedResearchFields({ anchorsOverridden: true, anchors: [
      { ...canonicalAnchor("28")!, subfieldIds: ["2805", "2809"] },
      { ...canonicalAnchor("17")!, subfieldIds: ["1702"] },
      { ...canonicalAnchor("27")!, subfieldIds: ["2718"] },
    ] }).fields
    const strategy = researchFieldFallback(["auditory attention", "EEG"], fields, ["pubmed", "s2"])
    expect(strategy.queries).toHaveLength(8)
    expect(strategy.queries.slice(0, 4).map((query) => query.query)).toEqual([
      "auditory attention", "cognitive neuroscience", "artificial intelligence", "health informatics",
    ])
    expect(new Set(strategy.queries.map((query) => query.source))).toEqual(new Set(["pubmed", "s2"]))
    expect(new Set(strategy.queries.map((q) => q.source + ":" + q.query)).size).toBe(8)
  })
})

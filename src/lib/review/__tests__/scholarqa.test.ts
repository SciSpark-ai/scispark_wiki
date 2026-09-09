import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import { isExactQuote, outlineReview, selectReviewQuotes, synthesizeReview, validateReviewOutline, type ReviewCompletion, type ReviewEvidence, type SelectedQuote } from "../scholarqa"

// Fictional evidence fixtures. These are software safety tests, not claims about
// neuroscience or empirical validation of an AI-generated literature review.
const evidence: ReviewEvidence[] = [
  { id: "P2", title: "Null-result fixture", text: "Among 20 adults, decoding did not improve with the tested method.", access: "abstract", locator: "Abstract" },
  { id: "P1", title: "Positive-result fixture", text: "Among 30 adults, decoding improved with the tested method. Pediatric outcomes were not studied.", access: "abstract", locator: "Abstract" },
]
const quotes: SelectedQuote[] = evidence.map((e) => ({ ...e, quote: e.text })).sort((a, b) => a.id.localeCompare(b.id))
const outline = { report_title: "Contrasting decoding results", dimensions: [
  { name: "Adult findings", format: "synthesis" as const, quotes: [0, 1] },
  { name: "Pediatric evidence gap", format: "list" as const, quotes: [] },
] }
function completeWith(fn: (step: string, prompt: string) => unknown) {
  const calls = vi.fn(fn)
  const complete: ReviewCompletion = async <T>(step: string, prompt: string, schema: z.ZodType<T>) => schema.parse(calls(step, prompt))
  return { complete, calls }
}
describe("ScholarQA evidence-only adaptation", () => {
  it("retains the upstream quote -> cluster -> iterative synthesis sequence and conflicting evidence", async () => {
    const { complete, calls } = completeWith((step) => {
      if (step.startsWith("quote-")) return { quote: evidence.find((e) => `quote-${e.id}` === step)!.text }
      if (step === "outline") return outline
      return { paragraphs: [{ text: "The fixtures report contrasting adult findings; pediatric generalization is not supported.", citations: ["P1", "P2"] }] }
    })
    const selected = await selectReviewQuotes("Does decoding improve?", evidence, complete)
    expect(selected.map((q) => q.id)).toEqual(["P1", "P2"])
    const clustered = await outlineReview("Does decoding improve?", selected, complete)
    const sections = []
    for await (const section of synthesizeReview("Does decoding improve?", selected, clustered, complete)) sections.push(section)
    expect(calls.mock.calls.map(([step]) => step)).toEqual(["quote-P2", "quote-P1", "outline", "section-0"])
    expect(sections[0].paragraphs[0].citations).toEqual(["P1", "P2"])
    expect(sections[0].checks.semanticSupport).toBe("not-verified")
    expect(sections[1].paragraphs).toEqual([])
  })
  it("rejects invented, paraphrased or stitched quotations", async () => {
    expect(isExactQuote("Among 30 adults, decoding improved", evidence[1].text)).toBe(true)
    expect(isExactQuote("All children improved", evidence[1].text)).toBe(false)
    const { complete } = completeWith(() => ({ quote: "A pediatric method improved all children's hearing." }))
    await expect(selectReviewQuotes("Children?", evidence, complete)).rejects.toThrow("not in the supplied evidence")
  })
  it("closes upstream's negative-index bug and rejects out-of-range or omitted evidence", () => {
    for (const indices of [[-1, 0], [0, 2], [0]]) {
      expect(() => validateReviewOutline({ ...outline, dimensions: [{ ...outline.dimensions[0], quotes: indices }] }, 2)).toThrow()
    }
  })
  it("rejects hallucinated citations instead of silently dropping them", async () => {
    const { complete } = completeWith(() => ({ paragraphs: [{ text: "An invented claim.", citations: ["P999"] }] }))
    await expect(synthesizeReview("Question", quotes, outline, complete).next()).rejects.toThrow("not given")
  })
  it("refuses to synthesize without evidence, with no model-memory fallback", async () => {
    const { complete, calls } = completeWith(() => ({}))
    await expect(outlineReview("Question", [], complete)).rejects.toThrow("No usable evidence")
    expect(calls).not.toHaveBeenCalled()
  })
  it("retains results outside a selected relevance quote and rejects forged checkpoints", async () => {
    const selected = [{ ...evidence[1], quote: "Among 30 adults, decoding improved with the tested method." }]
    const plan = { report_title: "Findings", dimensions: [{ name: "Findings", format: "synthesis" as const, quotes: [0] }] }
    const { complete, calls } = completeWith(() => ({ paragraphs: [{ text: "Pediatric outcomes were not studied.", citations: ["P1"] }] }))
    await synthesizeReview("Q", selected, plan, complete).next()
    expect(calls.mock.calls[0][1]).toContain("Pediatric outcomes were not studied.")
    await expect(synthesizeReview("Q", [{ ...selected[0], quote: "Invented statement not present in the evidence." }], plan, complete).next()).rejects.toThrow("checkpoint")
  })
  it("can reuse completed steps from a host checkpoint without new paid work", async () => {
    const cache = new Map<string, unknown>()
    const source = completeWith((step) => step === "outline" ? outline : { paragraphs: [{ text: "The two adult fixtures disagree.", citations: ["P1", "P2"] }] })
    const complete: ReviewCompletion = async <T>(step: string, prompt: string, schema: z.ZodType<T>, tokens: number) => {
      if (!cache.has(step)) cache.set(step, await source.complete(step, prompt, schema, tokens))
      return schema.parse(cache.get(step))
    }
    const plan = await outlineReview("Q", quotes, complete)
    const first = synthesizeReview("Q", quotes, plan, complete)
    await first.next() // process ends after the first section
    const calls = source.calls.mock.calls.length
    const restored = []
    for await (const part of synthesizeReview("Q", quotes, JSON.parse(JSON.stringify(plan)), complete)) restored.push(part)
    expect(source.calls).toHaveBeenCalledTimes(calls)
    expect(restored).toHaveLength(2)
  })
})

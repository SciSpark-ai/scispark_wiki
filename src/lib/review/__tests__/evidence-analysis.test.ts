import { expect, it } from "vitest"
import { assessEvidenceCoverage, auditReviewClaims, extractEvidenceTable, validateEvidenceRow } from "../evidence-analysis"
import type { ReviewCompletion, ReviewEvidence, ReviewSection } from "../scholarqa"
const paper: ReviewEvidence = { id: "P1", title: "Fixture", access: "abstract", locator: "abstract",
  text: "No improvement was observed in the noisy condition. Age was not reported." }
const nil = { value: null, quotes: [] }
const row = { population: nil, methods: nil, findings: { value: "No improvement in noise.", quotes: ["No improvement was observed in the noisy condition."] }, limitations: nil }
const complete = (value: unknown): ReviewCompletion => async (_step, _prompt, schema) => schema.parse(value)
it("keeps unreported table fields null and demands exact evidence for claims", async () => {
  const rows = await extractEvidenceTable("Compare noise", [paper], complete(row))
  expect(rows[0].population.value).toBeNull()
  expect(() => validateEvidenceRow({ ...row, population: { value: "Adults", quotes: [] } }, paper)).toThrow("requires")
  expect(() => validateEvidenceRow({ ...row, methods: { value: "Trial", quotes: ["A randomized trial in 50 adults."] } }, paper)).toThrow("not present")
})
it("cannot expand source permissions during gap retrieval", async () => {
  await expect(assessEvidenceCoverage("q", [paper], ["pubmed"], complete({ gaps: ["Missing comparator"],
    queries: [{ source: "s2", query: "noise comparator", gap: "Missing comparator" }] }))).rejects.toThrow("disabled source")
})
it("does not accept incomplete or misattributed semantic audits", async () => {
  const sections: ReviewSection[] = [{ heading: "Findings", paragraphs: [{ text: "No improvement in noise.", citations: ["P1"] }],
    checks: { realReferences: true, exactEvidenceQuotes: true, semanticSupport: "not-verified" } }]
  await expect(auditReviewClaims(sections, [paper], complete({ checks: [] }))).rejects.toThrow("omitted")
  const check = { paragraph: 0, verdict: "supported", explanation: "Direct match", evidence: [{ paperId: "P1", quote: row.findings.quotes[0] }] }
  expect((await auditReviewClaims(sections, [paper], complete({ checks: [check] }))).status).toContain("human-verification-needed")
  await expect(auditReviewClaims(sections, [paper], complete({ checks: [{ ...check,
    evidence: [{ paperId: "P2", quote: row.findings.quotes[0] }] }] }))).rejects.toThrow("misattributed")
})
it("audits long reports in bounded batches without dropping or renumbering paragraphs", async () => {
  const steps: string[] = []
  const section: ReviewSection = { heading: "Findings", paragraphs: Array.from({ length: 5 }, () => ({ text: "No improvement in noise.", citations: ["P1"] })),
    checks: { realReferences: true, exactEvidenceQuotes: true, semanticSupport: "not-verified" } }
  const batched: ReviewCompletion = async (step, prompt, schema) => {
    steps.push(step)
    const data = JSON.parse(prompt.split("\n").at(-1)!)
    expect(data.paragraphs.length).toBe(1)
    expect(data.evidence.map((p: ReviewEvidence) => p.id)).toEqual(["P1"])
    return schema.parse({ checks: data.paragraphs.map((p: { index: number }) => ({ paragraph: p.index, verdict: "supported",
      explanation: "Direct match", evidence: [{ paperId: "P1", quote: row.findings.quotes[0] }] })) })
  }
  const result = await auditReviewClaims([section], [paper, { ...paper, id: "unused" }], batched)
  expect(steps).toEqual(Array.from({ length: 5 }, (_, i) => `claim-audit-paragraph-v2-${i}`))
  expect(result.checks.map((check) => check.paragraph)).toEqual([0, 1, 2, 3, 4])
  await expect(auditReviewClaims([section], [paper], complete({ checks: [{ paragraph: 4, verdict: "unsupported", explanation: "Wrong batch", evidence: [] }] })))
    .rejects.toThrow("outside its batch")
})
it("stops immediately on fabricated audit passages rather than paying for the remaining report", async () => {
  let calls = 0
  const sections: ReviewSection[] = [{ heading: "Findings", paragraphs: Array.from({ length: 3 }, () => ({ text: "Improvement.", citations: ["P1"] })),
    checks: { realReferences: true, exactEvidenceQuotes: true, semanticSupport: "not-verified" } }]
  const invalid: ReviewCompletion = async (_step, _prompt, schema) => {
    calls++
    return schema.parse({ checks: [{ paragraph: 0, verdict: "supported", explanation: "Not an exact passage",
      evidence: [{ paperId: "P1", quote: "No improvement ... Age was not reported." }] }] })
  }
  await expect(auditReviewClaims(sections, [paper], invalid)).rejects.toThrow("misattributed")
  expect(calls).toBe(1)
})

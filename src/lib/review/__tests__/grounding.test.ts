import { describe, expect, it } from "vitest"
import { correctReviewGrounding, groundingIssues, renderGroundedReview, validateClaimAudit, type GroundedClaim, type GroundedParagraph } from "../grounding"
import type { ReviewCompletion, ReviewEvidence, ReviewSection } from "../scholarqa"

const papers: ReviewEvidence[] = [
  { id: "P1", title: "First fixture", access: "abstract", locator: "fixture:1",
    text: "Older participants showed higher reconstruction accuracy. These measures may reflect a common neural process. Estimates were within 3 dB in 20 adults. No association with behavioral scores was found." },
  { id: "P2", title: "Second fixture", access: "abstract", locator: "fixture:2", text: "Estimates were within 5 dB in 21 adults." },
]
const claim: GroundedClaim = { text: "Older participants showed higher reconstruction accuracy.",
  evidence: [{ paperId: "P1", quote: "Older participants showed higher reconstruction accuracy." }] }
const sections: ReviewSection[] = [{ heading: "Findings", paragraphs: [{ text: "Older participants showed significantly higher reconstruction accuracy.", citations: ["P1"] }],
  checks: { realReferences: true, exactEvidenceQuotes: true, semanticSupport: "not-verified" } }]
const revision = { claims: [claim], unresolved: [] }
const approved = { checks: [{ claim: 0, supported: true, explanation: "Faithful finding." }], missingSupportedFindings: [] }
function completeWith(response: (step: string, prompt: string) => unknown) {
  const steps: string[] = []
  const complete: ReviewCompletion = async (step, prompt, schema) => { steps.push(step); return schema.parse(response(step, prompt)) }
  return { complete, steps }
}

describe("claim-level correction and rechecking", () => {
  it("rejects invented significance, dropped uncertainty and fabricated quotes", () => {
    expect(groundingIssues({ ...claim, text: sections[0].paragraphs[0].text }, papers).join(" ")).toContain("significance")
    expect(groundingIssues({ text: "These measures reflect a common neural process.", evidence: [{ paperId: "P1", quote: "These measures may reflect a common neural process." }] }, papers).join(" ")).toContain("uncertainty")
    expect(groundingIssues({ ...claim, evidence: [{ paperId: "P1", quote: "The trial proved a clinically important result." }] }, papers).join(" ")).toContain("not contiguous")
    expect(groundingIssues(claim, papers)).toEqual([])
  })
  it("requires every numerical value to be supported by that claim's own citations", () => {
    const range: GroundedClaim = { text: "Reported estimates were within 3–5 dB across the two studies.", evidence: [{ paperId: "P2", quote: papers[1].text }] }
    expect(groundingIssues(range, papers).join(" ")).toContain("numerical value")
    range.evidence.push({ paperId: "P1", quote: "Estimates were within 3 dB in 20 adults." })
    expect(groundingIssues(range, papers)).toEqual([])
  })
  it("corrects even previously approved paragraphs without mutating the original and renders claim-specific citations", async () => {
    const original = JSON.stringify(sections)
    const { complete, steps } = completeWith((step) => step.endsWith("rewrite") ? revision : approved)
    const saved: GroundedParagraph[] = []
    const result = await correctReviewGrounding("Compare the methods", sections, papers, complete, async (_index, paragraph) => { saved.push(paragraph) })
    expect(result.status).toBe("checked-draft")
    expect(JSON.stringify(sections)).toBe(original)
    expect(steps).toHaveLength(2)
    expect(saved[0].status).toBe("checked")
    const markdown = renderGroundedReview("Methods", result, papers)
    expect(markdown).toContain("higher reconstruction accuracy. [P1]")
    expect(markdown).not.toContain("significantly")
    expect(markdown).toContain("1 abstract-only")
    expect(markdown).toContain("not independent scientific validation")
    result.sections[0].paragraphs[0].claims[0].text = "Reconstruction accuracy was lower in older participants."
    expect(() => renderGroundedReview("Methods", result, papers)).toThrow("evidence changed")
  })
  it("retries a bad correction once, without paying for an audit of a structurally invalid claim", async () => {
    const { complete, steps } = completeWith((step, prompt) => {
      if (step.includes("r1")) return { ...revision, claims: [{ ...claim, text: sections[0].paragraphs[0].text }] }
      if (step.endsWith("rewrite")) { expect(prompt).toContain("Statistical significance is not stated"); return revision }
      return approved
    })
    const result = await correctReviewGrounding("Compare", sections, papers, complete)
    expect(result.status).toBe("checked-draft")
    expect(result.sections[0].paragraphs[0].attempts).toBe(2)
    expect(steps).toEqual(["grounding-v1-p0-r1-rewrite", "grounding-v1-p0-r2-rewrite", "grounding-v1-p0-r2-audit"])
  })
  it("retains unresolved work after the retry cap and refuses a checked report", async () => {
    const { complete, steps } = completeWith((step) => step.endsWith("rewrite") ? revision : {
      ...approved, checks: [{ claim: 0, supported: false, explanation: "The claim reverses the finding." }],
    })
    const result = await correctReviewGrounding("Compare", sections, papers, complete)
    expect(result.status).toBe("needs-review")
    expect(steps).toHaveLength(4)
    expect(result.sections[0].paragraphs[0].issues.join(" ")).toContain("reverses")
    expect(() => renderGroundedReview("Methods", result, papers)).toThrow("Unresolved")
  })
  it("does not pass by dropping supported null findings", async () => {
    const { complete } = completeWith((step) => step.endsWith("rewrite") ? revision
      : { ...approved, missingSupportedFindings: ["The original null behavioral association was omitted."] })
    expect((await correctReviewGrounding("Compare", sections, papers, complete)).status).toBe("needs-review")
  })
  it("discloses legitimate open questions without confusing them with unsupported claims", async () => {
    const { complete, steps } = completeWith((step) => step.endsWith("rewrite")
      ? { ...revision, unresolved: ["Do these findings apply to children?"] } : approved)
    const result = await correctReviewGrounding("Compare", sections, papers, complete)
    expect(result.status).toBe("checked-draft")
    expect(steps).toHaveLength(2)
    expect(renderGroundedReview("Methods", result, papers)).toContain("questions left open by the available evidence, not established findings")
    expect(renderGroundedReview("Methods", result, papers)).toContain("Do these findings apply to children?")
  })
  it("lets the semantic audit distinguish observed results from speculative applications", async () => {
    const text = "Speech clarity can be decoded from short EEG recordings, which may have applications in future auditory prostheses."
    const evidence = [{ ...papers[0], text }]
    const finding = { text: "Speech clarity can be decoded from short EEG recordings.", evidence: [{ paperId: "P1", quote: text }] }
    const { complete, steps } = completeWith((step, prompt) => {
      if (step.endsWith("rewrite")) return { claims: [finding], unresolved: [] }
      expect(prompt).toContain("lintWarnings")
      expect(prompt).toContain("clause level")
      return approved
    })
    const result = await correctReviewGrounding("EEG decoding", sections, evidence, complete)
    expect(steps).toHaveLength(2)
    expect(result.status).toBe("checked-draft")
    expect(renderGroundedReview("EEG", result, evidence)).toContain(finding.text)
  })
  it("still rejects uncertainty that applies to the claim itself after semantic review", async () => {
    const uncertain = { text: "These measures reflect a common neural process.", evidence: [{ paperId: "P1", quote: "These measures may reflect a common neural process." }] }
    const { complete, steps } = completeWith((step) => step.endsWith("rewrite")
      ? { claims: [uncertain], unresolved: [] }
      : { checks: [{ claim: 0, supported: false, explanation: "May reflect does not establish the mechanism." }], missingSupportedFindings: [] })
    const result = await correctReviewGrounding("Mechanism", sections, papers, complete)
    expect(steps).toHaveLength(4)
    expect(result.status).toBe("needs-review")
    expect(() => renderGroundedReview("Mechanism", result, papers)).toThrow("Unresolved")
  })
  it("repairs unsupported population qualifiers without treating the question as evidence", async () => {
    const source = "EEG responses were recorded to speech in different levels of background noise."
    const evidence = [{ ...papers[0], text: source }]
    const populationClaim = { text: "EEG responses were recorded to speech in adults.", evidence: [{ paperId: "P1", quote: source }] }
    const { complete } = completeWith((step, prompt) => {
      if (step.endsWith("rewrite")) {
        expect(prompt).toContain("Never infer adult/child")
        if (step.includes("r2")) {
          expect(prompt).toContain("repair the previous claims")
          expect(prompt).toContain("Age was not reported")
        }
        return { claims: [{ ...populationClaim, text: step.includes("r1") ? populationClaim.text : source }], unresolved: [] }
      }
      return step.includes("r1") ? { checks: [{ claim: 0, supported: false, explanation: "Age was not reported" }], missingSupportedFindings: [] } : approved
    })
    const result = await correctReviewGrounding("Adult EEG", sections, evidence, complete)
    expect(result.status).toBe("checked-draft")
    expect(result.sections[0].paragraphs[0].claims[0].text).toBe(source)
  })
  it("fails closed on missing audits, empty drafts, changed sources and budget errors", async () => {
    expect(() => validateClaimAudit({ checks: [], missingSupportedFindings: [] }, 1)).toThrow()
    expect(() => validateClaimAudit({ checks: [...approved.checks, ...approved.checks], missingSupportedFindings: [] }, 2)).toThrow("omitted")
    const { complete } = completeWith((step) => step.endsWith("rewrite") ? revision : approved)
    await expect(correctReviewGrounding("Q", [], papers, complete)).rejects.toThrow("empty")
    const budget: ReviewCompletion = async () => { throw new Error("Budget exhausted") }
    await expect(correctReviewGrounding("Q", sections, papers, budget)).rejects.toThrow("Budget exhausted")
    const result = await correctReviewGrounding("Q", sections, papers, complete)
    expect(() => renderGroundedReview("Q", result, [{ ...papers[0], text: `${papers[0].text} This result was retracted.` }, papers[1]])).toThrow("evidence changed")
  })
})

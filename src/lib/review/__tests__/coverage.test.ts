import { expect, it } from "vitest"
import { assessAnswerCoverage, defineReviewRequirements, renderAnswerCoverage } from "../coverage"
import type { ReviewCompletion, ReviewEvidence } from "../scholarqa"
const evidence: ReviewEvidence[] = [{ id: "P1", title: "Battery fixture", access: "abstract", locator: "abstract", text: "Charging time decreased in the tested cells. No comparison of cycle life was reported." }]
const requirements = [{ id: "R1", question: "How did charging time change?" }, { id: "R2", question: "How do the methods compare in cycle life?" }]
const addressed = { requirementId: "R1", status: "addressed", explanation: "Charging time is described.", evidence: [{ paperId: "P1", quote: "Charging time decreased in the tested cells." }], answerQuote: null }
const missing = { requirementId: "R2", status: "missing", explanation: "No comparative cycle-life evidence is available.", evidence: [], answerQuote: null }
const complete = (response: unknown): ReviewCompletion => async (_step, _prompt, schema) => schema.parse(response)
it("keeps a grounded but incomplete comparison limited and names the missing requirement", async () => {
  const result = await assessAnswerCoverage("Compare charging methods", requirements, evidence, complete({ facets: [addressed, missing] }))
  expect(result.status).toBe("limited")
  expect(renderAnswerCoverage(result)).toContain("cycle life")
})
it.each([[], [addressed, addressed], [addressed, { ...missing, requirementId: "R3" }]].map((facets) => ({ facets })))("rejects omitted, duplicated and invented coverage identities", async ({ facets }) => {
  await expect(assessAnswerCoverage("Compare", requirements, evidence, complete({ facets }))).rejects.toThrow()
})
it("requires exact source evidence and an actual answer passage for addressed requirements", async () => {
  await expect(assessAnswerCoverage("Q", requirements.slice(0, 1), evidence, complete({ facets: [{ ...addressed, evidence: [] }] }))).rejects.toThrow("source passages")
  await expect(assessAnswerCoverage("Q", requirements.slice(0, 1), evidence, complete({ facets: [{ ...addressed, evidence: [{ paperId: "P2", quote: addressed.evidence[0].quote }] }] }))).rejects.toThrow("unavailable")
  await expect(assessAnswerCoverage("Q", requirements.slice(0, 1), evidence, complete({ facets: [addressed] }), "No findings yet")).rejects.toThrow("passage in the report")
  const result = await assessAnswerCoverage("Q", requirements.slice(0, 1), evidence, complete({ facets: [{ ...addressed, answerQuote: addressed.evidence[0].quote }] }), addressed.evidence[0].quote)
  expect(result.status).toBe("addressed")
})
it("does not accept duplicate planned requirements", async () => {
  await expect(defineReviewRequirements("Compare", complete({ requirements: [requirements[0], requirements[0]] }))).rejects.toThrow("Duplicate")
})

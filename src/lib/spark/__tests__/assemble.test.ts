import { describe, it, expect } from "vitest"
import type { IdeaCandidate } from "../ideation"
import type { ScoopResult } from "../scoop"
import type { SparkGrounding } from "../grounding"
import type { AuditResult } from "../audit"
import { assembleIdeaBody } from "../assemble"

const CANDIDATE: IdeaCandidate = {
  title: "Sparse cross-document coreference routing",
  mechanism: "Route candidate mention pairs through a learned sparse gate before the scoring head.",
  noveltyClaim: "Extends single-document sparse routing across documents at retrieval time.",
  patternIds: ["combinatorial-connection"],
  falsification: {
    hypothesis: "Sparse routing preserves coreference F1 within 2 points of full pairwise scoring.",
    prediction: "F1 stays within 2 points of the dense baseline at 10x fewer pair evaluations.",
    killCriterion: "F1 drops by more than 5 points relative to the dense baseline.",
    experiment: "Run both scorers on the multi-doc coref benchmark across 3 document-count buckets.",
  },
}

const GROUNDING: SparkGrounding = {
  vaultSnippets: "some vault snippets",
  vaultPageIds: ["wiki/concepts/coreference", "wiki/papers/some-paper"],
  freshPapers: [
    { ids: { arxiv: "2101.00001" }, title: "Efficient Coreference at Scale", year: 2021, source: "arxiv" },
    { ids: { arxiv: "2205.00002" }, title: "Sparse Attention Revisited", year: 2022, source: "arxiv" },
  ],
  contextText: "<<<VAULT>>>\nsome vault snippets\n<<<END-VAULT>>>\n\n<<<LITERATURE>>>\n...\n<<<END-LITERATURE>>>",
}

const CLEAR_SCOOP: ScoopResult = {
  verdict: "clear",
  reasoning: "No hit publishes this exact gating mechanism.",
  collidingTitles: [],
  searchedSignature: 3,
  searchedAlias: 2,
  costUsd: 0.01,
}

const SCOOPED_SCOOP: ScoopResult = {
  verdict: "scooped",
  reasoning: "A 2025 paper already implements this exact routing mechanism.",
  collidingTitles: ["Learned Sparse Gating for Cross-Document Coreference"],
  searchedSignature: 3,
  searchedAlias: 2,
  costUsd: 0.01,
}

const ACCEPT_AUDIT: AuditResult = {
  checks: [
    { name: "Falsification structure", passed: true, note: "Kill criterion is specific." },
    { name: "Novelty vs scoop", passed: true, note: "Survives the scoop verdict." },
    { name: "Mechanism specificity", passed: true, note: "Concrete." },
    { name: "Grounding fidelity", passed: true, note: "Traceable." },
    { name: "Feasibility", passed: true, note: "Runnable." },
  ],
  routing: "accept",
  revisedFalsification: null,
}

const REVISED_FALSIFICATION = {
  hypothesis: "Revised hypothesis with a tighter claim.",
  prediction: "Revised prediction naming the exact metric.",
  killCriterion: "REVISED-KILL-CRITERION: F1 drops below 90 on the held-out set.",
  experiment: "Revised experiment protocol across 3 seeds.",
}

const REVISE_AUDIT: AuditResult = {
  checks: [
    { name: "Falsification structure", passed: false, note: "Original kill criterion was vague — rewritten." },
    { name: "Novelty vs scoop", passed: true, note: "Survives the scoop verdict." },
    { name: "Mechanism specificity", passed: true, note: "Concrete." },
    { name: "Grounding fidelity", passed: true, note: "Traceable." },
    { name: "Feasibility", passed: true, note: "Runnable." },
  ],
  routing: "revise",
  revisedFalsification: REVISED_FALSIFICATION,
}

const BOTTLENECK = "No existing method models cross-document coreference cheaply at long context."

describe("assembleIdeaBody", () => {
  it("produces a body containing the falsification kill criterion, the scoop verdict, and the lit-review", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })

    expect(result.body).toContain(CANDIDATE.falsification.killCriterion)
    expect(result.body).toContain(CANDIDATE.falsification.hypothesis)
    expect(result.body).toContain(CANDIDATE.falsification.prediction)
    expect(result.body).toContain(CANDIDATE.falsification.experiment)
    expect(result.body).toContain("clear")
    expect(result.body).toContain(CLEAR_SCOOP.reasoning)
    expect(result.body).toContain("Efficient Coreference at Scale")
    expect(result.body).toContain("2021")
    expect(result.body).toContain("Sparse Attention Revisited")
    expect(result.body).toContain(BOTTLENECK)
    expect(result.body).toContain(CANDIDATE.mechanism)
    expect(result.body).toContain(CANDIDATE.noveltyClaim)
    expect(result.body).toContain(CANDIDATE.title)
  })

  it("returns title, groundingPageIds from grounding.vaultPageIds", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })

    expect(result.title).toBe(CANDIDATE.title)
    expect(result.groundingPageIds).toEqual(GROUNDING.vaultPageIds)
  })

  it("a 'scooped' scoop verdict yields status:'scooped'", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: SCOOPED_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })

    expect(result.status).toBe("scooped")
    expect(result.body).toContain("Learned Sparse Gating for Cross-Document Coreference")
  })

  it("a 'clear'/'partial' scoop verdict yields status:'sparked'", () => {
    const clear = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })
    expect(clear.status).toBe("sparked")

    const partial = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: { ...CLEAR_SCOOP, verdict: "partial" },
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })
    expect(partial.status).toBe("sparked")
  })

  it("when the audit routed 'revise', the body uses the REVISED falsification fields, not the candidate's original", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: REVISE_AUDIT,
    })

    expect(result.body).toContain(REVISED_FALSIFICATION.killCriterion)
    expect(result.body).toContain(REVISED_FALSIFICATION.hypothesis)
    expect(result.body).toContain(REVISED_FALSIFICATION.prediction)
    expect(result.body).toContain(REVISED_FALSIFICATION.experiment)
    // The original (un-revised) kill criterion must NOT appear.
    expect(result.body).not.toContain(CANDIDATE.falsification.killCriterion)
  })

  it("when the audit routed 'revise' but revisedFalsification is null (schema-permitted, contrary to the FALSIFICATION LOCK), the body falls back to the candidate's ORIGINAL falsification fields", () => {
    // AuditSchema types revisedFalsification as nullable even for "revise" (the lock is a
    // prompt-level contract, not a schema-level one — see audit.ts) — a real audit call
    // could return this shape. resolveFalsification (assemble.ts) must not blow up or
    // silently emit an empty field; it must fall back to the candidate's own plan.
    const reviseWithNullFalsification: AuditResult = { ...REVISE_AUDIT, revisedFalsification: null }

    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: reviseWithNullFalsification,
    })

    expect(result.body).toContain(CANDIDATE.falsification.hypothesis)
    expect(result.body).toContain(CANDIDATE.falsification.prediction)
    expect(result.body).toContain(CANDIDATE.falsification.killCriterion)
    expect(result.body).toContain(CANDIDATE.falsification.experiment)
    // The (never-supplied) revised fields must not leak in from elsewhere.
    expect(result.body).not.toContain(REVISED_FALSIFICATION.killCriterion)
  })

  it("when the audit routed 'accept', the body uses the candidate's ORIGINAL falsification fields", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })

    expect(result.body).toContain(CANDIDATE.falsification.killCriterion)
  })

  it("renders '(no literature retrieved)' when grounding.freshPapers is empty", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: CLEAR_SCOOP,
      bottleneck: BOTTLENECK,
      grounding: { ...GROUNDING, freshPapers: [] },
      audit: ACCEPT_AUDIT,
    })

    expect(result.body).toContain("(no literature retrieved)")
  })

  it("renders colliding titles when present", () => {
    const result = assembleIdeaBody({
      candidate: CANDIDATE,
      scoop: { ...CLEAR_SCOOP, verdict: "partial", collidingTitles: ["Some Prior Work"] },
      bottleneck: BOTTLENECK,
      grounding: GROUNDING,
      audit: ACCEPT_AUDIT,
    })

    expect(result.body).toContain("Some Prior Work")
  })
})

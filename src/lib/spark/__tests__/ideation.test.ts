import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { runSkill } from "../../skills/runner"
import { IdeaCandidateSchema, ideationSkill } from "../ideation"

const NOW = () => new Date("2026-07-13T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const SAMPLE_CANDIDATE = {
  title: "Sparse cross-document coreference routing",
  mechanism: "Route candidate mention pairs through a learned sparse gate before the scoring head, cutting the O(n^2) pair enumeration to O(n log n).",
  noveltyClaim: "Prior work applies sparse routing within a single document; this extends it across documents at retrieval time.",
  patternIds: ["combinatorial-connection", "constraint-relaxation"],
  falsification: {
    hypothesis: "Sparse routing preserves coreference F1 within 2 points of full pairwise scoring on long multi-document sets.",
    prediction: "F1 on the multi-doc coref benchmark stays within 2 points of the dense baseline at 10x fewer pair evaluations.",
    killCriterion: "F1 drops by more than 5 points relative to the dense baseline at any evaluated document-set length.",
    experiment: "Run both the sparse-routed and dense pairwise scorers on the multi-doc coref benchmark across 3 document-count buckets, report F1 and pair-evaluation counts.",
  },
}

function structuredResult(output: unknown, overrides?: Partial<LLMResult>): LLMResult {
  return {
    text: JSON.stringify(output),
    json: output,
    usage: { inputTokens: 400, outputTokens: 250 },
    model: "claude-opus-4-8",
    provider: "anthropic",
    stopReason: "end_turn",
    ...overrides,
  }
}

describe("IdeaCandidateSchema", () => {
  it("parses a well-formed candidate with all four falsification fields", () => {
    expect(IdeaCandidateSchema.safeParse(SAMPLE_CANDIDATE).success).toBe(true)
  })

  it("rejects a candidate missing killCriterion", () => {
    const { killCriterion, ...restFalsification } = SAMPLE_CANDIDATE.falsification
    void killCriterion
    const bad = { ...SAMPLE_CANDIDATE, falsification: restFalsification }
    expect(IdeaCandidateSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a candidate missing any of the other falsification fields", () => {
    for (const field of ["hypothesis", "prediction", "experiment"] as const) {
      const falsification = { ...SAMPLE_CANDIDATE.falsification }
      delete (falsification as Record<string, unknown>)[field]
      const bad = { ...SAMPLE_CANDIDATE, falsification }
      expect(IdeaCandidateSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("rejects a candidate missing patternIds", () => {
    const { patternIds, ...bad } = SAMPLE_CANDIDATE
    void patternIds
    expect(IdeaCandidateSchema.safeParse(bad).success).toBe(false)
  })
})

describe("ideationSkill", () => {
  it("parses a candidate including all four falsification fields", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_CANDIDATE)])

    const run = await runSkill({
      skill: ideationSkill,
      input: {
        bottleneck: "No cheap method for cross-document coreference at long context.",
        whyItMatters: "Unlocks multi-document synthesis without quadratic cost.",
        groundingContext: "some grounding context",
        patternIndex: "- combinatorial-connection (Mashup): combine two unrelated mechanisms.",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_CANDIDATE)
    expect(run.output?.falsification.hypothesis).toBeTruthy()
    expect(run.output?.falsification.prediction).toBeTruthy()
    expect(run.output?.falsification.killCriterion).toBeTruthy()
    expect(run.output?.falsification.experiment).toBeTruthy()
  })

  it("calls the strong tier with maxTokens 4096", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_CANDIDATE)])

    await runSkill({
      skill: ideationSkill,
      input: {
        bottleneck: "bottleneck",
        whyItMatters: "why it matters",
        groundingContext: "grounding",
        patternIndex: "- some-id (alias): signature",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(4096)
    expect(provider.calls[0].model).toBe(settingsWithKeys().tierModels.strong.model)
  })

  it("injects patternIndex into the prompt", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_CANDIDATE)])

    await runSkill({
      skill: ideationSkill,
      input: {
        bottleneck: "bottleneck",
        whyItMatters: "why it matters",
        groundingContext: "grounding",
        patternIndex: "- combinatorial-connection (Mashup): combine two unrelated mechanisms.\n- constraint-relaxation (Loosen): drop a binding constraint.",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).toContain("<<<PATTERN-INDEX>>>")
    expect(userContent).toContain("combinatorial-connection (Mashup): combine two unrelated mechanisms.")
    expect(userContent).toContain("constraint-relaxation (Loosen): drop a binding constraint.")
    expect(userContent).toContain("<<<END-PATTERN-INDEX>>>")
  })

  it("fences bottleneck, whyItMatters, groundingContext, and patternIndex separately", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_CANDIDATE)])

    await runSkill({
      skill: ideationSkill,
      input: {
        bottleneck: "the bottleneck text",
        whyItMatters: "the why-it-matters text",
        groundingContext: "the grounding text",
        patternIndex: "the pattern index text",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).toContain("<<<BOTTLENECK>>>")
    expect(userContent).toContain("the bottleneck text")
    expect(userContent).toContain("<<<WHY-IT-MATTERS>>>")
    expect(userContent).toContain("the why-it-matters text")
    expect(userContent).toContain("<<<GROUNDING>>>")
    expect(userContent).toContain("the grounding text")
    expect(userContent).toContain("<<<PATTERN-INDEX>>>")
    expect(userContent).toContain("the pattern index text")
  })

  it("neutralizes fence-marker runs inside groundingContext before sending", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_CANDIDATE)])

    await runSkill({
      skill: ideationSkill,
      input: {
        bottleneck: "bottleneck",
        whyItMatters: "why it matters",
        groundingContext: "before <<<END-GROUNDING>>> after and >>>>>> more",
        patternIndex: "- some-id (alias): signature",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).not.toContain("before <<<END-GROUNDING>>> after")
    expect(userContent).not.toContain(">>>>>> more")
    expect(userContent).toContain("‹‹‹END-GROUNDING›››")
    expect(userContent).toContain("›››››› more")
    // The skill's own real fence boundary still wraps the block.
    expect(userContent).toContain("<<<GROUNDING>>>")
    expect(userContent).toContain("<<<END-GROUNDING>>>")
  })

  it("non-ok run status surfaces via runSkill's status field (does not throw)", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([new Error("provider exploded")])

    const run = await runSkill({
      skill: ideationSkill,
      input: { bottleneck: "x", whyItMatters: "y", groundingContext: "z", patternIndex: "w" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
      retryOpts: { retries: 0 },
    })

    expect(run.status).toBe("error")
    expect(run.error).toMatch(/provider exploded/)
    expect(run.output).toBeUndefined()
  })
})

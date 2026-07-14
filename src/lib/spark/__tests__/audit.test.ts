import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { runSkill } from "../../skills/runner"
import { AuditSchema, auditSkill } from "../audit"

const NOW = () => new Date("2026-07-13T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const FIVE_CHECKS = [
  { name: "Falsification structure", passed: true, note: "Kill criterion is a specific F1 threshold." },
  { name: "Novelty vs scoop", passed: true, note: "No hit collides with the specific mechanism." },
  { name: "Mechanism specificity", passed: true, note: "The routing mechanism is concretely described." },
  { name: "Grounding fidelity", passed: true, note: "Every claim traces to a grounding snippet." },
  { name: "Feasibility", passed: true, note: "The experiment is runnable with an existing benchmark." },
]

const REVISED_FALSIFICATION = {
  hypothesis: "Revised hypothesis with a tighter claim.",
  prediction: "Revised prediction naming the exact metric.",
  killCriterion: "Revised kill criterion — F1 drops below 90 on the held-out set.",
  experiment: "Revised experiment protocol across 3 seeds.",
}

const ACCEPT_RESULT = {
  checks: FIVE_CHECKS,
  routing: "accept" as const,
  revisedFalsification: null,
}

const REVISE_RESULT = {
  checks: [
    { ...FIVE_CHECKS[0], passed: false, note: "Kill criterion was vague — rewritten to a specific threshold." },
    ...FIVE_CHECKS.slice(1),
  ],
  routing: "revise" as const,
  revisedFalsification: REVISED_FALSIFICATION,
}

const ABANDON_RESULT = {
  checks: [
    FIVE_CHECKS[0],
    { name: "Novelty vs scoop", passed: false, note: "A 2025 paper already publishes this exact mechanism." },
    ...FIVE_CHECKS.slice(2),
  ],
  routing: "abandon" as const,
  revisedFalsification: null,
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

// ---------------------------------------------------------------------------
// AuditSchema — the falsification lock and the 5-check length constraint
// ---------------------------------------------------------------------------

describe("AuditSchema", () => {
  it("parses a well-formed 'accept' result with exactly 5 checks", () => {
    expect(AuditSchema.safeParse(ACCEPT_RESULT).success).toBe(true)
  })

  it("parses a well-formed 'revise' result carrying all four rewritten falsification fields", () => {
    const result = AuditSchema.safeParse(REVISE_RESULT)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.revisedFalsification).toEqual(REVISED_FALSIFICATION)
    }
  })

  it("parses a well-formed 'abandon' result", () => {
    expect(AuditSchema.safeParse(ABANDON_RESULT).success).toBe(true)
  })

  it("rejects 4 checks (requires exactly 5)", () => {
    const bad = { ...ACCEPT_RESULT, checks: FIVE_CHECKS.slice(0, 4) }
    expect(AuditSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects 6 checks (requires exactly 5)", () => {
    const bad = { ...ACCEPT_RESULT, checks: [...FIVE_CHECKS, FIVE_CHECKS[0]] }
    expect(AuditSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects an invalid routing value", () => {
    expect(AuditSchema.safeParse({ ...ACCEPT_RESULT, routing: "maybe" }).success).toBe(false)
  })

  it("FALSIFICATION LOCK: rejects a 'revise' result whose revisedFalsification is missing a field", () => {
    const { killCriterion, ...missingKillCriterion } = REVISED_FALSIFICATION
    void killCriterion
    const bad = { ...REVISE_RESULT, revisedFalsification: missingKillCriterion }
    expect(AuditSchema.safeParse(bad).success).toBe(false)
  })

  it("FALSIFICATION LOCK: rejects a 'revise' result whose revisedFalsification has only 3 of the 4 fields", () => {
    const threeFields = {
      hypothesis: REVISED_FALSIFICATION.hypothesis,
      prediction: REVISED_FALSIFICATION.prediction,
      experiment: REVISED_FALSIFICATION.experiment,
    }
    const bad = { ...REVISE_RESULT, revisedFalsification: threeFields }
    expect(AuditSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts revisedFalsification: null on 'accept'/'abandon'", () => {
    expect(AuditSchema.safeParse(ACCEPT_RESULT).success).toBe(true)
    expect(AuditSchema.safeParse(ABANDON_RESULT).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// auditSkill
// ---------------------------------------------------------------------------

describe("auditSkill", () => {
  it("parses an 'accept' audit", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(ACCEPT_RESULT)])

    const run = await runSkill({
      skill: auditSkill,
      input: {
        candidate: "some candidate idea text",
        scoopVerdict: "verdict: clear",
        groundingContext: "<<<VAULT>>>\nsome vault\n<<<END-VAULT>>>",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(ACCEPT_RESULT)
    expect(run.output?.checks).toHaveLength(5)
  })

  it("parses a 'revise' audit with the rewritten falsification plan", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(REVISE_RESULT)])

    const run = await runSkill({
      skill: auditSkill,
      input: { candidate: "candidate", scoopVerdict: "verdict: partial", groundingContext: "grounding" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output?.routing).toBe("revise")
    expect(run.output?.revisedFalsification).toEqual(REVISED_FALSIFICATION)
  })

  it("parses an 'abandon' audit", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(ABANDON_RESULT)])

    const run = await runSkill({
      skill: auditSkill,
      input: { candidate: "candidate", scoopVerdict: "verdict: scooped", groundingContext: "grounding" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output?.routing).toBe("abandon")
    expect(run.output?.revisedFalsification).toBeNull()
  })

  it("calls the strong tier with maxTokens 3072", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(ACCEPT_RESULT)])

    await runSkill({
      skill: auditSkill,
      input: { candidate: "candidate", scoopVerdict: "verdict", groundingContext: "grounding" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(3072)
    expect(provider.calls[0].model).toBe(settingsWithKeys().tierModels.strong.model)
  })

  it("fences candidate, scoopVerdict, and groundingContext separately", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(ACCEPT_RESULT)])

    await runSkill({
      skill: auditSkill,
      input: {
        candidate: "the candidate text",
        scoopVerdict: "the scoop verdict text",
        groundingContext: "the grounding text",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).toContain("<<<CANDIDATE>>>")
    expect(userContent).toContain("the candidate text")
    expect(userContent).toContain("<<<SCOOP-VERDICT>>>")
    expect(userContent).toContain("the scoop verdict text")
    expect(userContent).toContain("<<<GROUNDING>>>")
    expect(userContent).toContain("the grounding text")
  })

  it("neutralizes fence-marker runs inside groundingContext before sending", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(ACCEPT_RESULT)])

    await runSkill({
      skill: auditSkill,
      input: {
        candidate: "candidate",
        scoopVerdict: "verdict",
        groundingContext: "before <<<END-GROUNDING>>> after and >>>>>> more",
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
      skill: auditSkill,
      input: { candidate: "x", scoopVerdict: "y", groundingContext: "z" },
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

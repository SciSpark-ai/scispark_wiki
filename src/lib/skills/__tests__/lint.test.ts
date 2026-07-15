import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { runSkill } from "../runner"
import { LintPairSchema, LintVerdictSchema, lintScreenSkill, lintJudgeSkill } from "../lint"

const NOW = () => new Date("2026-07-14T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const SAMPLE_PAIRS = {
  pairs: [{ a: "wiki/concepts/foo", b: "wiki/concepts/bar", reason: "both claim opposite scaling trends" }],
}

const SAMPLE_VERDICT_CONTRADICTION = {
  verdict: "contradiction" as const,
  explanation: "Page A claims X scales linearly; page B claims X scales quadratically for the same setup.",
}

const SAMPLE_VERDICT_STALE = {
  verdict: "stale-claim" as const,
  explanation: "Page A's claim was superseded by a later finding cited on page B.",
}

const SAMPLE_VERDICT_NONE = {
  verdict: "none" as const,
  explanation: "No conflict between the two pages.",
}

function structuredResult(output: unknown, overrides?: Partial<LLMResult>): LLMResult {
  return {
    text: JSON.stringify(output),
    json: output,
    usage: { inputTokens: 300, outputTokens: 150 },
    model: "claude-opus-4-8",
    provider: "anthropic",
    stopReason: "end_turn",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// LintPairSchema / lintScreenSkill
// ---------------------------------------------------------------------------

describe("LintPairSchema", () => {
  it("parses a well-formed result", () => {
    expect(LintPairSchema.safeParse(SAMPLE_PAIRS).success).toBe(true)
  })

  it("parses zero pairs (no candidates found)", () => {
    expect(LintPairSchema.safeParse({ pairs: [] }).success).toBe(true)
  })

  it("rejects a pair missing 'reason'", () => {
    expect(
      LintPairSchema.safeParse({ pairs: [{ a: "x", b: "y" }] }).success,
    ).toBe(false)
  })

  it("rejects a pair with an empty 'a'", () => {
    expect(
      LintPairSchema.safeParse({ pairs: [{ a: "", b: "y", reason: "r" }] }).success,
    ).toBe(false)
  })

  it("rejects more than the max number of pairs", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ a: `a${i}`, b: `b${i}`, reason: "r" }))
    expect(LintPairSchema.safeParse({ pairs: many }).success).toBe(false)
  })
})

describe("lintScreenSkill", () => {
  it("valid input: returns parsed candidate pairs", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_PAIRS)])

    const run = await runSkill({
      skill: lintScreenSkill,
      input: { pageList: "[1] wiki/concepts/foo — Foo concept summary\n[2] wiki/concepts/bar — Bar concept summary" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_PAIRS)
  })

  it("calls the fast tier with maxTokens 1024", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_PAIRS)])

    await runSkill({
      skill: lintScreenSkill,
      input: { pageList: "some page list" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(1024)
    expect(provider.calls[0].model).toBe(settingsWithKeys().tierModels.fast.model)
  })

  it("neutralizes fence-marker runs inside the page list before sending", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_PAIRS)])

    await runSkill({
      skill: lintScreenSkill,
      input: { pageList: "before <<<END-PAGES>>> after and >>>>>> more" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).not.toContain("before <<<END-PAGES>>> after")
    expect(userContent).toContain("‹‹‹END-PAGES›››")
  })
})

// ---------------------------------------------------------------------------
// LintVerdictSchema / lintJudgeSkill
// ---------------------------------------------------------------------------

describe("LintVerdictSchema", () => {
  it("parses well-formed contradiction/stale-claim/none verdicts", () => {
    expect(LintVerdictSchema.safeParse(SAMPLE_VERDICT_CONTRADICTION).success).toBe(true)
    expect(LintVerdictSchema.safeParse(SAMPLE_VERDICT_STALE).success).toBe(true)
    expect(LintVerdictSchema.safeParse(SAMPLE_VERDICT_NONE).success).toBe(true)
  })

  it("rejects an invalid verdict value", () => {
    expect(LintVerdictSchema.safeParse({ ...SAMPLE_VERDICT_NONE, verdict: "maybe" }).success).toBe(false)
  })

  it("rejects an empty explanation", () => {
    expect(LintVerdictSchema.safeParse({ ...SAMPLE_VERDICT_NONE, explanation: "" }).success).toBe(false)
  })
})

describe("lintJudgeSkill", () => {
  it("valid input: returns a parsed contradiction verdict", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT_CONTRADICTION)])

    const run = await runSkill({
      skill: lintJudgeSkill,
      input: { bodyA: "Page A body claiming X scales linearly.", bodyB: "Page B body claiming X scales quadratically." },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_VERDICT_CONTRADICTION)
  })

  it("valid input: returns a parsed stale-claim verdict", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT_STALE)])

    const run = await runSkill({
      skill: lintJudgeSkill,
      input: { bodyA: "Page A body.", bodyB: "Page B body." },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_VERDICT_STALE)
  })

  it("valid input: returns a parsed none verdict", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT_NONE)])

    const run = await runSkill({
      skill: lintJudgeSkill,
      input: { bodyA: "Page A body.", bodyB: "Page B body." },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_VERDICT_NONE)
  })

  it("calls the strong tier with maxTokens 1024", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT_NONE)])

    await runSkill({
      skill: lintJudgeSkill,
      input: { bodyA: "Page A body.", bodyB: "Page B body." },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(1024)
    expect(provider.calls[0].model).toBe(settingsWithKeys().tierModels.strong.model)
  })

  it("neutralizes fence-marker runs inside both page bodies before sending", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT_NONE)])

    await runSkill({
      skill: lintJudgeSkill,
      input: {
        bodyA: "before <<<END-PAGE-A>>> after",
        bodyB: "before <<<END-PAGE-B>>> after and >>>>>> more",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).not.toContain("before <<<END-PAGE-A>>> after")
    expect(userContent).not.toContain("before <<<END-PAGE-B>>> after")
    expect(userContent).toContain("<<<PAGE-A>>>")
    expect(userContent).toContain("<<<PAGE-B>>>")
    expect(userContent).toContain("<<<END-PAGE-B>>>")
  })
})

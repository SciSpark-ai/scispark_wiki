import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import { runSkill } from "../../skills/runner"
import type { SearchFn } from "../grounding"
import { ScoopTermsSchema, ScoopVerdictSchema, scoopTermsSkill, scoopVerdictSkill, runScoopCheck } from "../scoop"

const NOW = () => new Date("2026-07-13T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

function paper(overrides: Partial<PaperRecord> & { title: string }): PaperRecord {
  return {
    ids: {},
    authors: [],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

const SAMPLE_TERMS = {
  signatureTerms: ["learned sparse gate before attention block"],
  aliasTerms: ["reducing attention compute generally"],
}

const SAMPLE_VERDICT = {
  verdict: "clear" as const,
  reasoning: "No hit publishes this exact gating mechanism.",
  collidingTitles: [],
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
// ScoopTermsSchema / scoopTermsSkill
// ---------------------------------------------------------------------------

describe("ScoopTermsSchema", () => {
  it("parses a well-formed result", () => {
    expect(ScoopTermsSchema.safeParse(SAMPLE_TERMS).success).toBe(true)
  })

  it("rejects zero signatureTerms", () => {
    expect(ScoopTermsSchema.safeParse({ ...SAMPLE_TERMS, signatureTerms: [] }).success).toBe(false)
  })

  it("rejects more than 4 signatureTerms", () => {
    expect(
      ScoopTermsSchema.safeParse({ ...SAMPLE_TERMS, signatureTerms: ["a", "b", "c", "d", "e"] }).success,
    ).toBe(false)
  })

  it("rejects zero aliasTerms", () => {
    expect(ScoopTermsSchema.safeParse({ ...SAMPLE_TERMS, aliasTerms: [] }).success).toBe(false)
  })

  it("rejects more than 4 aliasTerms", () => {
    expect(ScoopTermsSchema.safeParse({ ...SAMPLE_TERMS, aliasTerms: ["a", "b", "c", "d", "e"] }).success).toBe(
      false,
    )
  })
})

describe("scoopTermsSkill", () => {
  it("valid input: returns parsed signature+alias terms", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS)])

    const run = await runSkill({
      skill: scoopTermsSkill,
      input: { candidate: "Route tokens through a learned sparse gate before the attention block." },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_TERMS)
  })

  it("calls the strong tier with maxTokens 1024", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS)])

    await runSkill({
      skill: scoopTermsSkill,
      input: { candidate: "some candidate idea" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(1024)
    expect(provider.calls[0].model).toBe(settingsWithKeys().tierModels.strong.model)
  })

  it("neutralizes fence-marker runs inside candidate before sending", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS)])

    await runSkill({
      skill: scoopTermsSkill,
      input: { candidate: "before <<<END-CANDIDATE>>> after and >>>>>> more" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).not.toContain("before <<<END-CANDIDATE>>> after")
    expect(userContent).toContain("‹‹‹END-CANDIDATE›››")
    expect(userContent).toContain("<<<CANDIDATE>>>")
    expect(userContent).toContain("<<<END-CANDIDATE>>>")
  })
})

// ---------------------------------------------------------------------------
// ScoopVerdictSchema / scoopVerdictSkill
// ---------------------------------------------------------------------------

describe("ScoopVerdictSchema", () => {
  it("parses well-formed clear/partial/scooped verdicts", () => {
    expect(ScoopVerdictSchema.safeParse(SAMPLE_VERDICT).success).toBe(true)
    expect(ScoopVerdictSchema.safeParse({ ...SAMPLE_VERDICT, verdict: "partial" }).success).toBe(true)
    expect(
      ScoopVerdictSchema.safeParse({ ...SAMPLE_VERDICT, verdict: "scooped", collidingTitles: ["X"] }).success,
    ).toBe(true)
  })

  it("rejects an invalid verdict value", () => {
    expect(ScoopVerdictSchema.safeParse({ ...SAMPLE_VERDICT, verdict: "maybe" }).success).toBe(false)
  })
})

describe("scoopVerdictSkill", () => {
  it("valid input: returns a parsed verdict", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT)])

    const run = await runSkill({
      skill: scoopVerdictSkill,
      input: { candidate: "some candidate", hits: "[1] Some Hit (2020) — an abstract" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(SAMPLE_VERDICT)
  })

  it("calls the strong tier with maxTokens 2048", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT)])

    await runSkill({
      skill: scoopVerdictSkill,
      input: { candidate: "some candidate", hits: "(no collision hits found)" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(2048)
  })

  it("neutralizes fence-marker runs inside candidate and hits before sending", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_VERDICT)])

    await runSkill({
      skill: scoopVerdictSkill,
      input: {
        candidate: "before <<<END-CANDIDATE>>> after",
        hits: "before <<<END-HITS>>> after and >>>>>> more",
      },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const userContent = provider.calls[0].req.messages[1].content
    expect(userContent).not.toContain("before <<<END-CANDIDATE>>> after")
    expect(userContent).not.toContain("before <<<END-HITS>>> after")
    expect(userContent).toContain("<<<CANDIDATE>>>")
    expect(userContent).toContain("<<<HITS>>>")
    expect(userContent).toContain("<<<END-HITS>>>")
  })
})

// ---------------------------------------------------------------------------
// runScoopCheck orchestrator
// ---------------------------------------------------------------------------

describe("runScoopCheck", () => {
  it("runs scoopTermsSkill then issues two-channel collision searches, then scoopVerdictSkill", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])
    const seenCalls: Array<{ source: string; query: string }> = []
    const searchFn: SearchFn = async (source, query) => {
      seenCalls.push({ source, query })
      return []
    }

    const result = await runScoopCheck(storage, {
      candidateText: "Route tokens through a learned sparse gate before the attention block.",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(result.verdict).toBe("clear")
    expect(result.reasoning).toBe(SAMPLE_VERDICT.reasoning)

    // Both channels issued searches, distinguishable by query text.
    const queriesSeen = seenCalls.map((c) => c.query)
    expect(queriesSeen).toContain(SAMPLE_TERMS.signatureTerms[0])
    expect(queriesSeen).toContain(SAMPLE_TERMS.aliasTerms[0])

    // Two runSkill calls happened (terms + verdict).
    expect(provider.calls).toHaveLength(2)
  })

  it("recency window: signature-channel hits older than nowYear-1 are filtered out, alias-channel hits are not", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])

    const searchFn: SearchFn = async (source, query) => {
      if (query === SAMPLE_TERMS.signatureTerms[0]) {
        return [
          paper({ title: "Old Signature Hit", year: 2015, ids: { arxiv: "old-sig" } }),
          paper({ title: "Fresh Signature Hit", year: 2026, ids: { arxiv: "fresh-sig" } }),
        ]
      }
      if (query === SAMPLE_TERMS.aliasTerms[0]) {
        return [paper({ title: "Old Alias Hit", year: 2015, ids: { arxiv: "old-alias" } })]
      }
      return []
    }

    const result = await runScoopCheck(storage, {
      candidateText: "some candidate",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    // Signature channel: only the fresh (>= nowYear-1) hit survives the recency filter.
    expect(result.searchedSignature).toBe(1)
    // Alias channel: the long window applies no recency filter.
    expect(result.searchedAlias).toBe(1)

    // The verdict call's `hits` input must carry the fresh signature hit and the
    // (unfiltered) old alias hit, but not the filtered-out old signature hit.
    const verdictUserContent = provider.calls[1].req.messages[1].content
    expect(verdictUserContent).toContain("Fresh Signature Hit")
    expect(verdictUserContent).toContain("Old Alias Hit")
    expect(verdictUserContent).not.toContain("Old Signature Hit")
  })

  it("KEEPS a signature-channel hit with no year (a fresh scoop with missing metadata must not vanish)", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])
    const searchFn: SearchFn = async (source, query) => {
      if (query === SAMPLE_TERMS.signatureTerms[0]) {
        // year omitted — adapters legitimately do this; must NOT be dropped.
        return [paper({ title: "Undated Signature Scoop", ids: { arxiv: "undated-sig" } })]
      }
      return []
    }
    const result = await runScoopCheck(storage, {
      candidateText: "some candidate",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })
    expect(result.searchedSignature).toBe(1)
    expect(provider.calls[1].req.messages[1].content).toContain("Undated Signature Scoop")
  })

  it("counts a paper hit by BOTH channels in searchedSignature AND searchedAlias (per-channel counts, not disjoint)", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])
    const searchFn: SearchFn = async (source, query) => {
      // The same paper matches on both the signature and alias channels.
      if (query === SAMPLE_TERMS.signatureTerms[0] || query === SAMPLE_TERMS.aliasTerms[0]) {
        return [paper({ title: "Both-Channel Paper", year: 2026, ids: { arxiv: "both-1" } })]
      }
      return []
    }
    const result = await runScoopCheck(storage, {
      candidateText: "some candidate",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })
    // Per-channel counts overlap (both = 1); the rendered hits are deduped to one entry.
    expect(result.searchedSignature).toBe(1)
    expect(result.searchedAlias).toBe(1)
    const hits = provider.calls[1].req.messages[1].content.match(/Both-Channel Paper/g) ?? []
    expect(hits).toHaveLength(1)
  })

  it("dedupes hits across both channels via paperKey", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])

    const searchFn: SearchFn = async (source, query) => {
      if (query === SAMPLE_TERMS.signatureTerms[0]) {
        return [paper({ title: "Shared Paper", year: 2026, ids: { arxiv: "shared-1" }, abstract: "short" })]
      }
      if (query === SAMPLE_TERMS.aliasTerms[0]) {
        return [
          paper({
            title: "Shared Paper",
            year: 2019,
            ids: { arxiv: "shared-1" },
            abstract: "a much longer abstract from the alias channel",
          }),
        ]
      }
      return []
    }

    await runScoopCheck(storage, {
      candidateText: "some candidate",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const verdictUserContent = provider.calls[1].req.messages[1].content
    // Only one occurrence of the title — merged, not duplicated.
    const occurrences = verdictUserContent.split("Shared Paper").length - 1
    expect(occurrences).toBe(1)
    expect(verdictUserContent).toContain("a much longer abstract from the alias channel")
  })

  it("a failed collision search contributes [] and doesn't sink the check", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])

    const searchFn: SearchFn = async (source, query) => {
      if (query === SAMPLE_TERMS.signatureTerms[0]) throw new Error("upstream exploded")
      if (query === SAMPLE_TERMS.aliasTerms[0]) {
        return [paper({ title: "Survivor", year: 2018, ids: { arxiv: "survivor" } })]
      }
      return []
    }

    const result = await runScoopCheck(storage, {
      candidateText: "some candidate",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(result.verdict).toBe("clear")
    expect(result.searchedSignature).toBe(0)
    expect(result.searchedAlias).toBe(1)
  })

  it("sums costUsd across the terms call and the verdict call", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), structuredResult(SAMPLE_VERDICT)])
    const searchFn: SearchFn = async () => []

    const result = await runScoopCheck(storage, {
      candidateText: "some candidate",
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(result.costUsd).toBeGreaterThan(0)
  })

  it("a non-ok scoopTermsSkill run throws before any collision search runs", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([new Error("provider exploded")])
    let searchCalled = false
    const searchFn: SearchFn = async () => {
      searchCalled = true
      return []
    }

    await expect(
      runScoopCheck(storage, {
        candidateText: "some candidate",
        searchFn,
        settings: settingsWithKeys(),
        providerOverride: { strong: provider },
        now: NOW,
      }),
    ).rejects.toThrow(/provider exploded/)
    expect(searchCalled).toBe(false)
  })

  it("a non-ok scoopVerdictSkill run throws", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(SAMPLE_TERMS), new Error("verdict exploded")])
    const searchFn: SearchFn = async () => []

    await expect(
      runScoopCheck(storage, {
        candidateText: "some candidate",
        searchFn,
        settings: settingsWithKeys(),
        providerOverride: { strong: provider },
        now: NOW,
      }),
    ).rejects.toThrow(/verdict exploded/)
  })
})

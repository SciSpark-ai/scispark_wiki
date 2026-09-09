import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadBundle } from "../../vault/bundle"
import { loadChangeset, revertChangeset } from "../../vault/changesets"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import type { Frontmatter } from "../../vault/types"
import { composePage } from "../../wiki/authoring"
import { readRecentEvents } from "../../events/log"
import type { SearchFn } from "../grounding"
import { runDeepSpark, estimateDeepSparkCost } from "../deep"

const NOW = () => new Date("2026-07-13T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const NO_SEARCH: SearchFn = async () => []

async function writePage(
  storage: MemoryVaultStorage,
  path: string,
  frontmatter: Partial<Frontmatter> & { type: string; title: string },
  body: string,
): Promise<void> {
  const fm: Frontmatter = {
    created: "2026-07-13",
    updated: "2026-07-13",
    tags: [],
    related: [],
    sources: [],
    ...frontmatter,
  }
  await storage.write(path, composePage({ path, frontmatter: fm, body }))
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
// Scripted per-phase LLM outputs, in the order the phase graph calls them:
// bottleneck -> ideation -> scoop-terms -> scoop-verdict -> audit
// ---------------------------------------------------------------------------

const PROCEED_BOTTLENECK = {
  routing: "proceed" as const,
  bottleneck: "No existing method models cross-document coreference cheaply at long context.",
  whyItMatters: "Resolving this unlocks scalable multi-doc coreference.",
  refusalReason: "",
}

const DO_NOT_GENERATE_BOTTLENECK = {
  routing: "do_not_generate" as const,
  bottleneck: "",
  whyItMatters: "",
  refusalReason: "The direction is too vague to diagnose a genuine bottleneck.",
}

const CANDIDATE = {
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

/** A second, differently-titled candidate — used only by the in-flight-guard tests below
 * so that a second (non-shared, sequential) run doesn't collide on the same idea page path
 * as the first run's CANDIDATE. */
const CANDIDATE_2 = {
  ...CANDIDATE,
  title: "Adaptive sparse cross-document coreference routing",
}

const SCOOP_TERMS = {
  signatureTerms: ["learned sparse gate before coreference scoring head"],
  aliasTerms: ["reducing cross-document coreference compute generally"],
}

const CLEAR_VERDICT = {
  verdict: "clear" as const,
  reasoning: "No hit publishes this exact gating mechanism.",
  collidingTitles: [],
}

const FIVE_CHECKS_PASS = [
  { name: "Falsification structure", passed: true, note: "Kill criterion is a specific F1 threshold." },
  { name: "Novelty vs scoop", passed: true, note: "No hit collides with the specific mechanism." },
  { name: "Mechanism specificity", passed: true, note: "The routing mechanism is concretely described." },
  { name: "Grounding fidelity", passed: true, note: "Every claim traces to a grounding snippet." },
  { name: "Feasibility", passed: true, note: "The experiment is runnable with an existing benchmark." },
]

const ACCEPT_AUDIT = {
  checks: FIVE_CHECKS_PASS,
  routing: "accept" as const,
  revisedFalsification: null,
}

const REVISED_FALSIFICATION = {
  hypothesis: "Revised hypothesis with a tighter claim.",
  prediction: "Revised prediction naming the exact metric.",
  killCriterion: "REVISED-KILL-CRITERION: F1 drops below 90 on the held-out set.",
  experiment: "Revised experiment protocol across 3 seeds.",
}

const REVISE_AUDIT = {
  checks: [
    { ...FIVE_CHECKS_PASS[0], passed: false, note: "Kill criterion was vague — rewritten to a specific threshold." },
    ...FIVE_CHECKS_PASS.slice(1),
  ],
  routing: "revise" as const,
  revisedFalsification: REVISED_FALSIFICATION,
}

const ABANDON_AUDIT = {
  checks: [
    FIVE_CHECKS_PASS[0],
    { name: "Novelty vs scoop", passed: false, note: "A 2025 paper already publishes this exact mechanism." },
    ...FIVE_CHECKS_PASS.slice(2),
  ],
  routing: "abandon" as const,
  revisedFalsification: null,
}

/** One full ideation->scoop->audit leg's worth of scripted responses (4 calls), with the
 * audit response and candidate swappable per test (candidate defaults to CANDIDATE). */
function legResponses(auditOutput: unknown, candidate: unknown = CANDIDATE): LLMResult[] {
  return [
    structuredResult(candidate),
    structuredResult(SCOOP_TERMS),
    structuredResult(CLEAR_VERDICT),
    structuredResult(auditOutput),
  ]
}

describe("estimateDeepSparkCost", () => {
  it("estimates the selected known model and leaves unknown prices null", async () => {
    expect(await estimateDeepSparkCost("gpt-5.4-mini")).toBeLessThan((await estimateDeepSparkCost())!)
    expect(await estimateDeepSparkCost("google/gemini-3.8-flash")).toBeNull()
  })
  it("returns a positive rough estimate", async () => {
    const estimate = await estimateDeepSparkCost()
    expect(estimate).toBeGreaterThan(0)
  })
})

describe("runDeepSpark", () => {
  it("happy path: writes a parseable idea page, logs spark_run, phaseCosts sum to costUsd", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(ACCEPT_AUDIT)])
    const phases: string[] = []

    const result = await runDeepSpark({
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
      onPhase: (p) => phases.push(p),
    })

    expect(result.outcome.kind).toBe("idea")
    if (result.outcome.kind !== "idea") throw new Error("expected idea outcome")
    expect(result.outcome.status).toBe("sparked")
    expect(result.outcome.ideaPageId).toBe("wiki/ideas/idea-sparse-cross-document-coreference-routing")

    const bundle = await loadBundle(storage)
    expect(bundle.errors).toEqual([])
    const page = bundle.pages.get(result.outcome.ideaPageId)
    expect(page).toBeDefined()
    expect(page!.frontmatter.type).toBe("idea")
    expect(page!.frontmatter.status).toBe("sparked")
    expect(page!.frontmatter.depth).toBe("deep")
    expect(page!.body).toContain(CANDIDATE.falsification.killCriterion)

    const changeset = await loadChangeset(storage, result.outcome.changesetId)
    expect(changeset).not.toBeNull()
    expect(changeset!.changes[0].before).toBeNull()

    const eventsRaw = await storage.read(".scispark/events/2026-07.jsonl")
    expect(eventsRaw).not.toBeNull()
    const lines = (eventsRaw as string).trim().split("\n").map((l) => JSON.parse(l))
    const sparkEvents = lines.filter((e) => e.type === "spark_run")
    expect(sparkEvents).toHaveLength(1)
    expect(sparkEvents[0].mode).toBe("deep")
    expect(sparkEvents[0].outcome).toBe("idea")
    expect(sparkEvents[0].ideaPageId).toBe(result.outcome.ideaPageId)
    expect(sparkEvents[0].costUsd).toBeGreaterThan(0)

    expect(Object.keys(result.phaseCosts).length).toBeGreaterThan(0)
    expect(Object.values(result.phaseCosts)).not.toContain(null)
    const sum = Object.values(result.phaseCosts).reduce<number>((a, b) => a + b!, 0)
    expect(sum).toBeCloseTo(result.costUsd!, 10)
    expect(result.costUsd).toBeGreaterThan(0)

    expect(phases).toEqual(["grounding", "bottleneck", "ideation", "scoop-check", "audit"])
  })

  it("do_not_generate from bottleneck: no page written, no changeset, correct outcome", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(DO_NOT_GENERATE_BOTTLENECK)])

    const result = await runDeepSpark({
      storage,
      direction: "a hopelessly vague direction",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    })

    expect(result.outcome).toEqual({ kind: "do_not_generate", reason: DO_NOT_GENERATE_BOTTLENECK.refusalReason })

    const ideaFiles = await storage.list("wiki/ideas/")
    expect(ideaFiles).toEqual([])

    const eventsRaw = await storage.read(".scispark/events/2026-07.jsonl")
    const lines = (eventsRaw as string).trim().split("\n").map((l) => JSON.parse(l))
    const sparkEvents = lines.filter((e) => e.type === "spark_run")
    expect(sparkEvents).toHaveLength(1)
    expect(sparkEvents[0].outcome).toBe("do_not_generate")
    expect(sparkEvents[0].ideaPageId).toBeUndefined()
  })

  it("audit abandons twice: abandoned outcome after one internal retry, no page written", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([
      structuredResult(PROCEED_BOTTLENECK),
      ...legResponses(ABANDON_AUDIT),
      ...legResponses(ABANDON_AUDIT),
    ])
    const phases: string[] = []

    const result = await runDeepSpark({
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
      onPhase: (p) => phases.push(p),
    })

    expect(result.outcome.kind).toBe("abandoned")
    if (result.outcome.kind !== "abandoned") throw new Error("expected abandoned outcome")
    expect(result.outcome.reason).toContain("already publishes this exact mechanism")

    const ideaFiles = await storage.list("wiki/ideas/")
    expect(ideaFiles).toEqual([])

    // ideation/scoop-check/audit run twice (the retry), grounding/bottleneck once.
    expect(phases).toEqual([
      "grounding",
      "bottleneck",
      "ideation",
      "scoop-check",
      "audit",
      "ideation",
      "scoop-check",
      "audit",
    ])
    expect(provider.calls).toHaveLength(9) // bottleneck + 2 * (ideation + scoop-terms + scoop-verdict + audit)

    const eventsRaw = await storage.read(".scispark/events/2026-07.jsonl")
    const lines = (eventsRaw as string).trim().split("\n").map((l) => JSON.parse(l))
    const sparkEvents = lines.filter((e) => e.type === "spark_run")
    expect(sparkEvents).toHaveLength(1)
    expect(sparkEvents[0].outcome).toBe("abandoned")
  })

  it("audit abandons once then accepts on retry: writes the page from the RETRY's candidate", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([
      structuredResult(PROCEED_BOTTLENECK),
      ...legResponses(ABANDON_AUDIT),
      ...legResponses(ACCEPT_AUDIT),
    ])

    const result = await runDeepSpark({
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    })

    expect(result.outcome.kind).toBe("idea")
    const ideaFiles = await storage.list("wiki/ideas/")
    expect(ideaFiles).toHaveLength(1)
  })

  it("audit revises: the idea body carries the REWRITTEN falsification, not the candidate's original", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(REVISE_AUDIT)])

    const result = await runDeepSpark({
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    })

    expect(result.outcome.kind).toBe("idea")
    if (result.outcome.kind !== "idea") throw new Error("expected idea outcome")

    const bundle = await loadBundle(storage)
    const page = bundle.pages.get(result.outcome.ideaPageId)
    expect(page!.body).toContain(REVISED_FALSIFICATION.killCriterion)
    expect(page!.body).not.toContain(CANDIDATE.falsification.killCriterion)
  })

  it("audit revises with a null revisedFalsification (schema-permitted edge case): still produces an idea page, does not crash, and the body carries the CANDIDATE's original falsification fields", async () => {
    // AuditSchema allows routing:"revise" with revisedFalsification:null even though the
    // FALSIFICATION LOCK prompt contract says "revise" should always carry a rewritten
    // plan — a real audit call could return this shape anyway. assemble.ts's
    // resolveFalsification falls back to the candidate's original plan in that case; this
    // exercises that fallback through the full orchestrator, not just the pure function.
    const storage = new MemoryVaultStorage()
    const reviseWithNullFalsification = { ...REVISE_AUDIT, revisedFalsification: null }
    const provider = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(reviseWithNullFalsification)])

    const result = await runDeepSpark({
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    })

    expect(result.outcome.kind).toBe("idea")
    if (result.outcome.kind !== "idea") throw new Error("expected idea outcome")

    const bundle = await loadBundle(storage)
    expect(bundle.errors).toEqual([])
    const page = bundle.pages.get(result.outcome.ideaPageId)
    expect(page).toBeDefined()
    // The fallback fired: the CANDIDATE's original falsification fields are in the body...
    expect(page!.body).toContain(CANDIDATE.falsification.hypothesis)
    expect(page!.body).toContain(CANDIDATE.falsification.prediction)
    expect(page!.body).toContain(CANDIDATE.falsification.killCriterion)
    expect(page!.body).toContain(CANDIDATE.falsification.experiment)
    // ...and the (never-supplied) revised fields are absent.
    expect(page!.body).not.toContain(REVISED_FALSIFICATION.killCriterion)
  })

  it("seedPageId given: overwrites the seed's path; before-state captured so revert restores the seed", async () => {
    const storage = new MemoryVaultStorage()
    await writePage(
      storage,
      "wiki/ideas/idea-my-seed.md",
      { type: "idea", title: "My Seed", status: "sparked", depth: "quick" },
      "# My Seed\n\nA quick seed hook.\n",
    )
    const provider = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(ACCEPT_AUDIT)])

    const result = await runDeepSpark({
      storage,
      direction: "efficient cross-document coreference",
      seedPageId: "wiki/ideas/idea-my-seed",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    })

    expect(result.outcome.kind).toBe("idea")
    if (result.outcome.kind !== "idea") throw new Error("expected idea outcome")
    // Overwrote the SEED's path, not a fresh path derived from the candidate's title.
    expect(result.outcome.ideaPageId).toBe("wiki/ideas/idea-my-seed")

    const bundle = await loadBundle(storage)
    const page = bundle.pages.get("wiki/ideas/idea-my-seed")
    expect(page!.frontmatter.depth).toBe("deep")
    expect(page!.body).toContain(CANDIDATE.falsification.killCriterion)

    // No separate fresh-path idea file was also written.
    const ideaFiles = await storage.list("wiki/ideas/")
    expect(ideaFiles).toEqual(["wiki/ideas/idea-my-seed.md"])

    const changeset = await loadChangeset(storage, result.outcome.changesetId)
    expect(changeset).not.toBeNull()
    expect(changeset!.changes[0].path).toBe("wiki/ideas/idea-my-seed.md")
    expect(changeset!.changes[0].before).toContain("A quick seed hook.")

    await revertChangeset(storage, changeset!)
    const restored = await storage.read("wiki/ideas/idea-my-seed.md")
    expect(restored).toContain("A quick seed hook.")
    expect(restored).not.toContain(CANDIDATE.falsification.killCriterion)
  })

  it("a non-ok run throws an Error carrying the run's error message, before any write", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([new Error("provider exploded")])

    await expect(
      runDeepSpark({
        storage,
        direction: "efficient cross-document coreference",
        searchFn: NO_SEARCH,
        settings: settingsWithKeys(),
        providerOverride: { strong: provider },
        today: "2026-07-13",
        now: NOW,
      }),
    ).rejects.toThrow(/provider exploded/)

    const ideaFiles = await storage.list("wiki/ideas/")
    expect(ideaFiles).toEqual([])
    const eventsRaw = await storage.read(".scispark/events/2026-07.jsonl")
    expect(eventsRaw).toBeNull()
  })

  // -------------------------------------------------------------------------
  // In-flight guard (spend-safety): mirrors trending/__tests__/dashboard.test.ts's
  // concurrent-sharing tests. Deep Spark is a real $1-3 LLM spend, so two browser
  // tabs concurrently POSTing /api/skills/spark/deep for the same vault must never
  // fire two paid runs — see runDeepSpark's JSDoc in src/lib/spark/deep.ts.
  // -------------------------------------------------------------------------

  it("concurrent calls for the same storage share one in-flight run (no double-spend)", async () => {
    const storage = new MemoryVaultStorage()
    // One full leg's worth of responses (bottleneck + ideation + scoop-terms +
    // scoop-verdict + audit = 5). If the guard failed and each caller ran its own
    // pass, the provider would need 10 and this would throw "no responses left".
    const provider = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(ACCEPT_AUDIT)])
    const opts = {
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    }
    // The second caller asks about a different direction — proving the guard's
    // "second caller's opts ignored" subtlety: it still gets the FIRST caller's
    // result (a shared idea page), not one derived from its own direction.
    const [a, b] = await Promise.all([
      runDeepSpark(opts),
      runDeepSpark({ ...opts, direction: "a different direction tab B asked about" }),
    ])
    expect(provider.calls).toHaveLength(5) // bottleneck + ideation + scoop-terms + scoop-verdict + audit, once
    expect(a).toBe(b) // same result object shared by both callers
    expect(a.outcome.kind).toBe("idea")

    const events = await readRecentEvents(storage)
    expect(events.filter((e) => e.type === "spark_run")).toHaveLength(1)
  })

  it("a call AFTER the shared run settles starts a fresh run", async () => {
    const storage = new MemoryVaultStorage()
    // Second leg scripts CANDIDATE_2 (a different title -> a different idea page path) so the
    // second run's changeset doesn't conflict with the page the first run already wrote.
    const provider = new MockProvider([
      structuredResult(PROCEED_BOTTLENECK),
      ...legResponses(ACCEPT_AUDIT),
      structuredResult(PROCEED_BOTTLENECK),
      ...legResponses(ACCEPT_AUDIT, CANDIDATE_2),
    ])
    const opts = {
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    }
    const first = await runDeepSpark(opts)
    expect(provider.calls).toHaveLength(5)
    const second = await runDeepSpark(opts)
    expect(provider.calls).toHaveLength(10) // second, sequential call ran fresh, not reused
    expect(second).not.toBe(first)

    const ideaFiles = await storage.list("wiki/ideas/")
    expect(ideaFiles).toHaveLength(2) // both runs actually wrote (fresh run, not a no-op)

    const events = await readRecentEvents(storage)
    expect(events.filter((e) => e.type === "spark_run")).toHaveLength(2)
  })

  it("different storage instances do not share an in-flight run", async () => {
    const storageA = new MemoryVaultStorage()
    const storageB = new MemoryVaultStorage()
    // Separate providers per storage: this test only asserts the guard doesn't cross storages,
    // not the phase-call ordering of a single shared provider queue under real interleaving.
    const providerA = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(ACCEPT_AUDIT)])
    const providerB = new MockProvider([structuredResult(PROCEED_BOTTLENECK), ...legResponses(ACCEPT_AUDIT, CANDIDATE_2)])
    const optsFor = (storage: MemoryVaultStorage, provider: MockProvider) => ({
      storage,
      direction: "efficient cross-document coreference",
      searchFn: NO_SEARCH,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      today: "2026-07-13",
      now: NOW,
    })
    await Promise.all([runDeepSpark(optsFor(storageA, providerA)), runDeepSpark(optsFor(storageB, providerB))])
    // Each storage's own provider ran a full pass (5 calls) — a shared in-flight run would
    // have starved one of these providers of calls (and the other would throw on the 6th).
    expect(providerA.calls).toHaveLength(5)
    expect(providerB.calls).toHaveLength(5)
  })
})

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import { loadBundle } from "../../vault/bundle"
import type { SearchFn } from "../../spark/grounding"
import type { Seed } from "../../spark/quick"
import type { DeepSparkResult } from "../../spark/deep"
import * as quickRoute from "../../../app/api/skills/spark/quick/route"
import * as seedRoute from "../../../app/api/skills/spark/seed/route"
import * as deepRoute from "../../../app/api/skills/spark/deep/route"
import * as estimateRoute from "../../../app/api/skills/spark/estimate/route"

// ---------------------------------------------------------------------------
// Scripted fixtures mirroring src/lib/spark/__tests__/{quick,deep}.test.ts
// (route tests inline their own copies rather than importing across test
// files, per src/lib/server/__tests__/ingest-api.test.ts's own convention).
// ---------------------------------------------------------------------------

const NO_SEARCH: SearchFn = async () => []

function structured(json: unknown): LLMResult {
  return { text: JSON.stringify(json), json, usage: { inputTokens: 200, outputTokens: 100 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}

const SAMPLE_SEEDS = {
  seeds: [
    {
      title: "Sparse routing for long-context attention",
      hook: "Route tokens through a learned sparse gate before the attention block to cut FLOPs.",
      rationale: "The vault's sparse-attention page shows a 40% FLOP reduction already; routing could compound it.",
      groundingPageIds: ["wiki/concepts/sparse-attention"],
    },
    {
      title: "Conditional long-context caching",
      hook: "Cache attention outputs keyed on content similarity across long documents.",
      rationale: "Builds directly on the vault's long-context-attention paper's evaluation setup.",
      groundingPageIds: [],
    },
  ],
}

const PROCEED_BOTTLENECK = {
  routing: "proceed" as const,
  bottleneck: "No existing method models cross-document coreference cheaply at long context.",
  whyItMatters: "Resolving this unlocks scalable multi-doc coreference.",
  refusalReason: "",
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

function deepLegResponses(): unknown[] {
  return [PROCEED_BOTTLENECK, CANDIDATE, SCOOP_TERMS, CLEAR_VERDICT, ACCEPT_AUDIT]
}

async function jsonResult<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { result: T }
  return body.result
}

describe("spark quick/seed/deep/estimate skill routes", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    await createVault(storage, { purpose: "Track my ML research reading.", today: "2026-07-14" })
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  describe("POST /api/skills/spark/quick", () => {
    it("returns seeds + costUsd from the strong-tier provider", async () => {
      const provider = new MockProvider([structured(SAMPLE_SEEDS)])
      setSkillTestOverrides({ providerOverride: { strong: provider } })

      const res = await quickRoute.POST(
        new Request("http://x/api/skills/spark/quick", {
          method: "POST",
          body: JSON.stringify({ direction: "efficient long-context attention" }),
        }),
      )
      expect(res.status).toBe(200)
      const result = await jsonResult<{ seeds: Seed[]; costUsd: number; runId?: string }>(res)
      expect(result.seeds).toEqual(SAMPLE_SEEDS.seeds)
      expect(result.costUsd).toBeGreaterThan(0)
      expect(provider.calls).toHaveLength(1)
    })

    it("a skill run failure (no key, no override) returns a 500 error", async () => {
      setSkillTestOverrides({})

      const res = await quickRoute.POST(
        new Request("http://x/api/skills/spark/quick", {
          method: "POST",
          body: JSON.stringify({ direction: "efficient long-context attention" }),
        }),
      )
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/missing api key/i)
    })
  })

  describe("POST /api/skills/spark/seed", () => {
    it("saves a stub idea page via an atomic changeset and returns {changesetId, path}", async () => {
      const seed: Seed = SAMPLE_SEEDS.seeds[0]

      const res = await seedRoute.POST(
        new Request("http://x/api/skills/spark/seed", { method: "POST", body: JSON.stringify({ seed }) }),
      )
      expect(res.status).toBe(200)
      const result = await jsonResult<{ changesetId: string; path: string }>(res)
      expect(result.path).toBe("wiki/ideas/idea-sparse-routing-for-long-context-attention.md")
      expect(result.changesetId).toBeTruthy()

      const bundle = await loadBundle(storage)
      const page = bundle.pages.get(result.path.slice(0, -3))
      expect(page).toBeDefined()
      expect(page!.frontmatter.type).toBe("idea")
      expect(page!.frontmatter.status).toBe("sparked")
      expect(page!.frontmatter.depth).toBe("quick")
      expect(page!.body).toContain(seed.hook)
    })
  })

  describe("POST /api/skills/spark/deep", () => {
    it("streams grounding->bottleneck->ideation->scoop-check->audit and the result parses as DeepSparkResult with an idea page written", async () => {
      const provider = new MockProvider(deepLegResponses().map((o) => structured(o)))
      setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: NO_SEARCH })

      const res = await deepRoute.POST(
        new Request("http://x/api/skills/spark/deep", {
          method: "POST",
          body: JSON.stringify({ direction: "efficient cross-document coreference" }),
        }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("application/x-ndjson")

      const progressEvents: unknown[] = []
      const result = (await readNdjson(res, (e) => progressEvents.push(e))) as DeepSparkResult

      expect(progressEvents).toEqual([
        { type: "progress", phase: "grounding" },
        { type: "progress", phase: "bottleneck" },
        { type: "progress", phase: "ideation" },
        { type: "progress", phase: "scoop-check" },
        { type: "progress", phase: "audit" },
      ])

      expect(result.outcome.kind).toBe("idea")
      if (result.outcome.kind !== "idea") throw new Error("expected idea outcome")
      expect(result.costUsd).toBeGreaterThan(0)

      const bundle = await loadBundle(storage)
      const page = bundle.pages.get(result.outcome.ideaPageId)
      expect(page).toBeDefined()
      expect(page!.frontmatter.type).toBe("idea")
      expect(page!.frontmatter.depth).toBe("deep")
      expect(page!.body).toContain(CANDIDATE.falsification.killCriterion)
    })

    it("a skill run failure terminates the stream with a terminal error, not a result", async () => {
      setSkillTestOverrides({ searchFn: NO_SEARCH })

      const res = await deepRoute.POST(
        new Request("http://x/api/skills/spark/deep", {
          method: "POST",
          body: JSON.stringify({ direction: "efficient cross-document coreference" }),
        }),
      )
      await expect(readNdjson(res, () => undefined)).rejects.toThrow(/missing api key/i)
    })
  })

  describe("POST /api/skills/spark/estimate", () => {
    it("returns the static estimateDeepSparkCost() number, no provider needed", async () => {
      const res = await estimateRoute.POST(
        new Request("http://x/api/skills/spark/estimate", { method: "POST", body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(200)
      const result = await jsonResult<{ costUsd: number }>(res)
      expect(result.costUsd).toBeGreaterThan(0)
    })
  })
})

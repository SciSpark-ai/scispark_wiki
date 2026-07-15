import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { AnalysisResult } from "../../skills/ingest-analysis"
import type { GenerationResult } from "../../skills/ingest"
import { parseDocument } from "../../vault/frontmatter"
import * as digestRoute from "../../../app/api/skills/digest/route"
import * as ingestRoute from "../../../app/api/skills/ingest/route"
import * as ingestUndoRoute from "../../../app/api/skills/ingest/undo/route"

const PAPER: PaperRecord = {
  ids: {},
  title: "Sparse Attention for Efficient Transformers",
  abstract: "We propose a sparse attention mechanism that reduces training time.",
  authors: [{ name: "Ada Lovelace" }],
  year: 2024,
  venue: "NeurIPS",
  fields: ["Machine Learning"],
  source: "arxiv",
}

// Same paper but with an htmlUrl candidate so acquireFullText goes through the
// fetchFn (and its "html" branch triggers the "snapshotting" progress phase).
const PAPER_WITH_HTML: PaperRecord = { ...PAPER, htmlUrl: "https://arxiv.org/abs/9999.99999" }

const SAMPLE_DIGEST = {
  summary: "This paper introduces a sparse attention variant with improved efficiency.",
  laySummary: "The authors made AI models faster without losing accuracy.",
  keyPoints: ["Proposes a sparse attention mechanism", "Reduces training time by 30%"],
  methods: "Trained models on standard benchmarks and compared wall-clock training time.",
  limitations: "Evaluated only on English-language text.",
  fieldContext: "Sits within the broader line of work on efficient transformer architectures.",
}

const SAMPLE_ANALYSIS: AnalysisResult = {
  entities: [{ name: "Ada Lovelace", kind: "author", inWiki: false }],
  concepts: [
    { name: "sparse attention", definition: "an attention mechanism that skips low-weight pairs", inWiki: false },
  ],
  findings: [
    { claim: "Sparse attention reduces training time by 30%", evidence: "benchmarked against a dense baseline", strength: "strong" },
  ],
  connections: [],
  contradictions: [],
  recommendations: {
    pagesToCreate: [{ type: "concept", title: "Sparse Attention", rationale: "central technique of this paper" }],
    pagesToUpdate: [],
    emphasis: ["efficiency gains"],
  },
}

const CONCEPT_PATH = "wiki/concepts/sparse-attention.md"

function sampleGeneration(): GenerationResult {
  return {
    files: [
      {
        path: CONCEPT_PATH,
        type: "concept",
        title: "Sparse Attention",
        tags: ["efficiency"],
        related: [],
        body: "# Sparse Attention\n\nAn attention mechanism that skips low-weight pairs.\n",
      },
    ],
    reviews: [],
  }
}

function structured(json: unknown): LLMResult {
  return { text: JSON.stringify(json), json, usage: { inputTokens: 200, outputTokens: 100 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}

/** Fake fetch that answers /api/fetch relay calls with html long enough to pass the >=500 char extraction floor. */
const htmlFetchFn: typeof fetch = async (input) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
  if (raw.includes("/api/fetch")) {
    const html = `<html><body><p>${"Full text content of the paper. ".repeat(40)}</p></body></html>`
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } })
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404 })
}

async function jsonResult<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { result: T }
  return body.result
}

describe("digest + ingest + undo skill routes", () => {
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

  describe("POST /api/skills/digest", () => {
    it("returns a digest on a miss and fromCache:true on a second call with no further LLM calls", async () => {
      const provider = new MockProvider([structured(SAMPLE_DIGEST)])
      setSkillTestOverrides({ providerOverride: { strong: provider } })

      const res1 = await digestRoute.POST(
        new Request("http://x/api/skills/digest", { method: "POST", body: JSON.stringify({ paper: PAPER }) }),
      )
      expect(res1.status).toBe(200)
      const result1 = await jsonResult<{ digest: typeof SAMPLE_DIGEST; fromCache: boolean; costUsd?: number }>(res1)
      expect(result1.digest).toEqual(SAMPLE_DIGEST)
      expect(result1.fromCache).toBe(false)
      expect(result1.costUsd).toBeGreaterThan(0)
      expect(provider.calls).toHaveLength(1)

      const res2 = await digestRoute.POST(
        new Request("http://x/api/skills/digest", { method: "POST", body: JSON.stringify({ paper: PAPER }) }),
      )
      const result2 = await jsonResult<{ digest: typeof SAMPLE_DIGEST; fromCache: boolean }>(res2)
      expect(result2.digest).toEqual(SAMPLE_DIGEST)
      expect(result2.fromCache).toBe(true)
      expect(provider.calls).toHaveLength(1) // no second LLM call
    })
  })

  describe("POST /api/skills/ingest", () => {
    it("streams acquiring -> snapshotting -> digesting -> ingesting, applies a changeset, and undo reverts it", async () => {
      const provider = new MockProvider([structured(SAMPLE_DIGEST), structured(SAMPLE_ANALYSIS), structured(sampleGeneration())])
      setSkillTestOverrides({ providerOverride: { strong: provider }, fetchFn: htmlFetchFn })

      const res = await ingestRoute.POST(
        new Request("http://x/api/skills/ingest", { method: "POST", body: JSON.stringify({ paper: PAPER_WITH_HTML }) }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("application/x-ndjson")

      const progressEvents: unknown[] = []
      const result = (await readNdjson(res, (e) => progressEvents.push(e))) as {
        output: { status: string; changesetId?: string; pages?: { created: string[]; updated: string[] } }
        costUsd: number
      }

      expect(progressEvents).toEqual([
        { type: "progress", phase: "acquiring" },
        { type: "progress", phase: "snapshotting" },
        { type: "progress", phase: "digesting" },
        { type: "progress", phase: "ingesting" },
      ])

      expect(result.output.status).toBe("ok")
      expect(result.costUsd).toBeGreaterThan(0)
      if (result.output.status !== "ok" || !result.output.changesetId) throw new Error("expected ok output")
      const changesetId = result.output.changesetId

      // Changeset applied to the SAME test vault setServerVaultForTests injected.
      const conceptRaw = await storage.read(CONCEPT_PATH)
      expect(conceptRaw).not.toBeNull()
      const concept = parseDocument(conceptRaw as string)
      expect(concept.frontmatter.title).toBe("Sparse Attention")
      // Snapshot written under sources/.
      const sourceFiles = await storage.list("sources/")
      expect(sourceFiles.length).toBeGreaterThan(0)

      // Undo reverts it.
      const undoRes = await ingestUndoRoute.POST(
        new Request("http://x/api/skills/ingest/undo", { method: "POST", body: JSON.stringify({ changesetId }) }),
      )
      expect(undoRes.status).toBe(200)
      const undoBody = await jsonResult<{ ok: true }>(undoRes)
      expect(undoBody.ok).toBe(true)
      expect(await storage.read(CONCEPT_PATH)).toBeNull()
    })

    it("a skill run failure (e.g. missing key with no provider override) terminates the stream with a terminal error, not a result", async () => {
      // No providerOverride and no keys in settings -> buildProvider throws MissingKeyError inside the run.
      setSkillTestOverrides({})

      const res = await ingestRoute.POST(
        new Request("http://x/api/skills/ingest", { method: "POST", body: JSON.stringify({ paper: PAPER }) }),
      )
      await expect(readNdjson(res, () => undefined)).rejects.toThrow(/missing api key/i)
    })

    it("undo with an unknown changesetId returns a 500 error", async () => {
      const res = await ingestUndoRoute.POST(
        new Request("http://x/api/skills/ingest/undo", { method: "POST", body: JSON.stringify({ changesetId: "cs-missing" }) }),
      )
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/not found/i)
    })
  })
})

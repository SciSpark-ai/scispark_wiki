import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { loadBundle } from "../../vault/bundle"
import { parseDocument } from "../../vault/frontmatter"
import { writeIndex } from "../../vault/index-builder"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { acquireFullText, snapshotSource } from "../../wiki/acquire"
import { loadRouting, validateFilesAgainstRouting } from "../../wiki/schema-routing"
import { listReviews } from "../../wiki/review-queue"
import type { PaperRecord } from "../../papers/types"
import { generateDigest } from "../digest"
import { ingestSkill, undoIngest, type IngestOutput } from "../ingest"
import { runSkill } from "../runner"

/**
 * LIVE end-to-end gate for M4: a real paper acquired from arXiv, digested and
 * ingested through a real LLM into a real (in-memory) vault, then undone.
 * Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_API_KEY=... \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   npx vitest run src/lib/skills/__tests__/live-ingest.test.ts
 *
 * Makes real network calls (arXiv + the LLM endpoint) and spends real (small)
 * money — never runs in CI.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 300_000 // analysis + generation on a reasoning model takes a while

/**
 * A small, stable, real arXiv paper with a known HTML mirror
 * (https://arxiv.org/html/1706.03762 — v7 has HTML). Metadata hardcoded so
 * the test doesn't also depend on a live search API.
 */
const PAPER: PaperRecord = {
  ids: { arxiv: "1706.03762" },
  title: "Attention Is All You Need",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }, { name: "Niki Parmar" }],
  year: 2017,
  venue: "NeurIPS",
  abstract:
    "The dominant sequence transduction models are based on complex recurrent or " +
    "convolutional neural networks that include an encoder and a decoder. We propose a " +
    "new simple network architecture, the Transformer, based solely on attention " +
    "mechanisms, dispensing with recurrence and convolutions entirely. Experiments on " +
    "two machine translation tasks show these models to be superior in quality while " +
    "being more parallelizable and requiring significantly less time to train.",
  fields: ["Machine Learning"],
  source: "arxiv",
}

/**
 * Node relay shim: acquireFullText talks to the M3 same-origin relay
 * (`/api/fetch?url=…` + `/api/resolve?doi=…`), which doesn't exist in a plain
 * Node vitest process. Rewrite relay fetches to direct fetches of the decoded
 * target, and answer /api/resolve with a 503 (skipping the DOI-resolve path —
 * this paper has no DOI anyway).
 */
const relayShimFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (url.startsWith("/api/fetch?url=")) {
    const target = decodeURIComponent(url.slice("/api/fetch?url=".length))
    return fetch(target, init)
  }
  if (url.startsWith("/api/resolve?")) {
    return new Response("resolve relay disabled in live test", { status: 503 })
  }
  return fetch(input as Parameters<typeof fetch>[0], init)
}

/** All wiki pages + index.md, path -> exact content — the undo-comparison scope. */
async function snapshotWikiAndIndex(storage: MemoryVaultStorage): Promise<Record<string, string>> {
  const paths = (await storage.list("")).filter((p) => p.startsWith("wiki/") || p === "index.md")
  const out: Record<string, string> = {}
  for (const path of paths) out[path] = (await storage.read(path)) as string
  return out
}

describe.skipIf(!live)("LIVE ingest end-to-end gate", () => {
  it(
    "acquire → digest → ingest → validate → undo, against a real LLM",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()
      const today = new Date().toISOString().slice(0, 10)
      await createVault(storage, {
        purpose: "Track research on large language models and NLP.",
        today,
      })

      const settings = {
        ...DEFAULT_SETTINGS,
        keys: { openai: API_KEY as string },
        baseUrls: { openai: BASE_URL as string },
        tierModels: {
          fast: { provider: "openai" as const, model: MODEL as string },
          strong: { provider: "openai" as const, model: MODEL as string },
        },
        dailyBudgetUsd: 5,
      }

      // ── Acquire ─────────────────────────────────────────────────────────
      const acquired = await acquireFullText(PAPER, { fetchFn: relayShimFetch, apiBase: "" })
      console.log(
        `[live-ingest] acquisition: kind=${acquired.kind} textChars=${acquired.text.length}` +
          (acquired.sourceUrl ? ` sourceUrl=${acquired.sourceUrl}` : ""),
      )
      // arXiv HTML availability is not this gate's subject: if the mirror is
      // down we proceed on the abstract and adapt the full_text assertion.
      expect(["html", "abstract"]).toContain(acquired.kind)
      let snapshotPath: string | undefined
      if (acquired.kind === "html" && acquired.html) {
        snapshotPath = await snapshotSource(storage, PAPER, acquired.html)
      }

      // ── Digest ──────────────────────────────────────────────────────────
      const digestRes = await generateDigest(storage, PAPER, {
        fullText: acquired.text,
        settings,
      })
      console.log(
        `[live-ingest] digest: fromCache=${digestRes.fromCache} costUsd=${digestRes.costUsd}`,
      )
      expect(digestRes.digest.summary.length).toBeGreaterThan(0)

      // Normalize index.md into writeIndex-canonical form before snapshotting:
      // undoIngest rebuilds index.md via writeIndex, so the pre/post comparison
      // must start from writeIndex's serialization, not scaffold's initial stub.
      await writeIndex(storage, await loadBundle(storage))

      // ── Pre-ingest snapshot (undo comparison baseline) ──────────────────
      const preSnapshot = await snapshotWikiAndIndex(storage)

      // ── Ingest ──────────────────────────────────────────────────────────
      const run = await runSkill({
        skill: ingestSkill,
        input: {
          storage,
          paper: PAPER,
          digest: digestRes.digest,
          fullText: { kind: acquired.kind, text: acquired.text, snapshotPath },
          today,
        },
        storage,
        settings,
      })
      console.log(
        `[live-ingest] runSkill: status=${run.status} costUsd=${run.costUsd} ` +
          `usage=${JSON.stringify(run.usage)} logs=${JSON.stringify(run.logs)}`,
      )
      if (run.status !== "ok") console.log(`[live-ingest] run error: ${run.error}`)
      expect(run.status).toBe("ok")

      const output = run.output as IngestOutput
      if (output.status === "draft") {
        // Print everything needed for prompt iteration before failing the gate.
        console.log(`[live-ingest] DRAFT — validation errors:\n${output.errors.join("\n")}`)
        for (const f of output.draftFiles) {
          console.log(
            `[live-ingest] draft file: path=${f.path} type=${f.type} title=${f.title}\n${f.body}`,
          )
        }
      }
      expect(output.status).toBe("ok")
      if (output.status !== "ok") return // type narrowing for the rest

      // ── Paper page ──────────────────────────────────────────────────────
      const paperPagePath = "wiki/papers/1706-03762.md"
      const paperPageRaw = await storage.read(paperPagePath)
      expect(paperPageRaw).not.toBeNull()
      const paperPage = parseDocument(paperPageRaw as string)
      expect(paperPage.frontmatter.arxiv).toBe("1706.03762")
      expect(paperPage.frontmatter.authors).toEqual(["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"])
      expect(paperPage.frontmatter.full_text).toBe(acquired.kind === "html")
      expect(paperPage.body).toContain("## Digest")

      // ── Page population + routing validation ───────────────────────────
      const allTouched = [...output.pages.created, ...output.pages.updated]
      const authorPages = allTouched.filter((p) => p.startsWith("wiki/authors/"))
      expect(authorPages.length).toBeGreaterThanOrEqual(1)
      const knowledgePages = allTouched.filter(
        (p) => !p.startsWith("wiki/papers/") && !p.startsWith("wiki/authors/"),
      )
      expect(knowledgePages.length).toBeGreaterThanOrEqual(1)

      const routing = await loadRouting(storage)
      const filesForRouting: Array<{ path: string; type: string }> = []
      for (const path of allTouched) {
        const doc = parseDocument((await storage.read(path)) as string)
        filesForRouting.push({ path, type: doc.frontmatter.type })
      }
      expect(validateFilesAgainstRouting(filesForRouting, routing)).toEqual([])

      // ── index.md / log.md / reviews ─────────────────────────────────────
      const index = (await storage.read("index.md")) as string
      expect(index).toContain("1706-03762")
      const log = (await storage.read("log.md")) as string
      expect(log).toMatch(/\bingest\b/)

      const reviews = await listReviews(storage)
      expect(reviews.length).toBe(output.reviews)
      for (const review of reviews) {
        expect(review.changesetId).toBe(output.changesetId)
        expect(["contradiction", "duplicate", "missing-page", "suggestion"]).toContain(review.kind)
      }

      // ── Report output: page tree + one generated page body ─────────────
      const tree = await storage.list("wiki/")
      console.log(`[live-ingest] page tree:\n${tree.map((p) => `  ${p}`).join("\n")}`)
      const samplePath = knowledgePages[0]
      console.log(
        `[live-ingest] sample generated page (${samplePath}):\n${await storage.read(samplePath)}`,
      )
      console.log(
        `[live-ingest] reviews (${reviews.length}): ${JSON.stringify(
          reviews.map((r) => ({ kind: r.kind, title: r.title })),
        )}`,
      )

      // ── Costs ───────────────────────────────────────────────────────────
      const totalCost = (digestRes.costUsd ?? 0) + run.costUsd
      console.log(`[live-ingest] total cost: $${totalCost.toFixed(4)} (digest + ingest)`)
      expect(totalCost).toBeLessThan(1.0)

      // ── Undo restores the pre-ingest vault exactly ──────────────────────
      // Scope: wiki/** + index.md. Excluded by design: log.md (gains the undo
      // entry), .scispark/** (digest cache, run/usage records, changeset audit
      // record, archived reviews — all written outside the changeset), and
      // sources/** (immutable snapshot written before ingest).
      await undoIngest(storage, output.changesetId)
      const postSnapshot = await snapshotWikiAndIndex(storage)
      expect(postSnapshot).toEqual(preSnapshot)
      expect((await storage.read("log.md")) as string).toMatch(/\bundo\b/)
      expect(await listReviews(storage)).toEqual([])
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live ingest gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})

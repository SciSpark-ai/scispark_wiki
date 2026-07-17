import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { Frontmatter } from "../../vault/types"
import { listReviews } from "../../wiki/review-queue"
import type { LintFinding } from "../../lint/types"
import * as lintRoute from "../../../app/api/skills/lint/route"
import * as lintEstimateRoute from "../../../app/api/skills/lint/estimate/route"
import * as lintFixRoute from "../../../app/api/skills/lint/fix/route"

/**
 * Route-level tests for the M12 Task 9 lint API surface (mirrors
 * trending-api.test.ts): the orchestrator logic itself
 * (runLintDeterministic/runLintLlm/applyLintFix) is already covered by
 * src/lib/lint/__tests__/run.test.ts — these tests only verify that the
 * routes wire request parsing, getServerVault(), settings/provider
 * assembly, and NDJSON/JSON framing correctly.
 */

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-14",
  updated: "2026-07-14",
  tags: [],
  related: [],
  sources: ["s.pdf"],
  ...extra,
})

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

describe("lint skill routes", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  describe("POST /api/skills/lint", () => {
    it("{mode: 'deterministic'} returns JSON {result: {findings, reviewIds}} and writes review items to the vault", async () => {
      await storage.write("wiki/concepts/lonely.md", serializeDocument(fm("concept", "Lonely"), "No links here."))
      await storage.write(
        "wiki/concepts/a.md",
        serializeDocument(fm("concept", "A"), "See [[nonexistent-page]] for details."),
      )

      const res = await lintRoute.POST(
        new Request("http://x/api/skills/lint", { method: "POST", body: JSON.stringify({ mode: "deterministic" }) }),
      )

      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("application/json")

      const body = (await res.json()) as { result: { findings: LintFinding[]; reviewIds: string[] } }
      expect(body.result.findings.length).toBeGreaterThanOrEqual(2)
      expect(body.result.reviewIds).toHaveLength(body.result.findings.length)

      // Wrote through to the SAME test vault, not some other instance.
      const reviews = await listReviews(storage)
      expect(reviews).toHaveLength(body.result.findings.length)
      expect(reviews.every((r) => r.kind === "lint-finding")).toBe(true)
    })

    it("{mode: 'llm'} streams NDJSON per-pair progress and terminates with result payload {findings, reviewIds, costUsd}", async () => {
      await storage.write(
        "wiki/concepts/foo.md",
        serializeDocument(fm("concept", "Foo"), "Foo scales linearly with input size."),
      )
      await storage.write(
        "wiki/concepts/bar.md",
        serializeDocument(fm("concept", "Bar"), "Bar (same setup as Foo) scales quadratically."),
      )

      const screenPairs = {
        pairs: [{ a: "wiki/concepts/foo", b: "wiki/concepts/bar", reason: "opposite scaling trends" }],
      }
      const verdictContradiction = {
        verdict: "contradiction" as const,
        explanation: "Foo claims linear scaling; Bar claims quadratic scaling for the same setup.",
      }
      const fastProvider = new MockProvider([structuredResult(screenPairs)])
      const strongProvider = new MockProvider([structuredResult(verdictContradiction)])
      setSkillTestOverrides({ providerOverride: { fast: fastProvider, strong: strongProvider } })

      const res = await lintRoute.POST(
        new Request("http://x/api/skills/lint", { method: "POST", body: JSON.stringify({ mode: "llm" }) }),
      )

      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("application/x-ndjson")

      const progressEvents: unknown[] = []
      const result = (await readNdjson(res, (e) => progressEvents.push(e))) as {
        findings: LintFinding[]
        reviewIds: string[]
        costUsd: number
      }

      expect(progressEvents).toEqual([
        { type: "progress", index: 0, total: 1, pair: { a: "wiki/concepts/foo", b: "wiki/concepts/bar" } },
      ])
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].lintKind).toBe("contradiction")
      expect(result.reviewIds).toHaveLength(1)
      expect(result.costUsd).toBeGreaterThan(0)

      const reviews = await listReviews(storage)
      expect(reviews.filter((r) => r.lintKind === "contradiction")).toHaveLength(1)
    })
  })

  describe("POST /api/skills/lint/estimate", () => {
    it("returns a positive static costUsd with no vault content and no provider needed", async () => {
      const res = await lintEstimateRoute.POST(
        new Request("http://x/api/skills/lint/estimate", { method: "POST", body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { result: { costUsd: number } }
      expect(body.result.costUsd).toBeGreaterThan(0)
    })
  })

  describe("POST /api/skills/lint/fix", () => {
    it("applies a lint finding's fix to the test vault, returning {changesetId, outcome}", async () => {
      await storage.write(
        "wiki/concepts/a.md",
        serializeDocument(fm("concept", "A"), "See [[nonexistent-page]] for details."),
      )

      const runRes = await lintRoute.POST(
        new Request("http://x/api/skills/lint", { method: "POST", body: JSON.stringify({ mode: "deterministic" }) }),
      )
      const runBody = (await runRes.json()) as { result: { reviewIds: string[] } }
      const reviews = await listReviews(storage)
      const brokenLinkItem = reviews.find((r) => r.lintKind === "broken-link")!
      expect(runBody.result.reviewIds).toContain(brokenLinkItem.id)

      const before = await storage.read("wiki/concepts/a.md")
      expect(before).toContain("[[nonexistent-page]]")

      const fixRes = await lintFixRoute.POST(
        new Request("http://x/api/skills/lint/fix", {
          method: "POST",
          body: JSON.stringify({ reviewId: brokenLinkItem.id }),
        }),
      )
      expect(fixRes.status).toBe(200)
      const fixBody = (await fixRes.json()) as { result: { changesetId: string; outcome: string } }
      expect(fixBody.result.changesetId).toBeTruthy()
      expect(fixBody.result.outcome).toBe("applied")

      const after = await storage.read("wiki/concepts/a.md")
      expect(after).not.toContain("[[nonexistent-page]]")
      expect(after).toContain("nonexistent-page")
    })

    it("returns 500 {error} for unknown reviewId", async () => {
      const res = await lintFixRoute.POST(
        new Request("http://x/api/skills/lint/fix", {
          method: "POST",
          body: JSON.stringify({ reviewId: "unknown-review-id-12345" }),
        }),
      )
      expect(res.status).toBe(500)
      expect(res.headers.get("content-type")).toBe("application/json")
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeTruthy()
      expect(body.error).toContain("review item not found")
    })
  })
})

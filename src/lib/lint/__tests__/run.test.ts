import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { buildIndexMarkdown } from "../../vault/index-builder"
import { loadChangeset, revertChangeset } from "../../vault/changesets"
import { readRecentEvents } from "../../events/log"
import { listReviews } from "../../wiki/review-queue"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import type { Frontmatter } from "../../vault/types"
import { runDeterministicChecks } from "../checks"
import { runLintDeterministic, runLintLlm, applyLintFix, LINT_FIX_NOOP_SENTINEL } from "../run"

const NOW = () => new Date("2026-07-14T10:00:00.000Z")

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

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
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

describe("runLintDeterministic", () => {
  it("writes one review item per finding, with kind lint-finding and lintKind carried", async () => {
    const s = new MemoryVaultStorage()
    // Orphan (no inbound links) + broken link (mechanical fix) + missing "updated" (mechanical fix).
    await s.write("wiki/concepts/lonely.md", serializeDocument(fm("concept", "Lonely"), "No links here."))
    await s.write(
      "wiki/concepts/a.md",
      serializeDocument(fm("concept", "A"), "See [[nonexistent-page]] for details."),
    )

    const result = await runLintDeterministic(s, { now: NOW })

    expect(result.findings.length).toBeGreaterThanOrEqual(2)
    expect(result.reviewIds).toHaveLength(result.findings.length)

    const reviews = await listReviews(s)
    expect(reviews).toHaveLength(result.findings.length)
    for (const item of reviews) {
      expect(item.kind).toBe("lint-finding")
      expect(item.lintKind).toBeDefined()
    }

    const brokenLinkItem = reviews.find((r) => r.lintKind === "broken-link")
    expect(brokenLinkItem).toBeDefined()
    expect(brokenLinkItem?.fix).toBeDefined()
    expect(brokenLinkItem?.fix?.path).toBe("wiki/concepts/a.md")

    const orphanItem = reviews.find((r) => r.lintKind === "orphan")
    expect(orphanItem).toBeDefined()
    expect(orphanItem?.fix).toBeUndefined()
  })

  it("one bad finding does not abort the batch: a storage write failure on one item still writes the rest", async () => {
    // Counts only .scispark/review/ writes (setup writes to wiki/ pages must not
    // shift which review write fails), so the failure point is deterministic
    // regardless of how many findings the checks produce.
    class FlakyStorage extends MemoryVaultStorage {
      private reviewWriteCount = 0
      async write(path: string, content: string): Promise<void> {
        if (path.startsWith(".scispark/review/")) {
          this.reviewWriteCount++
          if (this.reviewWriteCount === 2) throw new Error("simulated write failure")
        }
        return super.write(path, content)
      }
    }
    const s = new FlakyStorage()
    await s.write("wiki/concepts/lonely1.md", serializeDocument(fm("concept", "Lonely1"), "No links."))
    await s.write("wiki/concepts/lonely2.md", serializeDocument(fm("concept", "Lonely2"), "No links."))
    await s.write("wiki/concepts/lonely3.md", serializeDocument(fm("concept", "Lonely3"), "No links."))

    const result = await runLintDeterministic(s, { now: NOW })
    // 3 orphans + 1 index-drift (no index.md exists yet, but the vault has pages).
    expect(result.findings).toHaveLength(4)
    // One write failed, so fewer review items were actually persisted, but the call
    // did not throw and the batch continued.
    expect(result.reviewIds.length).toBe(3)
    const reviews = await listReviews(s)
    expect(reviews.length).toBe(result.reviewIds.length)
  })

  it("logs a lint_run event with mode deterministic and the finding count", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/lonely.md", serializeDocument(fm("concept", "Lonely"), "No links here."))

    const result = await runLintDeterministic(s, { now: NOW })

    const events = await readRecentEvents(s)
    const lintEvents = events.filter((e) => e.type === "lint_run")
    expect(lintEvents).toHaveLength(1)
    expect(lintEvents[0]).toMatchObject({ type: "lint_run", mode: "deterministic", findingCount: result.findings.length })
  })

  it("index-drift: reports the finding as advisory (no fix applied automatically), still yielding a review item", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "Body."))
    // index.md exists but is stale (doesn't match buildIndexMarkdown of current bundle).
    await s.write("index.md", "# Index\n\nstale\n")

    const result = await runLintDeterministic(s, { now: NOW })
    const driftFinding = result.findings.find((f) => f.lintKind === "index-drift")
    expect(driftFinding).toBeDefined()

    const reviews = await listReviews(s)
    const driftItem = reviews.find((r) => r.lintKind === "index-drift")
    expect(driftItem).toBeDefined()
    // The finding does carry a fix (index.md before/after) — checks.ts computes it —
    // but applying it is special-cased in applyLintFix (see below), not a normal
    // applyChangeset-backed fix.
    expect(driftItem?.fix?.path).toBe("index.md")
  })
})

describe("applyLintFix", () => {
  it("applies a broken-link fix changeset, and undo via the standard changeset revert path restores the original body", async () => {
    const s = new MemoryVaultStorage()
    const rawBody = "See [[nonexistent-page]] for details."
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), rawBody))

    const { reviewIds } = await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const brokenLinkItem = reviews.find((r) => r.lintKind === "broken-link")!
    expect(reviewIds).toContain(brokenLinkItem.id)

    const before = await s.read("wiki/concepts/a.md")
    expect(before).toContain("[[nonexistent-page]]")

    const { changesetId } = await applyLintFix(s, brokenLinkItem.id)
    const after = await s.read("wiki/concepts/a.md")
    expect(after).not.toContain("[[nonexistent-page]]")
    expect(after).toContain("nonexistent-page")

    // Undo via the existing changeset revert path.
    const cs = await loadChangeset(s, changesetId)
    expect(cs).not.toBeNull()
    await revertChangeset(s, cs!)
    const restored = await s.read("wiki/concepts/a.md")
    expect(restored).toBe(before)
  })

  it("applies a bad-frontmatter fix (missing 'updated' defaulted to 'created') stored on a review item", async () => {
    // findBadFrontmatter's mechanical "missing updated -> default to created" fix
    // (src/lib/lint/checks.ts) is, by design, unreachable via the normal
    // loadBundle -> runDeterministicChecks path: parseDocument itself requires
    // "updated" to be present, so a page missing it never makes it into
    // bundle.pages in the first place (loadBundle records a parse error
    // instead) — checks.ts's own unit tests (checks.test.ts) exercise that
    // fix logic against a hand-built Bundle for exactly this reason. Task 8's
    // job is applying whatever `fix` a review item carries, regardless of
    // which check produced it, so this test writes the review item directly
    // (as a hand-crafted bundle would have produced it) and exercises
    // applyLintFix's generic apply path against it.
    const s = new MemoryVaultStorage()
    // A raw document missing "updated" entirely -- frontmatter.ts requires the key
    // when parsing normally, so this simulates exactly the kind of document a
    // hand-built bundle (not loadBundle) could see, matching checks.test.ts's
    // bundleFromPages fixtures -- stored as-is (not written via serializeDocument,
    // which would refuse to omit a required key).
    const before = ["---", "type: concept", "title: Foo", "created: 2026-07-01", "tags: []", "related: []", "sources: []", "---", "", "Body text.", ""].join("\n")
    await s.write("wiki/concepts/foo.md", before)
    const after = serializeDocument(fm("concept", "Foo", { created: "2026-07-01", updated: "2026-07-01" }), "Body text.")

    const item = {
      id: "manual-bad-fm-1",
      createdAt: NOW().toISOString(),
      kind: "lint-finding" as const,
      lintKind: "bad-frontmatter" as const,
      title: "\"wiki/concepts/foo\" is missing \"updated\"",
      description: "test fixture",
      pages: ["wiki/concepts/foo"],
      fix: { path: "wiki/concepts/foo.md", before, after },
    }
    await s.write(".scispark/review/manual-bad-fm-1.json", JSON.stringify(item, null, 2))

    const { changesetId } = await applyLintFix(s, "manual-bad-fm-1")
    const fixed = await s.read("wiki/concepts/foo.md")
    expect(fixed).toBe(after)
    expect(fixed).toContain("updated: 2026-07-01")

    const cs = await loadChangeset(s, changesetId)
    expect(cs).not.toBeNull()
    await revertChangeset(s, cs!)
    expect(await s.read("wiki/concepts/foo.md")).toBe(before)
  })

  it("index-drift: bypasses applyChangeset (protected path) and rewrites index.md via the deterministic index-builder path", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "Body."))
    await s.write("index.md", "# Index\n\nstale\n")

    await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const driftItem = reviews.find((r) => r.lintKind === "index-drift")!

    const { changesetId } = await applyLintFix(s, driftItem.id)
    // No real changeset record is created for this fix (index.md is a protected
    // path and the fix bypasses applyChangeset entirely) — the returned id is a
    // non-persisted sentinel, documented in run.ts.
    const cs = await loadChangeset(s, changesetId)
    expect(cs).toBeNull()

    const bundle = await loadBundle(s)
    const indexNow = await s.read("index.md")
    expect(indexNow).toBe(buildIndexMarkdown(bundle))
  })

  it("two broken links on one page: applying the first fix does not conflict the second (both neutralized, page stays valid)", async () => {
    // Regression for the Task-10 finding: each review item stored fix.before =
    // the FULL page. Before the recompute-at-apply change, applying the first
    // fix mutated the page, so the second fix's stored `before` no longer
    // matched disk and applyChangeset threw ChangesetConflictError.
    const s = new MemoryVaultStorage()
    const rawBody = "See [[ghost-one]] and also [[ghost-two]] for details."
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), rawBody))

    await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const brokenItems = reviews.filter((r) => r.lintKind === "broken-link")
    expect(brokenItems).toHaveLength(2)
    // Each carries the slug discriminator so applyLintFix can re-find the exact
    // finding after a sibling fix mutates the page.
    expect(brokenItems.map((r) => r.fixTarget).sort()).toEqual(["ghost-one", "ghost-two"])

    // Apply the first fix — a real changeset, not a no-op.
    const first = await applyLintFix(s, brokenItems[0].id)
    expect(first.changesetId).not.toBe(LINT_FIX_NOOP_SENTINEL)
    expect(await loadChangeset(s, first.changesetId)).not.toBeNull()

    // Apply the second fix — must NOT throw ChangesetConflictError, must remove
    // the remaining broken link.
    const second = await applyLintFix(s, brokenItems[1].id)
    expect(second.changesetId).not.toBe(LINT_FIX_NOOP_SENTINEL)
    expect(second.changesetId).not.toBe(first.changesetId)

    const finalContent = await s.read("wiki/concepts/a.md")
    expect(finalContent).not.toContain("[[")
    expect(finalContent).toContain("ghost-one")
    expect(finalContent).toContain("ghost-two")

    // Page still parses into the bundle and has no broken links left.
    const bundle = await loadBundle(s)
    expect(bundle.errors).toHaveLength(0)
    expect(bundle.pages.has("wiki/concepts/a")).toBe(true)
    const refreshed = runDeterministicChecks(bundle, {})
    expect(refreshed.filter((f) => f.lintKind === "broken-link")).toHaveLength(0)
  })

  it("a fix whose finding is already resolved (sibling fixed it / it's gone) is a clean no-op — no throw, sentinel id, nothing written", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See [[ghost]] for details."))

    await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const brokenItem = reviews.find((r) => r.lintKind === "broken-link")!

    // Resolve it out-of-band: a manual edit removes the broken link before the
    // user clicks Fix.
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See ghost for details."))
    const contentBefore = await s.read("wiki/concepts/a.md")

    const res = await applyLintFix(s, brokenItem.id)
    expect(res.changesetId).toBe(LINT_FIX_NOOP_SENTINEL)
    // No changeset was persisted and the page was left untouched.
    expect(await loadChangeset(s, res.changesetId)).toBeNull()
    expect(await s.read("wiki/concepts/a.md")).toBe(contentBefore)
  })
})

describe("runLintLlm", () => {
  it("screens then judges, writing a contradiction review item and filtering out 'none' verdicts", async () => {
    const s = new MemoryVaultStorage()
    await s.write(
      "wiki/concepts/foo.md",
      serializeDocument(fm("concept", "Foo"), "Foo scales linearly with input size."),
    )
    await s.write(
      "wiki/concepts/bar.md",
      serializeDocument(fm("concept", "Bar"), "Bar (same setup as Foo) scales quadratically."),
    )
    await s.write(
      "wiki/concepts/baz.md",
      serializeDocument(fm("concept", "Baz"), "Baz is unrelated."),
    )

    const screenPairs = {
      pairs: [
        { a: "wiki/concepts/foo", b: "wiki/concepts/bar", reason: "both claim opposite scaling trends" },
        { a: "wiki/concepts/foo", b: "wiki/concepts/baz", reason: "weak overlap" },
      ],
    }
    const verdictContradiction = {
      verdict: "contradiction" as const,
      explanation: "Foo claims linear scaling; Bar claims quadratic scaling for the same setup.",
    }
    const verdictNone = { verdict: "none" as const, explanation: "No real conflict." }

    const fastProvider = new MockProvider([structuredResult(screenPairs)])
    const strongProvider = new MockProvider([structuredResult(verdictContradiction), structuredResult(verdictNone)])

    const progressCalls: Array<{ index: number; total: number }> = []

    const result = await runLintLlm(s, {
      settings: settingsWithKeys(),
      providerOverride: { fast: fastProvider, strong: strongProvider },
      now: NOW,
      onProgress: (info) => progressCalls.push({ index: info.index, total: info.total }),
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].lintKind).toBe("contradiction")
    expect(result.findings[0].pages).toEqual(["wiki/concepts/foo", "wiki/concepts/bar"])
    expect(progressCalls).toHaveLength(2)
    expect(progressCalls[1].total).toBe(2)

    const reviews = await listReviews(s)
    const contradictionItems = reviews.filter((r) => r.lintKind === "contradiction")
    expect(contradictionItems).toHaveLength(1)
    // The "none" verdict pair produced no review item.
    expect(reviews).toHaveLength(1)

    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.reviewIds).toHaveLength(1)
  })

  it("sums cost across the screen call and every judge call, and logs a lint_run llm event", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/foo.md", serializeDocument(fm("concept", "Foo"), "Foo body."))
    await s.write("wiki/concepts/bar.md", serializeDocument(fm("concept", "Bar"), "Bar body."))

    const screenPairs = { pairs: [{ a: "wiki/concepts/foo", b: "wiki/concepts/bar", reason: "r" }] }
    const verdictStale = { verdict: "stale-claim" as const, explanation: "Superseded by bar." }

    const fastProvider = new MockProvider([structuredResult(screenPairs)])
    const strongProvider = new MockProvider([structuredResult(verdictStale)])

    const result = await runLintLlm(s, {
      settings: settingsWithKeys(),
      providerOverride: { fast: fastProvider, strong: strongProvider },
      now: NOW,
    })

    expect(result.costUsd).toBeGreaterThan(0)

    const events = await readRecentEvents(s)
    const lintEvents = events.filter((e) => e.type === "lint_run")
    expect(lintEvents).toHaveLength(1)
    expect(lintEvents[0]).toMatchObject({ type: "lint_run", mode: "llm", findingCount: 1 })
    expect((lintEvents[0] as { costUsd?: number }).costUsd).toBeGreaterThan(0)
  })

  it("zero candidate pairs from screen: no judge calls, empty findings, event still logged", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/foo.md", serializeDocument(fm("concept", "Foo"), "Foo body."))

    const fastProvider = new MockProvider([structuredResult({ pairs: [] })])
    const strongProvider = new MockProvider([])

    const result = await runLintLlm(s, {
      settings: settingsWithKeys(),
      providerOverride: { fast: fastProvider, strong: strongProvider },
      now: NOW,
    })

    expect(result.findings).toEqual([])
    expect(result.reviewIds).toEqual([])
    expect(strongProvider.calls).toHaveLength(0)

    const events = await readRecentEvents(s)
    expect(events.filter((e) => e.type === "lint_run")).toHaveLength(1)
  })
})

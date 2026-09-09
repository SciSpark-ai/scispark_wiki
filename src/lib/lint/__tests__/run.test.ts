import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { buildIndexMarkdown } from "../../vault/index-builder"
import { loadChangeset, revertChangeset } from "../../vault/changesets"
import { readRecentEvents } from "../../events/log"
import { listReviews, dismissReview } from "../../wiki/review-queue"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import type { Frontmatter } from "../../vault/types"
import { runDeterministicChecks } from "../checks"
import {
  runLintDeterministic,
  runLintLlm,
  runPostIngestLint,
  applyLintFix,
  findingIdentity,
  LINT_FIX_NOOP_SENTINEL,
} from "../run"

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

  it("write-time dedupe: two consecutive runs on a vault with one broken link produce ONE open review item", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See [[ghost]] for details."))

    const first = await runLintDeterministic(s, { now: NOW })
    const brokenLinkFinding = first.findings.find((f) => f.lintKind === "broken-link")
    expect(brokenLinkFinding).toBeDefined()
    expect(first.reviewIds.length).toBeGreaterThan(0)

    const afterFirst = await listReviews(s)
    expect(afterFirst.filter((r) => r.lintKind === "broken-link")).toHaveLength(1)

    // Second run re-detects the SAME still-open broken link (nothing fixed it),
    // but must not write a second review item for it — write-time dedupe against
    // the already-open item, keyed by findingIdentity.
    const second = await runLintDeterministic(s, { now: NOW })
    expect(second.findings.some((f) => f.lintKind === "broken-link")).toBe(true)

    const afterSecond = await listReviews(s)
    expect(afterSecond.filter((r) => r.lintKind === "broken-link")).toHaveLength(1)
    // Still exactly the same review id as after the first run.
    expect(afterSecond.find((r) => r.lintKind === "broken-link")?.id).toBe(
      afterFirst.find((r) => r.lintKind === "broken-link")?.id,
    )
  })

  it("write-time dedupe: a DISMISSED finding is not excluded — it can legitimately reappear as a fresh review item", async () => {
    const s = new MemoryVaultStorage()
    // Linked from "hub" so "a" isn't ALSO flagged as an orphan — keeps this
    // test scoped to exactly the one broken-link finding under test.
    await s.write("wiki/concepts/hub.md", serializeDocument(fm("concept", "Hub"), "See [[a]]."))
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See [[ghost]] for details."))

    const first = await runLintDeterministic(s, { now: NOW })
    const brokenItem = (await listReviews(s)).find((r) => r.lintKind === "broken-link")!
    expect(first.reviewIds).toContain(brokenItem.id)

    await dismissReview(s, brokenItem.id)
    expect((await listReviews(s)).filter((r) => r.lintKind === "broken-link")).toHaveLength(0)

    // The underlying issue is untouched, so a fresh run must file it again —
    // dismissing does not fix the vault, so this is accepted v1 behavior, not
    // a dedupe bug.
    const second = await runLintDeterministic(s, { now: NOW })
    expect(second.reviewIds.length).toBeGreaterThan(0)
    const reviewsAfter = await listReviews(s)
    expect(reviewsAfter.filter((r) => r.lintKind === "broken-link")).toHaveLength(1)
  })
})

describe("findingIdentity", () => {
  it("combines lintKind, fixTarget (or empty string), and sorted pages", () => {
    expect(findingIdentity({ lintKind: "broken-link", fixTarget: "ghost", pages: ["wiki/concepts/a"] })).toBe(
      "broken-link|ghost|wiki/concepts/a",
    )
    expect(findingIdentity({ lintKind: "orphan", fixTarget: undefined, pages: ["wiki/concepts/a"] })).toBe(
      "orphan||wiki/concepts/a",
    )
    // Page order doesn't matter — sorted before joining.
    expect(findingIdentity({ lintKind: "contradiction", fixTarget: undefined, pages: ["b", "a"] })).toBe(
      findingIdentity({ lintKind: "contradiction", fixTarget: undefined, pages: ["a", "b"] }),
    )
  })
})

describe("runPostIngestLint", () => {
  it("files a scoped finding for a touched page's broken link, and nothing for a pre-existing broken link on an untouched page", async () => {
    const s = new MemoryVaultStorage()
    // Untouched page with a pre-existing broken link — not part of this ingest.
    // Also links to "new" so the touched page isn't ALSO flagged as an orphan
    // (which would otherwise be scoped in too, since it's a distinct real
    // finding on the touched page — this test keeps the assertion to exactly
    // the one finding under test: the broken link).
    await s.write(
      "wiki/concepts/old.md",
      serializeDocument(fm("concept", "Old"), "See [[pre-existing-ghost]] and also [[new]]."),
    )
    // Touched page — this run's changeset introduced the broken link.
    await s.write("wiki/concepts/new.md", serializeDocument(fm("concept", "New"), "See [[does-not-exist]]."))

    const result = await runPostIngestLint(s, ["wiki/concepts/new"], { now: NOW })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].lintKind).toBe("broken-link")
    expect(result.findings[0].pages).toEqual(["wiki/concepts/new"])
    expect(result.reviewIds).toHaveLength(1)

    const reviews = await listReviews(s)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].pages).toEqual(["wiki/concepts/new"])
  })

  it("never files an index-drift finding, even when index.md is stale", async () => {
    const s = new MemoryVaultStorage()
    // Linked from "hub" so "new" isn't flagged as an orphan — isolates this
    // test to exactly the index-drift-exclusion behavior under test.
    await s.write("wiki/concepts/hub.md", serializeDocument(fm("concept", "Hub"), "See [[new]]."))
    await s.write("wiki/concepts/new.md", serializeDocument(fm("concept", "New"), "No other links."))
    // Stale index — would normally produce an index-drift finding.
    await s.write("index.md", "# Index\n\nstale\n")

    const result = await runPostIngestLint(s, ["wiki/concepts/new"], { now: NOW })

    expect(result.findings.some((f) => f.lintKind === "index-drift")).toBe(false)
    expect(result.findings).toHaveLength(0)
    expect(result.reviewIds).toHaveLength(0)
    const reviews = await listReviews(s)
    expect(reviews.every((r) => r.lintKind !== "index-drift")).toBe(true)
  })

  it("does not log a lint_run event — it's a verify step of the ingest run, not a lint run", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/new.md", serializeDocument(fm("concept", "New"), "See [[does-not-exist]]."))

    await runPostIngestLint(s, ["wiki/concepts/new"], { now: NOW })

    const events = await readRecentEvents(s)
    expect(events.filter((e) => e.type === "lint_run")).toHaveLength(0)
  })

  it("applies the same write-time dedupe as runLintDeterministic: a still-open finding from a prior lint run is not re-filed", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/new.md", serializeDocument(fm("concept", "New"), "See [[does-not-exist]]."))

    // A full deterministic lint run already filed this exact broken-link finding.
    await runLintDeterministic(s, { now: NOW })
    const before = await listReviews(s)
    expect(before.filter((r) => r.lintKind === "broken-link")).toHaveLength(1)

    const result = await runPostIngestLint(s, ["wiki/concepts/new"], { now: NOW, changesetId: "cs-later-ingest" })
    expect(result.reviewIds).toHaveLength(0)

    const after = await listReviews(s)
    expect(after.filter((r) => r.lintKind === "broken-link")).toHaveLength(1)
    expect(after).toEqual(before) // Existing warnings must not become owned by the later ingest.
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

    const { changesetId, outcome } = await applyLintFix(s, brokenLinkItem.id)
    expect(outcome).toBe("applied")
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

    const { changesetId, outcome } = await applyLintFix(s, "manual-bad-fm-1")
    expect(outcome).toBe("applied")
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

    const { changesetId, outcome } = await applyLintFix(s, driftItem.id)
    expect(outcome).toBe("applied")
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
    expect(first.outcome).toBe("applied")
    expect(await loadChangeset(s, first.changesetId)).not.toBeNull()

    // Apply the second fix — must NOT throw ChangesetConflictError, must remove
    // the remaining broken link.
    const second = await applyLintFix(s, brokenItems[1].id)
    expect(second.changesetId).not.toBe(LINT_FIX_NOOP_SENTINEL)
    expect(second.changesetId).not.toBe(first.changesetId)
    expect(second.outcome).toBe("applied")

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

  it("duplicate-author (branch 2): applies the multi-file merge changeset (folds the rich duplicate into the skeleton canonical, rewrites the referring page, deletes the duplicate), and undo restores everything", async () => {
    const s = new MemoryVaultStorage()
    // Real Lalor case: skeleton canonical (empty frontmatter, Papers only) +
    // rich name-slug duplicate carrying the biography and frontmatter.
    const canonicalBody = "# Edmund C. Lalor\n\n## Papers\n\n- [[the-paper]]"
    await s.write(
      "wiki/authors/a5074790393.md",
      serializeDocument(fm("author", "Edmund C. Lalor", { openalex: "A5074790393", sources: [] }), canonicalBody),
    )
    const richBody =
      "# Edmund C. Lalor\n\nEdmund C. Lalor is a senior author on [[the-paper]].\n\n## Research contributions\n\nTRF estimation."
    await s.write(
      "wiki/authors/edmund-c-lalor.md",
      serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["neuroscience"], related: ["mtrf-toolbox"] }), richBody),
    )
    await s.write(
      "wiki/papers/p1.md",
      serializeDocument(fm("paper", "Some Paper", { related: ["edmund-c-lalor"] }), "By [[edmund-c-lalor]]."),
    )

    await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const dupItem = reviews.find((r) => r.lintKind === "duplicate-author")!
    expect(dupItem).toBeDefined()
    expect(dupItem.fixes).toBeDefined()

    const canonicalBefore = await s.read("wiki/authors/a5074790393.md")
    const paperBefore = await s.read("wiki/papers/p1.md")
    const dupBefore = await s.read("wiki/authors/edmund-c-lalor.md")

    const { changesetId, outcome } = await applyLintFix(s, dupItem.id)
    expect(changesetId).not.toBe(LINT_FIX_NOOP_SENTINEL)
    expect(outcome).toBe("applied")

    // Duplicate deleted; its biography folded into the canonical; canonical's
    // Papers entry preserved; openalex id kept; referring page repointed.
    expect(await s.read("wiki/authors/edmund-c-lalor.md")).toBeNull()
    const merged = await loadBundle(s)
    const canonicalNow = merged.pages.get("wiki/authors/a5074790393")!
    expect(canonicalNow.body).toContain("senior author")
    expect(canonicalNow.body).toContain("## Research contributions")
    expect(canonicalNow.body).toContain("- [[the-paper]]")
    expect(canonicalNow.frontmatter.openalex).toBe("A5074790393")
    expect(canonicalNow.frontmatter.tags).toEqual(["neuroscience"])
    expect(canonicalNow.frontmatter.related).toEqual(["mtrf-toolbox"])
    const paperAfter = await s.read("wiki/papers/p1.md")
    expect(paperAfter).toContain("[[a5074790393]]")
    expect(paperAfter).not.toContain("edmund-c-lalor")
    expect(merged.pages.get("wiki/papers/p1")?.frontmatter.related).toEqual(["a5074790393"])

    // Undo restores all three files exactly.
    const cs = await loadChangeset(s, changesetId)
    expect(cs).not.toBeNull()
    await revertChangeset(s, cs!)
    expect(await s.read("wiki/authors/a5074790393.md")).toBe(canonicalBefore)
    expect(await s.read("wiki/authors/edmund-c-lalor.md")).toBe(dupBefore)
    expect(await s.read("wiki/papers/p1.md")).toBe(paperBefore)
  })

  it("duplicate-author: a fix whose finding is already resolved is a clean no-op, outcome 'resolved'", async () => {
    const s = new MemoryVaultStorage()
    const canonicalBody = "# Edmund C. Lalor\n\n## Papers\n\n- [[the-paper]]"
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor", { openalex: "A5074790393", sources: [] }), canonicalBody))
    await s.write(
      "wiki/authors/edmund-c-lalor.md",
      serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["neuroscience"] }), "# Edmund C. Lalor\n\nBiography prose here.\n\n## Notes\n\nMore."),
    )

    await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const dupItem = reviews.find((r) => r.lintKind === "duplicate-author")!
    expect(dupItem.fixes).toBeDefined()

    // Resolved out-of-band: the duplicate page is deleted before Fix is clicked.
    await s.delete("wiki/authors/edmund-c-lalor.md")

    const res = await applyLintFix(s, dupItem.id)
    expect(res.changesetId).toBe(LINT_FIX_NOOP_SENTINEL)
    expect(res.outcome).toBe("resolved")
  })

  it("duplicate-author: reclassified to advisory-only by the time Fix is clicked (a sibling change made the canonical no longer a bare skeleton) returns 'needs-manual', not 'resolved' — the finding is still there and the page is left untouched", async () => {
    const s = new MemoryVaultStorage()
    const canonicalBody = "# Edmund C. Lalor\n\n## Papers\n\n- [[the-paper]]"
    await s.write(
      "wiki/authors/a5074790393.md",
      serializeDocument(fm("author", "Edmund C. Lalor", { openalex: "A5074790393", sources: [] }), canonicalBody),
    )
    const richBody =
      "# Edmund C. Lalor\n\nEdmund C. Lalor is a senior author on [[the-paper]].\n\n## Research contributions\n\nTRF estimation."
    await s.write(
      "wiki/authors/edmund-c-lalor.md",
      serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["neuroscience"] }), richBody),
    )

    await runLintDeterministic(s, { now: NOW })
    const reviews = await listReviews(s)
    const dupItem = reviews.find((r) => r.lintKind === "duplicate-author")!
    // Originally classified merge-into-canonical (canonical is a bare skeleton).
    expect(dupItem.fixes).toBeDefined()

    // Sibling change lands before Fix is clicked: the canonical page picks up
    // its own tags/sources, so it's no longer a bare-skeleton-with-empty-
    // frontmatter — classifyDuplicate now falls through to "manual" for this
    // exact same pair (both pages still exist, both still substantive).
    await s.write(
      "wiki/authors/a5074790393.md",
      serializeDocument(
        fm("author", "Edmund C. Lalor", { openalex: "A5074790393", tags: ["neuroscience"], sources: ["x.pdf"] }),
        canonicalBody,
      ),
    )
    const canonicalBeforeApply = await s.read("wiki/authors/a5074790393.md")
    const extraBeforeApply = await s.read("wiki/authors/edmund-c-lalor.md")

    const res = await applyLintFix(s, dupItem.id)
    expect(res.changesetId).toBe(LINT_FIX_NOOP_SENTINEL)
    expect(res.outcome).toBe("needs-manual")

    // Nothing was written — neither page changed, no changeset was created.
    expect(await s.read("wiki/authors/a5074790393.md")).toBe(canonicalBeforeApply)
    expect(await s.read("wiki/authors/edmund-c-lalor.md")).toBe(extraBeforeApply)
  })

  it("a fix whose finding is already resolved (sibling fixed it / it's gone) is a clean no-op — no throw, sentinel id, nothing written, outcome 'resolved'", async () => {
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
    expect(res.outcome).toBe("resolved")
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

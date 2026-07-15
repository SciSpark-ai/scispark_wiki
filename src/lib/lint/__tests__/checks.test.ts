import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { buildIndexMarkdown } from "../../vault/index-builder"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
import {
  findOrphans,
  findBrokenLinks,
  findBadFrontmatter,
  findIndexDrift,
  runDeterministicChecks,
} from "../checks"

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

/** Builds a Bundle directly from raw (possibly malformed) frontmatter objects,
 * bypassing `parseDocument`'s validation — used for defects (e.g. a missing
 * required key) that could never survive `loadBundle`'s parse step, but that
 * `findBadFrontmatter` still defends against for bundles assembled by other
 * means. */
function bundleFromPages(
  entries: Array<{ id: string; path: string; frontmatter: unknown; body: string }>,
  links: Array<{ from: string; to: string }> = [],
): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, { id: e.id, path: e.path, frontmatter: e.frontmatter as Frontmatter, body: e.body })
  }
  return { pages, links, errors: [] }
}

describe("findOrphans", () => {
  it("clean bundle: pages that link to each other have no orphans", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See [[b]]."))
    await s.write("wiki/concepts/b.md", serializeDocument(fm("concept", "B"), "See [[a]]."))
    const b = await loadBundle(s)
    expect(findOrphans(b)).toEqual([])
  })

  it("flags a concept page with zero inbound links", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/lonely.md", serializeDocument(fm("concept", "Lonely"), "No links here."))
    const b = await loadBundle(s)
    const findings = findOrphans(b)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      lintKind: "orphan",
      pages: ["wiki/concepts/lonely"],
    })
    expect(findings[0].fix).toBeUndefined()
  })

  it("does not flag paper/author pages even with zero inbound links (legitimately leaf-linked)", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/papers/p1.md", serializeDocument(fm("paper", "Paper One"), "Abstract."))
    await s.write("wiki/authors/a1.md", serializeDocument(fm("author", "Author One"), "Bio."))
    const b = await loadBundle(s)
    expect(findOrphans(b)).toEqual([])
  })

  it("does not flag reserved files even if present in bundle.pages by some other construction path", () => {
    const b = bundleFromPages([{ id: "log", path: "log.md", frontmatter: fm("note", "Log"), body: "" }])
    expect(findOrphans(b)).toEqual([])
  })
})

describe("findBrokenLinks", () => {
  it("clean bundle: a link that resolves has no findings", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See [[b]]."))
    await s.write("wiki/concepts/b.md", serializeDocument(fm("concept", "B"), "See [[a]]."))
    const b = await loadBundle(s)
    expect(findBrokenLinks(b)).toEqual([])
  })

  it("flags a wikilink whose slug resolves to no page, with a mechanical neutralize-to-plain-text fix", async () => {
    const s = new MemoryVaultStorage()
    const rawBody = "See [[nonexistent-page]] for details."
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), rawBody))
    const b = await loadBundle(s)
    const findings = findBrokenLinks(b)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      lintKind: "broken-link",
      pages: ["wiki/concepts/a"],
    })
    // Compare against the page's *loaded* body (round-tripped through
    // serializeDocument/parseDocument), not the literal string written to
    // storage — parseDocument's body slice includes the blank line after the
    // frontmatter terminator, so it isn't byte-identical to `rawBody`.
    const page = b.pages.get("wiki/concepts/a")!
    expect(findings[0].fix).toEqual({
      path: "wiki/concepts/a.md",
      before: serializeDocument(page.frontmatter, page.body),
      after: serializeDocument(page.frontmatter, page.body.replace("[[nonexistent-page]]", "nonexistent-page")),
    })
  })

  it("neutralizes a piped wikilink to its alias text", async () => {
    const s = new MemoryVaultStorage()
    const rawBody = "See [[nonexistent-page|the missing page]] for details."
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), rawBody))
    const b = await loadBundle(s)
    const findings = findBrokenLinks(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].fix?.after).toContain("See the missing page for details.")
  })
})

describe("findBadFrontmatter", () => {
  it("clean bundle: well-formed frontmatter has no findings", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "Body."))
    const b = await loadBundle(s)
    expect(findBadFrontmatter(b)).toEqual([])
  })

  it("flags an unrecognized type as advisory (no fix)", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concepts", "A"), "Body."))
    const b = await loadBundle(s)
    const findings = findBadFrontmatter(b)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ lintKind: "bad-frontmatter", pages: ["wiki/concepts/a"] })
    expect(findings[0].fix).toBeUndefined()
  })

  it("a missing 'updated' scalar gets a mechanical fix defaulting to 'created'", () => {
    const badFm = {
      type: "concept",
      title: "A",
      created: "2026-07-14",
      tags: [],
      related: [],
      sources: ["s.pdf"],
      // "updated" intentionally omitted
    }
    const b = bundleFromPages([
      { id: "wiki/concepts/a", path: "wiki/concepts/a.md", frontmatter: badFm, body: "Body." },
    ])
    const findings = findBadFrontmatter(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].lintKind).toBe("bad-frontmatter")
    expect(findings[0].pages).toEqual(["wiki/concepts/a"])
    expect(findings[0].fix).toEqual({
      path: "wiki/concepts/a.md",
      before: serializeDocument(badFm as unknown as Frontmatter, "Body."),
      after: serializeDocument({ ...badFm, updated: "2026-07-14" } as unknown as Frontmatter, "Body."),
    })
  })

  it("a structurally-wrong 'related' (not an array) is advisory, no fix", () => {
    const badFm = { ...fm("concept", "A"), related: "not-an-array" }
    const b = bundleFromPages([
      { id: "wiki/concepts/a", path: "wiki/concepts/a.md", frontmatter: badFm, body: "Body." },
    ])
    const findings = findBadFrontmatter(b)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ lintKind: "bad-frontmatter", pages: ["wiki/concepts/a"] })
    expect(findings[0].fix).toBeUndefined()
  })

  it("a missing required key with no safe default (e.g. 'title') is advisory, no fix", () => {
    const badFm = {
      type: "concept",
      created: "2026-07-14",
      updated: "2026-07-14",
      tags: [],
      related: [],
      sources: ["s.pdf"],
      // "title" intentionally omitted
    }
    const b = bundleFromPages([
      { id: "wiki/concepts/a", path: "wiki/concepts/a.md", frontmatter: badFm, body: "Body." },
    ])
    const findings = findBadFrontmatter(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].fix).toBeUndefined()
  })
})

describe("findIndexDrift", () => {
  it("clean: stored index matches the recomputed index -> no findings", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "Body."))
    const b = await loadBundle(s)
    const current = buildIndexMarkdown(b)
    expect(findIndexDrift(b, current)).toEqual([])
  })

  it("flags drift with a mechanical rewrite-to-recomputed fix", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "Body."))
    const b = await loadBundle(s)
    const stale = "# Index\n\n(stale content)\n"
    const findings = findIndexDrift(b, stale)
    expect(findings).toHaveLength(1)
    expect(findings[0].lintKind).toBe("index-drift")
    expect(findings[0].fix).toEqual({
      path: "index.md",
      before: stale,
      after: buildIndexMarkdown(b),
    })
  })

  it("storedIndex undefined ('not supplied') skips the check entirely", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "Body."))
    const b = await loadBundle(s)
    expect(findIndexDrift(b, undefined)).toEqual([])
  })
})

describe("runDeterministicChecks", () => {
  it("composes all four sub-checks, index-drift only when storedIndex is supplied", async () => {
    const s = new MemoryVaultStorage()
    await s.write(
      "wiki/concepts/lonely.md",
      serializeDocument(fm("concept", "Lonely"), "See [[nope]] which doesn't exist."),
    )
    const b = await loadBundle(s)

    const withoutIndex = runDeterministicChecks(b)
    const kinds = withoutIndex.map((f) => f.lintKind).sort()
    expect(kinds).toEqual(["broken-link", "orphan"])

    const withIndex = runDeterministicChecks(b, { storedIndex: "stale" })
    expect(withIndex.map((f) => f.lintKind).sort()).toEqual(["broken-link", "index-drift", "orphan"])
  })

  it("clean bundle with a correct index yields zero findings", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), "See [[b]]."))
    await s.write("wiki/concepts/b.md", serializeDocument(fm("concept", "B"), "See [[a]]."))
    const b = await loadBundle(s)
    const current = buildIndexMarkdown(b)
    expect(runDeterministicChecks(b, { storedIndex: current })).toEqual([])
  })
})

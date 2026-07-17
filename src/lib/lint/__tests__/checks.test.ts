import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { parseDocument, serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { buildIndexMarkdown } from "../../vault/index-builder"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
import {
  findOrphans,
  findBrokenLinks,
  findBadFrontmatter,
  findIndexDrift,
  findDuplicateAuthors,
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

  it("neutralization is fence/inline-code-aware: only the real broken link is rewritten, code spans and valid links survive untouched", async () => {
    const s = new MemoryVaultStorage()
    // A real broken [[foo]], the exact same text inside inline code (must
    // survive unrewritten), and a real, resolvable [[bar]] (must survive
    // unrewritten too — it isn't broken).
    const rawBody = "Real: [[foo]]. Example syntax: `[[foo]]`. Also see [[bar]]."
    await s.write("wiki/concepts/a.md", serializeDocument(fm("concept", "A"), rawBody))
    await s.write("wiki/concepts/bar.md", serializeDocument(fm("concept", "Bar"), "Body."))
    const b = await loadBundle(s)

    const findings = findBrokenLinks(b)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ lintKind: "broken-link", pages: ["wiki/concepts/a"] })

    const after = findings[0].fix!.after
    expect(after).toContain("Real: foo.")
    expect(after).toContain("Example syntax: `[[foo]]`.")
    expect(after).toContain("Also see [[bar]].")
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

  it("the missing-updated mechanical fix's 'after' round-trips through the real frontmatter parser", () => {
    const badFm = {
      type: "concept",
      title: "A",
      created: "2026-07-14",
      tags: [],
      related: [],
      sources: ["s.pdf"],
      // "updated" intentionally omitted, nothing else missing
    }
    const b = bundleFromPages([
      { id: "wiki/concepts/a", path: "wiki/concepts/a.md", frontmatter: badFm, body: "Body." },
    ])
    const findings = findBadFrontmatter(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].fix).toBeDefined()
    const parsed = parseDocument(findings[0].fix!.after)
    expect(parsed.frontmatter).toMatchObject({ ...badFm, updated: "2026-07-14" })
  })

  it("missing 'updated' AND 'title' together: no mechanical fix (it would leave the page still missing 'title'); advisory lists both", () => {
    const badFm = {
      type: "concept",
      created: "2026-07-14",
      tags: [],
      related: [],
      sources: ["s.pdf"],
      // both "title" and "updated" intentionally omitted
    }
    const b = bundleFromPages([
      { id: "wiki/concepts/a", path: "wiki/concepts/a.md", frontmatter: badFm, body: "Body." },
    ])
    const findings = findBadFrontmatter(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].lintKind).toBe("bad-frontmatter")
    expect(findings[0].fix).toBeUndefined()
    expect(findings[0].description).toContain("title")
    expect(findings[0].description).toContain("updated")
  })
})

describe("findDuplicateAuthors", () => {
  it("flags an author with both an id-keyed and a name-keyed page (C6)", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    await s.write("wiki/authors/a5035188059.md", serializeDocument(fm("author", "Adam Bednar"), "Bio."))
    const b = await loadBundle(s)

    const findings = runDeterministicChecks(b).filter((f) => f.lintKind === "duplicate-author")
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toContain("Edmund C. Lalor")
    expect(findings[0].pages).toEqual(["wiki/authors/a5074790393", "wiki/authors/edmund-c-lalor"])
    expect(findings[0].fixTarget).toBe("wiki/authors/edmund-c-lalor")
  })

  it("clean bundle: a lone id-keyed author page (no name-slug duplicate) is not flagged", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5035188059.md", serializeDocument(fm("author", "Adam Bednar"), "Bio."))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("a lone name-slug page with no id-keyed sibling is not flagged (nothing unambiguous to merge onto)", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("normalization collapses case and punctuation/whitespace differences", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    // Same person, different casing/punctuation spacing on the duplicate's title.
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "edmund   c lalor"), "Bio."))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toHaveLength(1)
  })

  it("a group with two id-keyed pages sharing a normalized title is left unflagged (no unambiguous canonical)", async () => {
    const s = new MemoryVaultStorage()
    // Two distinct OpenAlex ids, same display name -- could be two different
    // real people; there's no safe merge target to guess.
    await s.write("wiki/authors/a1111.md", serializeDocument(fm("author", "J. Smith"), "Bio."))
    await s.write("wiki/authors/a2222.md", serializeDocument(fm("author", "J. Smith"), "Bio."))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("non-author pages sharing a normalized title are never considered", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Shared Title"), "Bio."))
    await s.write("wiki/concepts/shared-title.md", serializeDocument(fm("concept", "Shared Title"), "Not an author."))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("the merge fix rewrites wikilinks and related[] from the name slug to the id slug across the bundle, and deletes the name-slug page", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Canonical bio."))
    const dupePage = serializeDocument(fm("author", "Edmund C. Lalor"), "Duplicate bio.")
    await s.write("wiki/authors/edmund-c-lalor.md", dupePage)
    await s.write(
      "wiki/papers/p1.md",
      serializeDocument(fm("paper", "Some Paper", { related: ["edmund-c-lalor"] }), "By [[edmund-c-lalor|Lalor]]."),
    )
    const b = await loadBundle(s)

    const findings = findDuplicateAuthors(b)
    expect(findings).toHaveLength(1)
    const fixes = findings[0].fixes!
    expect(fixes).toBeDefined()

    // The referring paper page: wikilink renamed (alias preserved), related[] renamed.
    const paperFix = fixes.find((c) => c.path === "wiki/papers/p1.md")!
    expect(paperFix).toBeDefined()
    expect(paperFix.after).toContain("[[a5074790393|Lalor]]")
    expect(paperFix.after).not.toContain("edmund-c-lalor")
    const parsedPaper = parseDocument(paperFix.after!)
    expect(parsedPaper.frontmatter.related).toEqual(["a5074790393"])

    // The duplicate page itself: deleted (after: null), before matches disk.
    const deleteFix = fixes.find((c) => c.path === "wiki/authors/edmund-c-lalor.md")!
    expect(deleteFix).toBeDefined()
    expect(deleteFix.before).toBe(dupePage)
    expect(deleteFix.after).toBeNull()

    // The canonical page is untouched (no self-reference to rewrite).
    expect(fixes.find((c) => c.path === "wiki/authors/a5074790393.md")).toBeUndefined()
  })

  it("a related[] entry already pointing at the canonical slug is deduped after the rename, not duplicated", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    await s.write(
      "wiki/papers/p1.md",
      serializeDocument(fm("paper", "Some Paper", { related: ["a5074790393", "edmund-c-lalor"] }), "Body."),
    )
    const b = await loadBundle(s)

    const findings = findDuplicateAuthors(b)
    const paperFix = findings[0].fixes!.find((c) => c.path === "wiki/papers/p1.md")!
    const parsedPaper = parseDocument(paperFix.after!)
    expect(parsedPaper.frontmatter.related).toEqual(["a5074790393"])
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
  it("composes all five sub-checks, index-drift only when storedIndex is supplied", async () => {
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

  it("includes duplicate-author findings in the composed output", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor"), "Bio."))
    const b = await loadBundle(s)
    const kinds = runDeterministicChecks(b).map((f) => f.lintKind)
    expect(kinds).toContain("duplicate-author")
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

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
  // A `buildAuthorSkeletons`-shaped page: H1 + a `## Papers` bullet list, empty
  // tags/related/sources (matching wiki/authors/a5074790393.md in the real vault).
  const skeletonBody = (name: string, paperSlug = "some-paper") =>
    `# ${name}\n\n## Papers\n\n- [[${paperSlug}]]`

  // A rich LLM-authored author page: biography prose + `##` sections, no
  // `## Papers` section (matching wiki/authors/edmund-c-lalor.md in the real vault).
  const richBody = (name: string) =>
    `# ${name}\n\n${name} is a senior author on [[some-paper]], introducing the [[mtrf-toolbox]].\n\n` +
    `## Research contributions\n\nFormalized regularized regression approaches, applied to [[speech-eeg]].\n\n` +
    `## Collaborators\n\nCo-authored with several others.`

  it("flags an author with both an id-keyed and a name-keyed page (C6)", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), skeletonBody("Edmund C. Lalor")))
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["neuroscience"] }), richBody("Edmund C. Lalor")))
    await s.write("wiki/authors/a5035188059.md", serializeDocument(fm("author", "Adam Bednar"), skeletonBody("Adam Bednar")))
    const b = await loadBundle(s)

    const findings = runDeterministicChecks(b).filter((f) => f.lintKind === "duplicate-author")
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toContain("Edmund C. Lalor")
    expect(findings[0].pages).toEqual(["wiki/authors/a5074790393", "wiki/authors/edmund-c-lalor"])
    expect(findings[0].fixTarget).toBe("wiki/authors/edmund-c-lalor")
  })

  it("clean bundle: a lone id-keyed author page (no name-slug duplicate) is not flagged", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5035188059.md", serializeDocument(fm("author", "Adam Bednar"), skeletonBody("Adam Bednar")))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("a lone name-slug page with no id-keyed sibling is not flagged (nothing unambiguous to merge onto)", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor"), richBody("Edmund C. Lalor")))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("normalization collapses case and punctuation/whitespace differences", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), skeletonBody("Edmund C. Lalor")))
    // Same person, different casing/punctuation spacing on the duplicate's title.
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "edmund   c lalor"), richBody("Edmund C. Lalor")))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toHaveLength(1)
  })

  it("a group with two id-keyed pages sharing a normalized title is left unflagged (no unambiguous canonical)", async () => {
    const s = new MemoryVaultStorage()
    // Two distinct OpenAlex ids, same display name -- could be two different
    // real people; there's no safe merge target to guess.
    await s.write("wiki/authors/a1111.md", serializeDocument(fm("author", "J. Smith"), skeletonBody("J. Smith")))
    await s.write("wiki/authors/a2222.md", serializeDocument(fm("author", "J. Smith"), skeletonBody("J. Smith")))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  it("non-author pages sharing a normalized title are never considered", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Shared Title"), skeletonBody("Shared Title")))
    await s.write("wiki/concepts/shared-title.md", serializeDocument(fm("concept", "Shared Title"), "Not an author."))
    const b = await loadBundle(s)
    expect(findDuplicateAuthors(b)).toEqual([])
  })

  // --- Branch 1: extra is a trivial skeleton (canonical already covers it) ---
  it("branch 1 (extra trivial): deletes the skeleton duplicate, rewrites referrers, leaves canonical untouched", async () => {
    const s = new MemoryVaultStorage()
    // Canonical is the richer page here (has the paper + a tag); the extra is a
    // bare skeleton whose single Papers entry the canonical already lists.
    await s.write(
      "wiki/authors/a5074790393.md",
      serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["neuroscience"] }), skeletonBody("Edmund C. Lalor", "the-paper")),
    )
    const dupePage = serializeDocument(fm("author", "Edmund C. Lalor"), skeletonBody("Edmund C. Lalor", "the-paper"))
    await s.write("wiki/authors/edmund-c-lalor.md", dupePage)
    await s.write(
      "wiki/papers/p1.md",
      serializeDocument(fm("paper", "Some Paper", { related: ["edmund-c-lalor"] }), "By [[edmund-c-lalor|Lalor]]."),
    )
    const b = await loadBundle(s)

    const findings = findDuplicateAuthors(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].description).toContain("adds no content")
    const fixes = findings[0].fixes!
    expect(fixes).toBeDefined()

    // Referring paper: wikilink renamed (alias preserved), related[] renamed.
    const paperFix = fixes.find((c) => c.path === "wiki/papers/p1.md")!
    expect(paperFix.after).toContain("[[a5074790393|Lalor]]")
    expect(paperFix.after).not.toContain("edmund-c-lalor")
    expect(parseDocument(paperFix.after!).frontmatter.related).toEqual(["a5074790393"])

    // Duplicate deleted; canonical NOT in the change set (untouched).
    const deleteFix = fixes.find((c) => c.path === "wiki/authors/edmund-c-lalor.md")!
    expect(deleteFix.before).toBe(dupePage)
    expect(deleteFix.after).toBeNull()
    expect(fixes.find((c) => c.path === "wiki/authors/a5074790393.md")).toBeUndefined()
  })

  it("branch 1: a referring page's related[] already pointing at the canonical slug is deduped after the rename", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor"), skeletonBody("Edmund C. Lalor")))
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor"), skeletonBody("Edmund C. Lalor")))
    await s.write(
      "wiki/papers/p1.md",
      serializeDocument(fm("paper", "Some Paper", { related: ["a5074790393", "edmund-c-lalor"] }), "Body."),
    )
    const b = await loadBundle(s)

    const findings = findDuplicateAuthors(b)
    expect(findings[0].description).toContain("adds no content")
    const paperFix = findings[0].fixes!.find((c) => c.path === "wiki/papers/p1.md")!
    expect(parseDocument(paperFix.after!).frontmatter.related).toEqual(["a5074790393"])
  })

  // --- Branch 2: extra rich, canonical skeleton (the real Lalor case) ---
  it("branch 2 (canonical skeleton): folds the duplicate's biography + frontmatter into the canonical, then deletes the duplicate — nothing lost", async () => {
    const s = new MemoryVaultStorage()
    // Reconstruction of the real eeg-auditory-vault case: canonical is a bare
    // skeleton (empty frontmatter, `## Papers` only, has the openalex id); the
    // name-slug duplicate carries the full biography + rich frontmatter.
    const canonicalFm = fm("author", "Edmund C. Lalor", { openalex: "A5074790393", sources: [] })
    const canonicalBody = "# Edmund C. Lalor\n\n## Papers\n\n- [[10-3389-fnhum-2016-00604]]"
    await s.write("wiki/authors/a5074790393.md", serializeDocument(canonicalFm, canonicalBody))

    const richFm = fm("author", "Edmund C. Lalor", {
      tags: ["author", "neuroscience", "eeg"],
      related: ["mtrf-toolbox", "temporal-response-function-trf-estimation"],
      sources: ["doi:10.3389/fnhum.2016.00604"],
    })
    const richBodyText =
      "# Edmund C. Lalor\n\n" +
      "Edmund C. Lalor is a senior/corresponding author on [[10-3389-fnhum-2016-00604]], introducing the [[mtrf-toolbox]].\n\n" +
      "## Research contributions\n\n" +
      "Formalized regularized regression approaches for TRF estimation.\n\n" +
      "## Collaborators\n\n" +
      "Co-authored with Michael J. Crosse, Giovanni M. Di Liberto, and Adam Bednar."
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(richFm, richBodyText))
    const b = await loadBundle(s)

    const findings = findDuplicateAuthors(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].description).toContain("biography")
    const fixes = findings[0].fixes!

    // The canonical page is REWRITTEN (not just the extra deleted).
    const canonicalFix = fixes.find((c) => c.path === "wiki/authors/a5074790393.md")!
    expect(canonicalFix).toBeDefined()
    const parsed = parseDocument(canonicalFix.after!)

    // Biography prose survived, folded into the canonical.
    expect(parsed.body).toContain("senior/corresponding author")
    expect(parsed.body).toContain("## Research contributions")
    expect(parsed.body).toContain("## Collaborators")
    // The canonical skeleton's Papers entry is preserved (appended as a section).
    expect(parsed.body).toContain("## Papers")
    expect(parsed.body).toContain("- [[10-3389-fnhum-2016-00604]]")

    // Frontmatter: unioned lists, canonical's openalex id + title/created kept.
    expect(parsed.frontmatter.openalex).toBe("A5074790393")
    expect(parsed.frontmatter.title).toBe("Edmund C. Lalor")
    expect(parsed.frontmatter.tags).toEqual(["author", "neuroscience", "eeg"])
    expect(parsed.frontmatter.related).toEqual(["mtrf-toolbox", "temporal-response-function-trf-estimation"])
    expect(parsed.frontmatter.sources).toEqual(["doi:10.3389/fnhum.2016.00604"])

    // The duplicate page is still deleted.
    const deleteFix = fixes.find((c) => c.path === "wiki/authors/edmund-c-lalor.md")!
    expect(deleteFix.after).toBeNull()
  })

  it("branch 2: merges the canonical's Papers list INTO the duplicate's existing Papers section, deduping shared entries", async () => {
    const s = new MemoryVaultStorage()
    const canonicalBody = "# X Author\n\n## Papers\n\n- [[paper-a]]\n- [[paper-shared]]"
    await s.write("wiki/authors/a999.md", serializeDocument(fm("author", "X Author", { sources: [] }), canonicalBody))
    const richBodyText =
      "# X Author\n\nX Author studies things.\n\n" +
      "## Papers\n\n- [[paper-shared]]\n- [[paper-b]]"
    await s.write("wiki/authors/x-author.md", serializeDocument(fm("author", "X Author", { tags: ["t"] }), richBodyText))
    const b = await loadBundle(s)

    const canonicalFix = findDuplicateAuthors(b)[0].fixes!.find((c) => c.path === "wiki/authors/a999.md")!
    const body = parseDocument(canonicalFix.after!).body
    // The extra's own entries come first, then the canonical's unique one; the
    // shared entry appears exactly once.
    expect(body).toContain("- [[paper-shared]]")
    expect(body).toContain("- [[paper-b]]")
    expect(body).toContain("- [[paper-a]]")
    expect((body.match(/\[\[paper-shared\]\]/g) ?? []).length).toBe(1)
  })

  it("branch 2: renames an extra→canonical self-reference inside the duplicate's own body before it becomes the canonical body", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a999.md", serializeDocument(fm("author", "X Author", { sources: [] }), "# X Author\n\n## Papers\n\n- [[paper-a]]"))
    // The rich duplicate body references its OWN name slug — after the merge it
    // must point at the canonical id slug, not the (deleted) name slug.
    const richBodyText = "# X Author\n\nSee [[x-author|my page]] and [[paper-a]].\n\n## Notes\n\nMore."
    await s.write("wiki/authors/x-author.md", serializeDocument(fm("author", "X Author"), richBodyText))
    const b = await loadBundle(s)

    const canonicalFix = findDuplicateAuthors(b)[0].fixes!.find((c) => c.path === "wiki/authors/a999.md")!
    const body = parseDocument(canonicalFix.after!).body
    expect(body).toContain("[[a999|my page]]")
    expect(body).not.toContain("x-author")
  })

  // --- Branch 3: both pages substantive -> advisory, no auto-fix ---
  it("branch 3 (both rich): emits an advisory finding with NO fix/fixes and a merge-by-hand description", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/authors/a5074790393.md", serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["neuroscience"] }), richBody("Edmund C. Lalor")))
    await s.write("wiki/authors/edmund-c-lalor.md", serializeDocument(fm("author", "Edmund C. Lalor", { tags: ["eeg"] }), richBody("Edmund C. Lalor")))
    const b = await loadBundle(s)

    const findings = findDuplicateAuthors(b)
    expect(findings).toHaveLength(1)
    expect(findings[0].fixes).toBeUndefined()
    expect(findings[0].fix).toBeUndefined()
    expect(findings[0].description).toContain("by hand")
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

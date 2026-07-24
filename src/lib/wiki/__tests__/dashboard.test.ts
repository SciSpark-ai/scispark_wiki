import { describe, it, expect } from "vitest"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
import { deriveWikiDashboard } from "../dashboard"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

function bundleFromPages(
  entries: Array<{ id: string; frontmatter: Frontmatter; body?: string }>,
): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, {
      id: e.id,
      path: `${e.id}.md`,
      frontmatter: e.frontmatter,
      body: e.body ?? "",
    })
  }
  return { pages, links: [], errors: [] }
}

describe("deriveWikiDashboard — paper shelf stats", () => {
  it("counts papers per status, treating missing/unrecognized status as saved", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/a", frontmatter: fm("paper", "A", { updated: "2026-07-01" }) }, // missing status
      {
        id: "wiki/papers/b",
        frontmatter: fm("paper", "B", { updated: "2026-07-02", status: "weird-unknown-status" }),
      },
      { id: "wiki/papers/c", frontmatter: fm("paper", "C", { updated: "2026-07-03", status: "saved" }) },
      { id: "wiki/papers/d", frontmatter: fm("paper", "D", { updated: "2026-07-04", status: "enriched" }) },
      { id: "wiki/papers/e", frontmatter: fm("paper", "E", { updated: "2026-07-05", status: "ingested" }) },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.stats.papers).toEqual({ saved: 3, enriched: 1, ingested: 1, total: 5 })
    expect(dashboard.shelves.saved.map((s) => s.id).sort()).toEqual(["wiki/papers/a", "wiki/papers/b", "wiki/papers/c"])
    expect(dashboard.shelves.enriched.map((s) => s.id)).toEqual(["wiki/papers/d"])
    expect(dashboard.shelves.ingested.map((s) => s.id)).toEqual(["wiki/papers/e"])
  })

  it("sums the knowledge stat across concept+method+finding+comparison+topic only", () => {
    const bundle = bundleFromPages([
      { id: "wiki/concepts/a", frontmatter: fm("concept", "A") },
      { id: "wiki/methods/b", frontmatter: fm("method", "B") },
      { id: "wiki/findings/c", frontmatter: fm("finding", "C") },
      { id: "wiki/comparisons/d", frontmatter: fm("comparison", "D") },
      { id: "wiki/topics/e", frontmatter: fm("topic", "E") },
      { id: "wiki/ideas/f", frontmatter: fm("idea", "F") },
      { id: "wiki/notes/g", frontmatter: fm("note", "G") },
      { id: "wiki/authors/h", frontmatter: fm("author", "H") },
      { id: "wiki/papers/i", frontmatter: fm("paper", "I") },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.stats.knowledge).toBe(5)
    expect(dashboard.stats.ideas).toBe(1)
    expect(dashboard.stats.notes).toBe(1)
  })
})

describe("deriveWikiDashboard — shelf sorting, cap, tie-break", () => {
  it("sorts shelf entries by updated desc, tie-breaks by id asc, and caps at shelfLimit", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/z", frontmatter: fm("paper", "Z", { updated: "2026-07-01", status: "saved" }) },
      { id: "wiki/papers/a", frontmatter: fm("paper", "A", { updated: "2026-07-05", status: "saved" }) },
      { id: "wiki/papers/m1", frontmatter: fm("paper", "M1", { updated: "2026-07-03", status: "saved" }) },
      { id: "wiki/papers/m2", frontmatter: fm("paper", "M2", { updated: "2026-07-03", status: "saved" }) },
    ])
    const dashboard = deriveWikiDashboard(bundle, { shelfLimit: 3 })
    expect(dashboard.shelves.saved.map((s) => s.id)).toEqual([
      "wiki/papers/a", // 07-05
      "wiki/papers/m1", // 07-03, tie-break id asc before m2
      "wiki/papers/m2", // 07-03
      // wiki/papers/z (07-01) capped out
    ])
    expect(dashboard.shelves.saved).toHaveLength(3)
  })

  it("defaults shelfLimit to 12", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `wiki/papers/p${String(i).padStart(2, "0")}`,
      frontmatter: fm("paper", `P${i}`, { updated: `2026-07-${String(i + 1).padStart(2, "0")}`, status: "saved" }),
    }))
    const bundle = bundleFromPages(entries)
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved).toHaveLength(12)
  })

  it("shelfLimit: Infinity returns the full uncapped list", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `wiki/papers/p${String(i).padStart(2, "0")}`,
      frontmatter: fm("paper", `P${i}`, { updated: `2026-07-${String(i + 1).padStart(2, "0")}`, status: "saved" }),
    }))
    const bundle = bundleFromPages(entries)
    const dashboard = deriveWikiDashboard(bundle, { shelfLimit: Infinity })
    expect(dashboard.shelves.saved).toHaveLength(15)
  })
})

describe("deriveWikiDashboard — shelf entry fields", () => {
  it("derives slug from the last id segment and carries tags/title through", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/papers/arxiv-2409-08710",
        frontmatter: fm("paper", "Some Paper Title", { status: "saved", tags: ["nlp", "rag"] }),
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    const entry = dashboard.shelves.saved[0]
    expect(entry.id).toBe("wiki/papers/arxiv-2409-08710")
    expect(entry.slug).toBe("arxiv-2409-08710")
    expect(entry.title).toBe("Some Paper Title")
    expect(entry.tags).toEqual(["nlp", "rag"])
    expect(entry.status).toBe("saved")
  })

  it("tldr comes from frontmatter.tldr when present", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/papers/a",
        frontmatter: fm("paper", "A", { status: "saved", tldr: "A concise summary." }),
        body: "# Heading\n\nSome body text that should be ignored.",
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved[0].tldr).toBe("A concise summary.")
  })

  it("tldr from frontmatter is trimmed", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/papers/a",
        frontmatter: fm("paper", "A", { status: "saved", tldr: "  padded summary  " }),
        body: "",
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved[0].tldr).toBe("padded summary")
  })

  it("tldr body fallback strips wikilink markup down to visible text", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/papers/a",
        frontmatter: fm("paper", "A", { status: "saved" }),
        body: "This paper introduces the [[mtrf-toolbox]] via [[trf-estimation|TRF estimation]].",
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved[0].tldr).toBe("This paper introduces the mtrf-toolbox via TRF estimation.")
  })

  it("tldr falls back to the first non-empty, non-heading body line", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/papers/a",
        frontmatter: fm("paper", "A", { status: "saved" }),
        body: "# Heading\n\n   \nThis is the first real line.\nSecond line.",
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved[0].tldr).toBe("This is the first real line.")
  })

  it("tldr is null when the body is only headings/blank lines", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/papers/a",
        frontmatter: fm("paper", "A", { status: "saved" }),
        body: "# Heading\n\n## Subheading\n\n   \n",
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved[0].tldr).toBeNull()
  })

  it("tldr is null when the body is empty", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/a", frontmatter: fm("paper", "A", { status: "saved" }), body: "" },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.shelves.saved[0].tldr).toBeNull()
  })
})

describe("deriveWikiDashboard — sections", () => {
  it("emits sections in fixed order with correct labels, omitting empty ones", () => {
    const bundle = bundleFromPages([
      { id: "wiki/concepts/a", frontmatter: fm("concept", "A") },
      { id: "wiki/ideas/b", frontmatter: fm("idea", "B") },
      { id: "wiki/authors/c", frontmatter: fm("author", "C") },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.sections.map((s) => s.type)).toEqual(["concept", "idea", "author"])
    expect(dashboard.sections.map((s) => s.label)).toEqual(["Concepts", "Ideas", "Authors"])
  })

  it("uses the full fixed order when every type is present", () => {
    const bundle = bundleFromPages([
      { id: "wiki/concepts/a", frontmatter: fm("concept", "A") },
      { id: "wiki/methods/b", frontmatter: fm("method", "B") },
      { id: "wiki/findings/c", frontmatter: fm("finding", "C") },
      { id: "wiki/comparisons/d", frontmatter: fm("comparison", "D") },
      { id: "wiki/topics/e", frontmatter: fm("topic", "E") },
      { id: "wiki/ideas/f", frontmatter: fm("idea", "F") },
      { id: "wiki/notes/g", frontmatter: fm("note", "G") },
      { id: "wiki/authors/h", frontmatter: fm("author", "H") },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.sections.map((s) => s.type)).toEqual([
      "concept", "method", "finding", "comparison", "topic", "idea", "note", "author",
    ])
  })

  it("total is uncapped even though entries are capped at sectionLimit", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `wiki/concepts/c${i}`,
      frontmatter: fm("concept", `C${i}`, { updated: `2026-07-${String(i + 1).padStart(2, "0")}` }),
    }))
    const bundle = bundleFromPages(entries)
    const dashboard = deriveWikiDashboard(bundle, { sectionLimit: 3 })
    const conceptSection = dashboard.sections.find((s) => s.type === "concept")!
    expect(conceptSection.total).toBe(8)
    expect(conceptSection.entries).toHaveLength(3)
  })

  it("defaults sectionLimit to 6", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `wiki/concepts/c${i}`,
      frontmatter: fm("concept", `C${i}`, { updated: `2026-07-${String(i + 1).padStart(2, "0")}` }),
    }))
    const bundle = bundleFromPages(entries)
    const dashboard = deriveWikiDashboard(bundle)
    const conceptSection = dashboard.sections.find((s) => s.type === "concept")!
    expect(conceptSection.entries).toHaveLength(6)
  })

  it("sorts section entries by updated desc, tie-break id asc", () => {
    const bundle = bundleFromPages([
      { id: "wiki/concepts/z", frontmatter: fm("concept", "Z", { updated: "2026-07-01" }) },
      { id: "wiki/concepts/a", frontmatter: fm("concept", "A", { updated: "2026-07-05" }) },
      { id: "wiki/concepts/m", frontmatter: fm("concept", "M", { updated: "2026-07-05" }) },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    const conceptSection = dashboard.sections.find((s) => s.type === "concept")!
    expect(conceptSection.entries.map((e) => e.id)).toEqual([
      "wiki/concepts/a",
      "wiki/concepts/m",
      "wiki/concepts/z",
    ])
  })

  it("idea section entries carry status/depth from frontmatter", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/ideas/sketch-verify",
        frontmatter: fm("idea", "Sketch and Verify", { status: "sparked", depth: "deep" }),
      },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    const ideaSection = dashboard.sections.find((s) => s.type === "idea")!
    expect(ideaSection.entries[0]).toMatchObject({
      id: "wiki/ideas/sketch-verify",
      status: "sparked",
      depth: "deep",
    })
  })

  it("omits status/depth keys entirely when frontmatter doesn't have them", () => {
    const bundle = bundleFromPages([{ id: "wiki/concepts/a", frontmatter: fm("concept", "A") }])
    const dashboard = deriveWikiDashboard(bundle)
    const conceptSection = dashboard.sections.find((s) => s.type === "concept")!
    expect(conceptSection.entries[0].status).toBeUndefined()
    expect(conceptSection.entries[0].depth).toBeUndefined()
  })

  it("papers never appear in sections", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/a", frontmatter: fm("paper", "A", { status: "saved" }) },
    ])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.sections.find((s) => s.type === "paper")).toBeUndefined()
  })
})

describe("deriveWikiDashboard — recent", () => {
  it("covers all pages across all types, sorted by updated desc then id asc, capped at recentLimit", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/a", frontmatter: fm("paper", "PaperA", { updated: "2026-07-10", status: "saved" }) },
      { id: "wiki/concepts/b", frontmatter: fm("concept", "ConceptB", { updated: "2026-07-12" }) },
      { id: "wiki/notes/c", frontmatter: fm("note", "NoteC", { updated: "2026-07-12" }) },
      { id: "wiki/ideas/d", frontmatter: fm("idea", "IdeaD", { updated: "2026-07-11" }) },
    ])
    const dashboard = deriveWikiDashboard(bundle, { recentLimit: 3 })
    expect(dashboard.recent.map((r) => r.id)).toEqual([
      "wiki/concepts/b", // 07-12, tie-break id asc before c
      "wiki/notes/c", // 07-12
      "wiki/ideas/d", // 07-11
      // wiki/papers/a (07-10) capped out
    ])
    expect(dashboard.recent[0]).toEqual({
      id: "wiki/concepts/b",
      title: "ConceptB",
      type: "concept",
      updated: "2026-07-12",
    })
  })

  it("defaults recentLimit to 10", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      id: `wiki/notes/n${String(i).padStart(2, "0")}`,
      frontmatter: fm("note", `N${i}`, { updated: `2026-07-${String(i + 1).padStart(2, "0")}` }),
    }))
    const bundle = bundleFromPages(entries)
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.recent).toHaveLength(10)
  })
})

describe("deriveWikiDashboard — empty bundle", () => {
  it("handles an empty bundle without crashing", () => {
    const bundle = bundleFromPages([])
    const dashboard = deriveWikiDashboard(bundle)
    expect(dashboard.stats).toEqual({
      papers: { saved: 0, enriched: 0, ingested: 0, total: 0 },
      knowledge: 0,
      ideas: 0,
      notes: 0,
    })
    expect(dashboard.shelves).toEqual({ saved: [], enriched: [], ingested: [] })
    expect(dashboard.sections).toEqual([])
    expect(dashboard.recent).toEqual([])
  })
})

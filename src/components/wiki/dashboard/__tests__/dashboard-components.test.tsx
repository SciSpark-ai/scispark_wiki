// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { DashboardSection, RecentEntry, ShelfEntry, WikiStats } from "@/lib/wiki/dashboard"
import { StatsStrip } from "../StatsStrip"
import { Shelf } from "../Shelf"
import { TypeSections } from "../TypeSections"
import { RecentStrip } from "../RecentStrip"

const STATS: WikiStats = {
  papers: { saved: 2, enriched: 1, ingested: 3, total: 6 },
  knowledge: 9,
  ideas: 4,
  notes: 5,
}

function shelfEntry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    id: "wiki/papers/ear-eeg-2409-08710",
    slug: "ear-eeg-2409-08710",
    title: "Ear-EEG for <i>Auditory</i> Attention Decoding",
    tags: ["ear-eeg", "attention", "wearables", "extra-tag"],
    status: "enriched",
    tldr: "A very long two-line description of the paper that should be clamped to two lines in the shelf card layout regardless of its actual length here.",
    updated: "2026-07-20",
    ...overrides,
  }
}

describe("StatsStrip", () => {
  it("renders all stat numbers and an inbox card linking to /wiki/inbox", () => {
    const html = renderToStaticMarkup(<StatsStrip stats={STATS} inboxCount={7} />)
    // papers total, knowledge, ideas, notes, inbox count
    expect(html).toContain(">6<")
    expect(html).toContain(">9<")
    expect(html).toContain(">4<")
    expect(html).toContain(">5<")
    expect(html).toContain(">7<")
    expect(html).toMatch(/<a[^>]+href="\/wiki\/inbox"/)
  })
})

describe("Shelf", () => {
  it("renders a card with clamped tldr, /paper/<slug> href, and a status badge", () => {
    const entry = shelfEntry()
    const html = renderToStaticMarkup(
      <Shelf label="Saved" entries={[entry]} total={1} onViewAll={() => {}} />,
    )
    expect(html).toContain('href="/paper/ear-eeg-2409-08710"')
    // displayTitle strips markup
    expect(html).toContain("Ear-EEG for Auditory Attention Decoding")
    expect(html).not.toContain("<i>Auditory</i>")
    expect(html).toContain("line-clamp-2")
    expect(html).toContain(entry.tldr!)
    expect(html).toContain("enriched")
    // at most 3 tag chips even though the entry carries 4
    expect(html).toContain("ear-eeg")
    expect(html).toContain("attention")
    expect(html).toContain("wearables")
    expect(html).not.toContain("extra-tag")
  })

  it("shows a trailing View all button when total exceeds the shown entries", () => {
    const html = renderToStaticMarkup(
      <Shelf label="Saved" entries={[shelfEntry()]} total={5} onViewAll={() => {}} />,
    )
    expect(html).toContain("View all (5)")
  })

  it("omits the View all button when every entry is already shown", () => {
    const html = renderToStaticMarkup(
      <Shelf label="Saved" entries={[shelfEntry()]} total={1} onViewAll={() => {}} />,
    )
    expect(html).not.toContain("View all")
  })

  it("renders nothing when entries is empty", () => {
    const html = renderToStaticMarkup(
      <Shelf label="Saved" entries={[]} total={0} onViewAll={() => {}} />,
    )
    expect(html).toBe("")
  })
})

describe("TypeSections", () => {
  const sections: DashboardSection[] = [
    {
      type: "concept",
      label: "Concepts",
      total: 2,
      entries: [
        { id: "wiki/concepts/attention", title: "Attention Mechanism", updated: "2026-07-20" },
      ],
    },
    {
      type: "idea",
      label: "Ideas",
      total: 1,
      entries: [
        {
          id: "wiki/ideas/sketch-and-verify",
          title: "Sketch-and-Verify KV Cache",
          updated: "2026-07-19",
          status: "sparked",
          depth: "deep",
        },
      ],
    },
  ]

  it("renders idea status/depth badges but not for non-idea sections", () => {
    const html = renderToStaticMarkup(<TypeSections sections={sections} />)
    expect(html).toContain("sparked")
    expect(html).toContain("deep")
    expect(html).toMatch(/href="\/wiki\/concepts\/attention"/)
    expect(html).toMatch(/href="\/wiki\/ideas\/sketch-and-verify"/)
  })

  it("links to the browse-all view", () => {
    const html = renderToStaticMarkup(<TypeSections sections={sections} />)
    expect(html).toMatch(/href="\/wiki\?view=all"/)
  })

  it("renders nothing for an empty section list", () => {
    const html = renderToStaticMarkup(<TypeSections sections={[]} />)
    expect(html).toBe("")
  })
})

describe("RecentStrip", () => {
  const recent: RecentEntry[] = [
    { id: "wiki/papers/ear-eeg-2409-08710", title: "Ear-EEG Paper", type: "paper", updated: "2026-07-20" },
    { id: "wiki/concepts/attention", title: "Attention Mechanism", type: "concept", updated: "2026-07-19" },
  ]

  it("links paper rows to /paper/<slug> and non-paper rows via wikiHref", () => {
    const html = renderToStaticMarkup(<RecentStrip recent={recent} />)
    expect(html).toMatch(/href="\/paper\/ear-eeg-2409-08710"/)
    expect(html).toMatch(/href="\/wiki\/concepts\/attention"/)
  })

  it("labels each row as an update, with no dev-language (no changeset ids/skill names)", () => {
    const html = renderToStaticMarkup(<RecentStrip recent={recent} />)
    expect(html).toContain("Updated Ear-EEG Paper")
    expect(html).toContain("Updated Attention Mechanism")
    expect(html).not.toMatch(/changeset/i)
    expect(html).not.toMatch(/skill/i)
  })

  it("renders nothing for an empty recent list", () => {
    const html = renderToStaticMarkup(<RecentStrip recent={[]} />)
    expect(html).toBe("")
  })
})

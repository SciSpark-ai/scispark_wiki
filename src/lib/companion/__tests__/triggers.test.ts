import { describe, it, expect } from "vitest"
import { evaluateTriggers, type TriggerState } from "../triggers"
import type { LoggedEvent } from "../../events/types"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"

const NOW_ISO = "2026-07-13T12:00:00.000Z"
const NOW_MS = Date.parse(NOW_ISO)

function fm(type: string, title: string, related: string[] = []): Frontmatter {
  return {
    type,
    title,
    created: "2026-07-01",
    updated: "2026-07-01",
    tags: [],
    related,
    sources: ["s"],
  }
}

function page(id: string, type: string, title: string, related: string[] = []): WikiPage {
  return { id, path: `${id}.md`, frontmatter: fm(type, title, related), body: "" }
}

function bundleOf(pages: WikiPage[], links: Array<{ from: string; to: string }> = []): Bundle {
  return { pages: new Map(pages.map((p) => [p.id, p])), links, errors: [] }
}

function ingestEvent(tsOffsetMs: number, title: string): LoggedEvent {
  return {
    type: "ingest",
    paperKey: title,
    title,
    changesetId: `cs-${title}`,
    ts: new Date(NOW_MS + tsOffsetMs).toISOString(),
  }
}

const baseState: TriggerState = {
  route: "/papers",
  hasFeedCache: false,
  recentEvents: [],
  reviewCount: 0,
  bundle: null,
  lastShownTs: {},
  nowMs: NOW_MS,
}

describe("app-open trigger", () => {
  it("fires on route \"/\" with a feed cache", () => {
    const fired = evaluateTriggers({ ...baseState, route: "/", hasFeedCache: true })
    expect(fired?.id).toBe("app-open")
    expect(fired?.action).toEqual({ label: "Home", href: "/" })
    expect(fired?.priority).toBeGreaterThan(0)
  })

  it("does not fire off-route", () => {
    expect(evaluateTriggers({ ...baseState, route: "/papers", hasFeedCache: true })).toBeNull()
  })

  it("does not fire without a feed cache", () => {
    expect(evaluateTriggers({ ...baseState, route: "/", hasFeedCache: false })).toBeNull()
  })
})

describe("post-ingest trigger", () => {
  it("fires for an ingest event within the last ~2 minutes", () => {
    const state = { ...baseState, recentEvents: [ingestEvent(-30_000, "Attention Is All You Need")] }
    const fired = evaluateTriggers(state)
    expect(fired?.id).toBe("post-ingest")
    expect(fired?.action).toEqual({ label: "View wiki", href: "/wiki" })
    expect(fired?.contextBlurb).toContain("Attention Is All You Need")
  })

  it("fires exactly at the 2-minute boundary", () => {
    const state = { ...baseState, recentEvents: [ingestEvent(-120_000, "Boundary Paper")] }
    expect(evaluateTriggers(state)?.id).toBe("post-ingest")
  })

  it("does not fire for an ingest event older than ~2 minutes", () => {
    const state = { ...baseState, recentEvents: [ingestEvent(-121_000, "Old Paper")] }
    expect(evaluateTriggers(state)).toBeNull()
  })

  it("does not fire when there are no ingest events", () => {
    const state = { ...baseState, recentEvents: [{ type: "search", source: "arxiv", query: "x", ts: NOW_ISO } as LoggedEvent] }
    expect(evaluateTriggers(state)).toBeNull()
  })

  it("ignores a future-timestamped event rather than firing on it", () => {
    const state = { ...baseState, recentEvents: [ingestEvent(30_000, "Future Paper")] }
    expect(evaluateTriggers(state)).toBeNull()
  })
})

describe("review-pending trigger", () => {
  it("fires when reviewCount > 0", () => {
    const fired = evaluateTriggers({ ...baseState, reviewCount: 3 })
    expect(fired?.id).toBe("review-pending")
    expect(fired?.action).toEqual({ label: "Review inbox", href: "/wiki/inbox" })
    expect(fired?.contextBlurb).toContain("3")
  })

  it("does not fire when reviewCount is 0", () => {
    expect(evaluateTriggers({ ...baseState, reviewCount: 0 })).toBeNull()
  })
})

describe("sparkable-cluster trigger", () => {
  const conceptPage = page("wiki/concepts/attention", "concept", "Attention Mechanisms")
  const paperA = page("wiki/papers/paper-a", "paper", "Paper A", ["attention"])
  const paperB = page("wiki/papers/paper-b", "paper", "Paper B", ["attention"])
  const paperC = page("wiki/papers/paper-c", "paper", "Paper C", ["attention"])
  // Offsets are outside the post-ingest ~2min window so these fixtures isolate
  // the cluster trigger from post-ingest (which would otherwise win on priority).
  const threeIngests = [
    ingestEvent(-10 * 60_000, "Paper A"),
    ingestEvent(-9 * 60_000, "Paper B"),
    ingestEvent(-8 * 60_000, "Paper C"),
  ]

  it("fires for 3 recently-ingested papers sharing a concept, with no idea page yet", () => {
    const bundle = bundleOf([conceptPage, paperA, paperB, paperC])
    const fired = evaluateTriggers({ ...baseState, recentEvents: threeIngests, bundle })
    expect(fired?.id).toBe("sparkable-cluster")
    expect(fired?.action).toEqual({
      label: "Spark an idea",
      href: `/spark?cluster=${encodeURIComponent("wiki/papers/paper-a,wiki/papers/paper-b,wiki/papers/paper-c")}`,
    })
    expect(fired?.contextBlurb).toContain("Attention Mechanisms")
  })

  it("also detects sharing via body wikilinks recorded in bundle.links (not just related[])", () => {
    const bareA = page("wiki/papers/paper-a", "paper", "Paper A")
    const bareB = page("wiki/papers/paper-b", "paper", "Paper B")
    const bareC = page("wiki/papers/paper-c", "paper", "Paper C")
    const links = [
      { from: bareA.id, to: conceptPage.id },
      { from: bareB.id, to: conceptPage.id },
      { from: bareC.id, to: conceptPage.id },
    ]
    const bundle = bundleOf([conceptPage, bareA, bareB, bareC], links)
    const fired = evaluateTriggers({ ...baseState, recentEvents: threeIngests, bundle })
    expect(fired?.id).toBe("sparkable-cluster")
  })

  it("does not fire when an idea page already links the shared concept", () => {
    const ideaPage = page("wiki/ideas/spark-1", "idea", "Spark 1", ["attention"])
    const bundle = bundleOf([conceptPage, paperA, paperB, paperC, ideaPage])
    expect(evaluateTriggers({ ...baseState, recentEvents: threeIngests, bundle })).toBeNull()
  })

  it("does not fire with fewer than 3 distinct recently-ingested papers", () => {
    const bundle = bundleOf([conceptPage, paperA, paperB])
    const twoIngests = [ingestEvent(-10 * 60_000, "Paper A"), ingestEvent(-9 * 60_000, "Paper B")]
    expect(evaluateTriggers({ ...baseState, recentEvents: twoIngests, bundle })).toBeNull()
  })

  it("does not fire when the same paper is re-ingested (only 1 distinct title, repeated)", () => {
    const bundle = bundleOf([conceptPage, paperA])
    const repeated = [
      ingestEvent(-10 * 60_000, "Paper A"),
      ingestEvent(-9 * 60_000, "Paper A"),
      ingestEvent(-8 * 60_000, "Paper A"),
    ]
    expect(evaluateTriggers({ ...baseState, recentEvents: repeated, bundle })).toBeNull()
  })

  it("does not fire, and does not crash, when the bundle is null", () => {
    expect(evaluateTriggers({ ...baseState, recentEvents: threeIngests, bundle: null })).toBeNull()
  })

  it("does not fire, and does not crash, on an empty bundle", () => {
    const bundle = bundleOf([])
    expect(evaluateTriggers({ ...baseState, recentEvents: threeIngests, bundle })).toBeNull()
  })
})

describe("cooldowns", () => {
  it("suppresses a trigger whose lastShownTs is within cooldownMs", () => {
    const state: TriggerState = {
      ...baseState,
      reviewCount: 2,
      lastShownTs: { "review-pending": new Date(NOW_MS - 5 * 60 * 1000).toISOString() }, // 5min ago, cooldown 10min
    }
    expect(evaluateTriggers(state)).toBeNull()
  })

  it("is eligible again once cooldownMs has fully elapsed (boundary inclusive)", () => {
    const state: TriggerState = {
      ...baseState,
      reviewCount: 2,
      lastShownTs: { "review-pending": new Date(NOW_MS - 10 * 60 * 1000).toISOString() }, // exactly 10min ago
    }
    expect(evaluateTriggers(state)?.id).toBe("review-pending")
  })

  it("a trigger never shown before (no lastShownTs entry) is eligible", () => {
    const state: TriggerState = { ...baseState, reviewCount: 2, lastShownTs: {} }
    expect(evaluateTriggers(state)?.id).toBe("review-pending")
  })

  it("each trigger's cooldown is tracked independently by id", () => {
    const state: TriggerState = {
      ...baseState,
      route: "/",
      hasFeedCache: true,
      reviewCount: 2,
      // app-open on cooldown, review-pending is not -> review-pending should still fire
      lastShownTs: { "app-open": new Date(NOW_MS - 1000).toISOString() },
    }
    expect(evaluateTriggers(state)?.id).toBe("review-pending")
  })
})

describe("priority ordering when multiple triggers are eligible", () => {
  it("post-ingest (high) beats review-pending (medium) and app-open (low)", () => {
    const state: TriggerState = {
      ...baseState,
      route: "/",
      hasFeedCache: true,
      reviewCount: 2,
      recentEvents: [ingestEvent(-30_000, "Paper A")],
    }
    expect(evaluateTriggers(state)?.id).toBe("post-ingest")
  })

  it("review-pending (medium) beats app-open (low)", () => {
    const state: TriggerState = { ...baseState, route: "/", hasFeedCache: true, reviewCount: 2 }
    expect(evaluateTriggers(state)?.id).toBe("review-pending")
  })

  it("returns null when nothing is eligible", () => {
    expect(evaluateTriggers(baseState)).toBeNull()
  })
})

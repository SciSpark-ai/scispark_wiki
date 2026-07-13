import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import type { Frontmatter } from "../../vault/types"
import { deriveTimeline, UNFILED_LANE_ID } from "../timeline"

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

async function bundleFrom(files: Record<string, [Frontmatter, string]>) {
  const storage = new MemoryVaultStorage()
  for (const [path, [frontmatter, body]] of Object.entries(files)) {
    await storage.write(path, serializeDocument(frontmatter, body))
  }
  return loadBundle(storage)
}

function itemById(timeline: ReturnType<typeof deriveTimeline>, id: string) {
  return timeline.items.find((i) => i.id === id)
}

describe("deriveTimeline — dates and years", () => {
  it("paper with frontmatter.year=2024 -> date 2024-01-01, year 2024", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "no links"],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/papers/p1")!
    expect(item.type).toBe("paper")
    expect(item.date).toBe("2024-01-01")
    expect(item.year).toBe(2024)
  })

  it("paper without frontmatter.year falls back to created", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p2.md": [fm("paper", "P2", { created: "2023-05-02" }), "no links"],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/papers/p2")!
    expect(item.date).toBe("2023-05-02")
    expect(item.year).toBe(2023)
  })

  it("finding uses created as date/year", async () => {
    const bundle = await bundleFrom({
      "wiki/findings/f1.md": [fm("finding", "F1", { created: "2026-01-05" }), "no links"],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/findings/f1")!
    expect(item.type).toBe("finding")
    expect(item.date).toBe("2026-01-05")
    expect(item.year).toBe(2026)
  })

  it("minYear/maxYear span all items", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "no links"],
      "wiki/findings/f1.md": [fm("finding", "F1", { created: "2026-01-05" }), "no links"],
    })
    const timeline = deriveTimeline(bundle)
    expect(timeline.minYear).toBe(2024)
    expect(timeline.maxYear).toBe(2026)
  })
})

describe("deriveTimeline — topic lanes", () => {
  it("item wikilinking a topic lands in that topic's lane", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "See [[topics/t1]]."],
      "wiki/topics/t1.md": [fm("topic", "T1"), "leaf"],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/papers/p1")!
    expect(item.laneIds).toEqual(["wiki/topics/t1"])
  })

  it("topic wikilinking the item (reverse direction) also lanes it", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "no links"],
      "wiki/topics/t1.md": [fm("topic", "T1"), "Covers [[papers/p1]]."],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/papers/p1")!
    expect(item.laneIds).toEqual(["wiki/topics/t1"])
  })

  it("item linked to two topics lands in both lanes", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [
        fm("paper", "P1", { year: 2024 }),
        "See [[topics/t1]] and [[topics/t2]].",
      ],
      "wiki/topics/t1.md": [fm("topic", "T1"), "leaf"],
      "wiki/topics/t2.md": [fm("topic", "T2"), "leaf"],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/papers/p1")!
    expect(item.laneIds.sort()).toEqual(["wiki/topics/t1", "wiki/topics/t2"])
  })

  it("item with no topic link lands in the synthetic Unfiled lane", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "no links"],
      "wiki/topics/t1.md": [fm("topic", "T1"), "leaf"],
    })
    const timeline = deriveTimeline(bundle)
    const item = itemById(timeline, "wiki/papers/p1")!
    expect(item.laneIds).toEqual([UNFILED_LANE_ID])
    const unfiledLane = timeline.lanes.find((l) => l.id === UNFILED_LANE_ID)
    expect(unfiledLane).toEqual({ id: UNFILED_LANE_ID, title: "Unfiled", itemCount: 1 })
  })

  it("lanes are sorted by itemCount desc", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "[[topics/small]]"],
      "wiki/papers/p2.md": [fm("paper", "P2", { year: 2024 }), "[[topics/big]]"],
      "wiki/papers/p3.md": [fm("paper", "P3", { year: 2024 }), "[[topics/big]]"],
      "wiki/topics/small.md": [fm("topic", "Small"), "leaf"],
      "wiki/topics/big.md": [fm("topic", "Big"), "leaf"],
    })
    const timeline = deriveTimeline(bundle)
    expect(timeline.lanes.map((l) => l.id)).toEqual(["wiki/topics/big", "wiki/topics/small"])
    expect(timeline.lanes[0].itemCount).toBe(2)
    expect(timeline.lanes[1].itemCount).toBe(1)
  })
})

describe("deriveTimeline — empty bundle", () => {
  it("returns empty lanes/items and 0/0 years", async () => {
    const bundle = await bundleFrom({})
    const timeline = deriveTimeline(bundle)
    expect(timeline).toEqual({ lanes: [], items: [], minYear: 0, maxYear: 0 })
  })
})

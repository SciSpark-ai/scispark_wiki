import type { Bundle } from "../vault/bundle"
import { neighborSets } from "./graph"

export interface TimelineItem {
  id: string
  title: string
  type: "paper" | "finding"
  date: string // paper: `${year}-01-01` from frontmatter.year (fallback created); finding: frontmatter.created
  year: number
  laneIds: string[] // topic-page ids this item belongs to (possibly several)
}

export interface TimelineLane {
  id: string
  title: string
  itemCount: number
}

export interface Timeline {
  lanes: TimelineLane[]
  items: TimelineItem[]
  minYear: number
  maxYear: number
}

// Synthetic lane id for items that wikilink/related[] no `topic` page.
export const UNFILED_LANE_ID = "__unfiled__"
const UNFILED_LANE_TITLE = "Unfiled"

function parseYear(dateStr: string | undefined): number {
  const year = parseInt((dateStr ?? "").slice(0, 4), 10)
  return Number.isNaN(year) ? 0 : year
}

function itemDate(page: { frontmatter: { type: string; year?: unknown; created: string } }): {
  date: string
  year: number
} {
  if (page.frontmatter.type === "paper" && typeof page.frontmatter.year === "number") {
    const year = page.frontmatter.year
    return { date: `${year}-01-01`, year }
  }
  const date = page.frontmatter.created
  return { date, year: parseYear(date) }
}

/**
 * Papers and findings, laned by the `topic` pages they wikilink/`related[]`
 * (either direction, reusing the wikilink+related neighbor sets from
 * `graph.ts`). Items linked to no topic land in a synthetic "Unfiled" lane
 * (only materialized when at least one item needs it). Pure: no
 * storage/network/DOM.
 */
export function deriveTimeline(bundle: Bundle): Timeline {
  const neighbors = neighborSets(bundle)
  const topicPages = [...bundle.pages.values()].filter((p) => p.frontmatter.type === "topic")

  const items: TimelineItem[] = []
  for (const page of bundle.pages.values()) {
    const type = page.frontmatter.type
    if (type !== "paper" && type !== "finding") continue

    const { date, year } = itemDate(page)

    const laneIds: string[] = []
    const myNeighbors = neighbors.get(page.id)
    if (myNeighbors) {
      for (const topic of topicPages) {
        if (myNeighbors.has(topic.id)) laneIds.push(topic.id)
      }
    }
    if (laneIds.length === 0) laneIds.push(UNFILED_LANE_ID)

    items.push({ id: page.id, title: page.frontmatter.title, type, date, year, laneIds })
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)))

  const laneCounts = new Map<string, number>()
  for (const item of items) {
    for (const laneId of item.laneIds) laneCounts.set(laneId, (laneCounts.get(laneId) ?? 0) + 1)
  }

  const lanes: TimelineLane[] = []
  for (const topic of topicPages) {
    lanes.push({ id: topic.id, title: topic.frontmatter.title, itemCount: laneCounts.get(topic.id) ?? 0 })
  }
  const unfiledCount = laneCounts.get(UNFILED_LANE_ID)
  if (unfiledCount) lanes.push({ id: UNFILED_LANE_ID, title: UNFILED_LANE_TITLE, itemCount: unfiledCount })

  lanes.sort((a, b) => b.itemCount - a.itemCount || a.title.localeCompare(b.title))

  // Empty item set has no meaningful year range; callers should treat 0/0 as
  // "no data" rather than a real calendar year.
  const years = items.map((i) => i.year)
  const minYear = years.length ? Math.min(...years) : 0
  const maxYear = years.length ? Math.max(...years) : 0

  return { lanes, items, minYear, maxYear }
}

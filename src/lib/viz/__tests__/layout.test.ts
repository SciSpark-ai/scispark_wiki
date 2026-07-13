import { describe, it, expect } from "vitest"
import { topLanes, yearColumns, topAuthorsByPaperCount, edgesAmongNodes, OTHER_LANE_ID } from "../layout"
import type { TimelineLane } from "../timeline"
import type { AuthorNode } from "../authors"

describe("topLanes", () => {
  it("returns all lanes unchanged (sorted) when there are <= n", () => {
    const lanes: TimelineLane[] = [
      { id: "a", title: "A", itemCount: 2 },
      { id: "b", title: "B", itemCount: 5 },
    ]
    const result = topLanes(lanes, 5)
    expect(result).toEqual([
      { id: "b", title: "B", itemCount: 5 },
      { id: "a", title: "A", itemCount: 2 },
    ])
  })

  it("keeps only the top n by itemCount and merges the rest into Other", () => {
    const lanes: TimelineLane[] = [
      { id: "a", title: "A", itemCount: 1 },
      { id: "b", title: "B", itemCount: 5 },
      { id: "c", title: "C", itemCount: 3 },
      { id: "d", title: "D", itemCount: 2 },
    ]
    const result = topLanes(lanes, 2)
    expect(result).toEqual([
      { id: "b", title: "B", itemCount: 5 },
      { id: "c", title: "C", itemCount: 3 },
      { id: OTHER_LANE_ID, title: "Other", itemCount: 1 + 2 },
    ])
  })

  it("skips empty-count lanes when merging into Other (no Other row if the rest are all empty)", () => {
    const lanes: TimelineLane[] = [
      { id: "a", title: "A", itemCount: 5 },
      { id: "b", title: "B", itemCount: 0 },
      { id: "c", title: "C", itemCount: 0 },
    ]
    const result = topLanes(lanes, 1)
    expect(result).toEqual([{ id: "a", title: "A", itemCount: 5 }])
  })

  it("a mix of empty and non-empty overflow lanes: Other counts only the non-empty ones", () => {
    const lanes: TimelineLane[] = [
      { id: "a", title: "A", itemCount: 5 },
      { id: "b", title: "B", itemCount: 0 },
      { id: "c", title: "C", itemCount: 4 },
    ]
    const result = topLanes(lanes, 1)
    expect(result).toEqual([
      { id: "a", title: "A", itemCount: 5 },
      { id: OTHER_LANE_ID, title: "Other", itemCount: 4 },
    ])
  })

  it("keeps __unfiled__ where it falls by itemCount rather than special-casing it", () => {
    const lanes: TimelineLane[] = [
      { id: "__unfiled__", title: "Unfiled", itemCount: 9 },
      { id: "a", title: "A", itemCount: 1 },
    ]
    const result = topLanes(lanes, 1)
    expect(result).toEqual([
      { id: "__unfiled__", title: "Unfiled", itemCount: 9 },
      { id: OTHER_LANE_ID, title: "Other", itemCount: 1 },
    ])
  })

  it("ties broken by title ascending", () => {
    const lanes: TimelineLane[] = [
      { id: "z", title: "Zeta", itemCount: 3 },
      { id: "a", title: "Alpha", itemCount: 3 },
    ]
    const result = topLanes(lanes, 2)
    expect(result.map((l) => l.id)).toEqual(["a", "z"])
  })

  it("empty lanes list -> empty result", () => {
    expect(topLanes([], 12)).toEqual([])
  })

  it("n = 0 -> everything (if any non-empty) collapses into Other", () => {
    const lanes: TimelineLane[] = [
      { id: "a", title: "A", itemCount: 2 },
      { id: "b", title: "B", itemCount: 3 },
    ]
    const result = topLanes(lanes, 0)
    expect(result).toEqual([{ id: OTHER_LANE_ID, title: "Other", itemCount: 5 }])
  })
})

describe("yearColumns", () => {
  it("groups papers by year, columns ordered ascending", () => {
    const result = yearColumns([
      { id: "p1", year: 2022 },
      { id: "p2", year: 2020 },
      { id: "p3", year: 2021 },
    ])
    expect(result.map((c) => c.year)).toEqual([2020, 2021, 2022])
  })

  it("preserves input order (stable) within a column, not re-sorted by id", () => {
    const result = yearColumns([
      { id: "z", year: 2020 },
      { id: "a", year: 2020 },
      { id: "m", year: 2020 },
    ])
    expect(result).toEqual([{ year: 2020, ids: ["z", "a", "m"] }])
  })

  it("multiple papers across multiple years", () => {
    const result = yearColumns([
      { id: "p1", year: 2020 },
      { id: "p2", year: 2021 },
      { id: "p3", year: 2020 },
      { id: "p4", year: 2022 },
      { id: "p5", year: 2021 },
    ])
    expect(result).toEqual([
      { year: 2020, ids: ["p1", "p3"] },
      { year: 2021, ids: ["p2", "p5"] },
      { year: 2022, ids: ["p4"] },
    ])
  })

  it("empty input -> empty output", () => {
    expect(yearColumns([])).toEqual([])
  })

  it("a single paper with year 0 (unparseable date) still gets its own column", () => {
    const result = yearColumns([{ id: "p1", year: 0 }])
    expect(result).toEqual([{ year: 0, ids: ["p1"] }])
  })

  it("the year-0 (undated) column is pinned LAST, never before real years", () => {
    const result = yearColumns([
      { id: "old", year: 1995 },
      { id: "undated", year: 0 },
      { id: "recent", year: 2023 },
    ])
    expect(result.map((c) => c.year)).toEqual([1995, 2023, 0])
    expect(result[2].ids).toEqual(["undated"])
  })
})

function author(key: string, paperCount: number): AuthorNode {
  return { key, name: key, paperCount, pageId: null }
}

describe("topAuthorsByPaperCount", () => {
  it("sorts by paperCount descending", () => {
    const result = topAuthorsByPaperCount([author("a", 1), author("b", 5), author("c", 3)], 10)
    expect(result.map((a) => a.key)).toEqual(["b", "c", "a"])
  })

  it("caps at n", () => {
    const result = topAuthorsByPaperCount([author("a", 1), author("b", 5), author("c", 3)], 2)
    expect(result.map((a) => a.key)).toEqual(["b", "c"])
  })

  it("ties broken by key ascending", () => {
    const result = topAuthorsByPaperCount([author("zed", 3), author("amy", 3)], 10)
    expect(result.map((a) => a.key)).toEqual(["amy", "zed"])
  })

  it("empty input -> empty output", () => {
    expect(topAuthorsByPaperCount([], 10)).toEqual([])
  })

  it("n = 0 -> empty output", () => {
    expect(topAuthorsByPaperCount([author("a", 1)], 0)).toEqual([])
  })

  it("n larger than the list -> returns all, sorted", () => {
    const result = topAuthorsByPaperCount([author("a", 1), author("b", 2)], 200)
    expect(result.map((a) => a.key)).toEqual(["b", "a"])
  })

  it("does not mutate the input array", () => {
    const input = [author("a", 1), author("b", 5)]
    const copy = [...input]
    topAuthorsByPaperCount(input, 10)
    expect(input).toEqual(copy)
  })
})

describe("edgesAmongNodes (forceLink crash guard)", () => {
  it("drops any edge referencing a node outside the rendered set", () => {
    const edges = [
      { a: "kept1", b: "kept2", papers: 3 },
      { a: "kept1", b: "dropped", papers: 1 }, // endpoint capped out — must be excluded
      { a: "dropped", b: "kept2", papers: 2 },
      { a: "droppedX", b: "droppedY", papers: 5 },
    ]
    const keys = new Set(["kept1", "kept2"])
    expect(edgesAmongNodes(edges, keys)).toEqual([{ a: "kept1", b: "kept2", papers: 3 }])
  })

  it("a 201-author over-cap network yields only in-cap edges (no dangling references)", () => {
    const nodes = Array.from({ length: 201 }, (_, i) => author(`a${i}`, 201 - i))
    const capped = topAuthorsByPaperCount(nodes, 200)
    const keys = new Set(capped.map((n) => n.key))
    // a200 has the lowest paperCount and is the one capped out.
    expect(keys.has("a200")).toBe(false)
    const edges = [
      { a: "a0", b: "a200", papers: 1 }, // references the dropped author
      { a: "a0", b: "a1", papers: 2 },
    ]
    const inScope = edgesAmongNodes(edges, keys)
    expect(inScope).toEqual([{ a: "a0", b: "a1", papers: 2 }])
    // every surviving edge endpoint is resolvable — the forceLink invariant.
    for (const e of inScope) {
      expect(keys.has(e.a)).toBe(true)
      expect(keys.has(e.b)).toBe(true)
    }
  })

  it("empty keys -> no edges", () => {
    expect(edgesAmongNodes([{ a: "x", b: "y", papers: 1 }], new Set())).toEqual([])
  })
})

import { describe, it, expect } from "vitest"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import { retrieveFieldCandidates } from "../retrieve"

const NOW = new Date("2026-07-14T00:00:00.000Z")

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}

describe("retrieveFieldCandidates", () => {
  it("returns recent (within window) and movers (citation-sorted), deduped, across sources", async () => {
    const fresh = paper({ title: "Fresh", ids: { arxiv: "a" }, date: "2026-07-10", year: 2026, citationCount: 2 })
    const old = paper({ title: "Old", ids: { arxiv: "b" }, date: "2020-01-01", year: 2020, citationCount: 99 })
    const searchFn: SearchFn = async (source) => (source === "arxiv" ? [fresh, old] : [fresh]) // fresh dup across sources
    const { recent, movers } = await retrieveFieldCandidates(searchFn, { slug: "nlp", label: "NLP" }, { now: NOW })

    expect(recent.map((p) => p.title)).toEqual(["Fresh"]) // old is outside the 14-day window
    expect(movers[0].title).toBe("Old") // highest citationCount first
    expect(recent.filter((p) => p.title === "Fresh").length).toBe(1) // deduped across sources
  })

  it("a throwing source contributes [] rather than failing the whole retrieval", async () => {
    const good = paper({ title: "Good", ids: { arxiv: "g" }, date: "2026-07-12", year: 2026, citationCount: 1 })
    const searchFn: SearchFn = async (source) => {
      if (source === "openalex") throw new Error("429")
      return [good]
    }
    const { recent } = await retrieveFieldCandidates(searchFn, { slug: "nlp", label: "NLP" }, { now: NOW })
    expect(recent.map((p) => p.title)).toEqual(["Good"])
  })

  it("keeps a no-date paper in movers but excludes it from recent", async () => {
    const undated = paper({ title: "Undated", ids: { arxiv: "u" }, citationCount: 5 })
    const searchFn: SearchFn = async () => [undated]
    const { recent, movers } = await retrieveFieldCandidates(searchFn, { slug: "x", label: "X" }, { now: NOW })
    expect(recent).toEqual([])
    expect(movers.map((p) => p.title)).toEqual(["Undated"])
  })
})

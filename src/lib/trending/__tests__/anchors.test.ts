import { describe, it, expect, vi } from "vitest"
import { deriveAnchorDisciplines, MAX_ANCHORS } from "../anchors"

const WINDOW = { fromDate: "2026-07-06", toDate: "2026-07-19" }

describe("deriveAnchorDisciplines", () => {
  it("rolls a narrow label up to its modal field", async () => {
    const fieldGroupFn = vi.fn(async () => [
      { key: "f/neuro", label: "Neuroscience", count: 120 },
      { key: "f/cs", label: "Computer Science", count: 30 },
    ])
    expect(await deriveAnchorDisciplines(["auditory attention decoding (EEG)"], fieldGroupFn, WINDOW)).toEqual([
      { id: "f/neuro", label: "Neuroscience" },
    ])
  })

  it("dedupes across labels and orders by summed count", async () => {
    const fieldGroupFn = vi.fn(async (q: { query: string }) =>
      q.query === "a"
        ? [{ key: "f/cs", label: "Computer Science", count: 10 }]
        : q.query === "b"
          ? [{ key: "f/neuro", label: "Neuroscience", count: 100 }]
          : [{ key: "f/cs", label: "Computer Science", count: 50 }],
    )
    const out = await deriveAnchorDisciplines(["a", "b", "c"], fieldGroupFn, WINDOW)
    expect(out).toEqual([
      { id: "f/neuro", label: "Neuroscience" },    // 100
      { id: "f/cs", label: "Computer Science" },   // 10 + 50 = 60
    ])
  })

  it("caps at MAX_ANCHORS", async () => {
    let n = 0
    const fieldGroupFn = vi.fn(async () => {
      n += 1
      return [{ key: `f/${n}`, label: `Field ${n}`, count: 100 - n }]
    })
    const out = await deriveAnchorDisciplines(["a", "b", "c", "d", "e"], fieldGroupFn, WINDOW)
    expect(out).toHaveLength(MAX_ANCHORS)
  })

  it("ignores a label whose lookup throws and keeps the rest", async () => {
    const fieldGroupFn = vi.fn(async (q: { query: string }) => {
      if (q.query === "bad") throw new Error("network")
      return [{ key: "f/neuro", label: "Neuroscience", count: 5 }]
    })
    expect(await deriveAnchorDisciplines(["bad", "good"], fieldGroupFn, WINDOW)).toEqual([
      { id: "f/neuro", label: "Neuroscience" },
    ])
  })

  it("returns [] when every lookup fails", async () => {
    const fieldGroupFn = vi.fn(async () => {
      throw new Error("down")
    })
    expect(await deriveAnchorDisciplines(["a", "b"], fieldGroupFn, WINDOW)).toEqual([])
  })

  it("returns [] for no labels without calling out", async () => {
    const fieldGroupFn = vi.fn(async () => [])
    expect(await deriveAnchorDisciplines([], fieldGroupFn, WINDOW)).toEqual([])
    expect(fieldGroupFn).not.toHaveBeenCalled()
  })
})

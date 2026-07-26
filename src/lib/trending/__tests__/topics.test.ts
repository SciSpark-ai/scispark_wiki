import { describe, it, expect } from "vitest"
import {
  completeWindows,
  rankHeatingTopics,
  selectTopicCandidates,
  MIN_RECENT_COUNT,
  MIN_PRIOR_COUNT,
  MAX_LEADERBOARD_TOPICS,
  CANDIDATE_POOL,
} from "../topics"
import type { CorpusTotals } from "../topics"

describe("completeWindows", () => {
  it("excludes the in-progress week and returns two 14-day windows", () => {
    // 2026-07-24 is a Friday; its ISO week starts Monday 2026-07-20.
    const { recent, prior } = completeWindows(new Date("2026-07-24T12:00:00Z"))
    expect(recent).toEqual({ fromDate: "2026-07-06", toDate: "2026-07-19" })
    expect(prior).toEqual({ fromDate: "2026-06-22", toDate: "2026-07-05" })
  })

  it("is stable anywhere inside the same in-progress week", () => {
    const a = completeWindows(new Date("2026-07-20T00:00:00Z")) // Monday
    const b = completeWindows(new Date("2026-07-26T23:59:59Z")) // Sunday
    expect(a).toEqual(b)
  })
})

/** One discipline's RECENT-window buckets. Prior counts are looked up, never grouped. */
const d = (discipline: string, recent: Array<[string, number]>) => ({
  discipline,
  recent: recent.map(([k, count]) => ({ key: k, label: `L:${k}`, count })),
})

const priors = (entries: Array<[string, number]>) => new Map(entries)

/**
 * Corpus sizes per discipline. `totals("Neuro")` gives both windows the SAME
 * size, so share growth reduces to raw growth and the pre-existing ranking
 * assertions still read naturally; the share-specific tests pass real,
 * different sizes.
 */
const totals = (...disciplines: string[]) =>
  new Map<string, CorpusTotals>(disciplines.map((label) => [label, { recent: 1000, prior: 1000 }]))

/** One discipline's real, DIFFERENT corpus sizes in the two windows. */
const corpus = (discipline: string, recent: number | null, prior: number | null) =>
  new Map<string, CorpusTotals>([[discipline, { recent, prior }]])

describe("selectTopicCandidates", () => {
  it("orders by recent volume and caps the pool at CANDIDATE_POOL", () => {
    const recent = Array.from({ length: CANDIDATE_POOL + 8 }, (_, i) => [`t${i}`, 10 + i] as [string, number])
    const out = selectTopicCandidates([d("Neuro", recent)])
    expect(out).toHaveLength(CANDIDATE_POOL)
    expect(out[0]).toMatchObject({ key: `t${CANDIDATE_POOL + 7}`, recentCount: 10 + CANDIDATE_POOL + 7 })
    // The lowest-volume topics are the ones that never get a prior lookup.
    expect(out.map((c) => c.key)).not.toContain("t0")
  })

  it("drops topics under the volume floor before spending a lookup on them", () => {
    const out = selectTopicCandidates([d("Neuro", [["small", MIN_RECENT_COUNT - 1], ["big", MIN_RECENT_COUNT]])])
    expect(out.map((c) => c.key)).toEqual(["big"])
  })

  it("dedupes a topic shared by two disciplines, keeping the higher recent count", () => {
    const out = selectTopicCandidates([d("Neuro", [["shared", 8]]), d("CS", [["shared", 30]])])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("returns [] for no input", () => {
    expect(selectTopicCandidates([])).toEqual([])
  })
})

describe("rankHeatingTopics", () => {
  it("computes growth from the looked-up prior counts and sorts fastest first", () => {
    const out = rankHeatingTopics([d("Neuro", [["a", 20], ["b", 12]])], priors([["a", 10], ["b", 10]]), totals("Neuro"))
    expect(out.map((t) => [t.key, t.growth])).toEqual([
      ["a", 1],
      ["b", 0.2],
    ])
  })

  it("REGRESSION: a topic missing from the prior GROUPED list still gets real growth from its looked-up prior count", () => {
    // The 200-bucket horizon, measured live on Computer Science (2026-07-25):
    // the recent window's 200th bucket held 14 works, the prior window's held
    // 22, so "Remote-Sensing Image Classification" (27 recent) cleared the
    // recent list but fell off the prior one. Joining the two grouped lists
    // recorded priorCount 0 → growth null → rendered "new" → sorted first,
    // and 60 of 200 topics were affected. Its TRUE prior count is 16, i.e.
    // +69% — a real, finite figure, and NOT "new".
    const out = rankHeatingTopics(
      [{ discipline: "Computer Science", recent: [{ key: "T10689", label: "Remote-Sensing Image Classification", count: 27 }] }],
      priors([["T10689", 16]]),
      totals("Computer Science"),
    )
    expect(out).toHaveLength(1)
    expect(out[0].priorCount).toBe(16)
    expect(out[0].growth).not.toBeNull()
    expect(out[0].growth).toBeCloseTo(0.6875)
  })

  it("a GENUINE zero prior still yields growth null (that is what \"new\" now means)", () => {
    const out = rankHeatingTopics([d("Neuro", [["new", 9], ["grown", 20]])], priors([["new", 0], ["grown", 10]]), totals("Neuro"))
    expect(out[0]).toMatchObject({ key: "new", growth: null, priorCount: 0 })
    expect(out[1]).toMatchObject({ key: "grown", growth: 1 })
  })

  it("drops a candidate whose prior count was never measured (unknown is not zero)", () => {
    // Outside the bounded candidate pool, or its lookup request failed: the
    // row is omitted rather than defaulted to 0 and mislabelled "new".
    const out = rankHeatingTopics(
      [d("Neuro", [["measured", 20], ["unmeasured", 30]])],
      priors([["measured", 10]]),
      totals("Neuro"),
    )
    expect(out.map((t) => t.key)).toEqual(["measured"])
  })

  it("drops topics under the RECENT volume floor", () => {
    const out = rankHeatingTopics(
      [d("Neuro", [["small", MIN_RECENT_COUNT - 1], ["big", MIN_RECENT_COUNT]])],
      priors([["small", MIN_PRIOR_COUNT], ["big", MIN_PRIOR_COUNT]]),
      totals("Neuro"),
    )
    expect(out.map((t) => t.key)).toEqual(["big"])
  })

  it("a NONZERO prior under the floor quotes no percentage (noise cannot top the board with a figure)", () => {
    // The asymmetry this closes: 1 → 5 clears MIN_RECENT_COUNT and would post
    // a precise-looking +400% share figure off a denominator of one paper.
    const out = rankHeatingTopics(
      [d("Neuro", [["noise", MIN_RECENT_COUNT], ["real", 40]])],
      priors([["noise", MIN_PRIOR_COUNT - 1], ["real", 20]]),
      totals("Neuro"),
    )
    const noise = out.find((t) => t.key === "noise")
    expect(noise?.growth).toBeNull()
    expect(noise?.priorShare).toBe(0)
    // …and the honest absolute base is still carried, so the row can say 4 → 5.
    expect(noise?.priorCount).toBe(MIN_PRIOR_COUNT - 1)
    expect(out.find((t) => t.key === "real")?.growth).toBeCloseTo(1)
  })

  it("keeps a topic sitting exactly ON the prior floor, with a real percentage", () => {
    const out = rankHeatingTopics(
      [d("Neuro", [["edge", 40]])],
      priors([["edge", MIN_PRIOR_COUNT]]),
      totals("Neuro"),
    )
    expect(out.map((t) => t.key)).toEqual(["edge"])
    expect(out[0].growth).not.toBeNull()
  })

  it("LADDER: visibility is monotonic in prior volume — 0 and a small prior are both \"new\" and PRESENT, a sufficient prior gets a figure", () => {
    // The incoherence this pins: with the floor as a DROP, the ladder read
    // 0 → shown "new", 1–4 → silently gone, ≥5 → shown with a figure. Zero was
    // more visible than one, and a 2 → 40 breakout — exactly what this page
    // exists to surface — vanished behind a threshold nobody is told about
    // (correctly with no dataError, since nothing failed). A row is now dropped
    // only when something is genuinely UNKNOWN, never merely small.
    const out = rankHeatingTopics(
      [d("Neuro", [["zero", 40], ["small", 40], ["sufficient", 40]])],
      priors([["zero", 0], ["small", 2], ["sufficient", 20]]),
      totals("Neuro"),
    )
    expect(out.map((t) => t.key).sort()).toEqual(["small", "sufficient", "zero"])

    const by = new Map(out.map((t) => [t.key, t]))
    expect(by.get("zero")).toMatchObject({ growth: null, priorCount: 0, priorShare: 0 })
    // The middle rung: present, labelled "new", and NOT quoting a percentage.
    expect(by.get("small")).toMatchObject({ growth: null, priorCount: 2, priorShare: 0 })
    expect(by.get("sufficient")?.growth).toBeCloseTo(1)
  })

  it("merges disciplines into one board and tags each row's discipline", () => {
    const out = rankHeatingTopics(
      [d("Neuro", [["n", 30]]), d("CS", [["c", 12]])],
      priors([["n", 10], ["c", 10]]),
      totals("Neuro", "CS"),
    )
    expect(out.map((t) => [t.key, t.discipline])).toEqual([
      ["n", "Neuro"],
      ["c", "CS"],
    ])
  })

  it("keeps the higher-count side when one topic appears under two disciplines", () => {
    const out = rankHeatingTopics(
      [d("Neuro", [["shared", 8]]), d("CS", [["shared", 30]])],
      priors([["shared", 10]]),
      totals("Neuro", "CS"),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("keeps the higher-count side regardless of which discipline is listed first", () => {
    const out = rankHeatingTopics(
      [d("CS", [["shared", 30]]), d("Neuro", [["shared", 8]])],
      priors([["shared", 10]]),
      totals("Neuro", "CS"),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("caps the board at MAX_LEADERBOARD_TOPICS and keeps the highest-growth topics", () => {
    const recent = Array.from({ length: 20 }, (_, i) => [`t${i}`, 10 + i] as [string, number])
    const prior = priors(Array.from({ length: 20 }, (_, i) => [`t${i}`, 5] as [string, number]))
    const out = rankHeatingTopics([d("Neuro", recent)], prior, totals("Neuro"))
    expect(out).toHaveLength(MAX_LEADERBOARD_TOPICS)
    // recentCount 10+i over prior=5 for all → growth is monotonic in i, so the
    // surviving set must be the 10 highest-i topics (t10..t19), highest first.
    expect(out.map((t) => t.key)).toEqual(["t19", "t18", "t17", "t16", "t15", "t14", "t13", "t12", "t11", "t10"])
    for (const dropped of ["t0", "t1", "t8", "t9"]) {
      expect(out.map((t) => t.key)).not.toContain(dropped)
    }
  })

  it("returns [] for no input", () => {
    expect(rankHeatingTopics([], new Map(), new Map())).toEqual([])
  })
})

describe("rankHeatingTopics: growth is a share of the corpus, not a raw count", () => {
  // Tonight's real Computer Science windows (measured live 2026-07-25):
  // window(-3) 16624 → prior 22808 → recent 13953. The MIDDLE window is the
  // highest, so the ~39% drop into the recent window is OpenAlex's indexing
  // back-fill, not a real slump in computer science.
  const CS_RECENT = 13953
  const CS_PRIOR = 22808
  const csCorpus = corpus("Computer Science", CS_RECENT, CS_PRIOR)

  it("HEADLINE: a topic whose RAW count fell but whose SHARE rose ranks as GROWING", () => {
    // "Multimodal Machine Learning", live: 184 → 134. Raw: −27%. By share:
    // 134/13953 = 0.960% vs 184/22808 = 0.807% → +19%. Ranking it negative was
    // handing every row the corpus-wide ~39% headwind.
    const out = rankHeatingTopics(
      [d("Computer Science", [["mml", 134]])],
      priors([["mml", 184]]),
      csCorpus,
    )
    expect(out).toHaveLength(1)
    const [row] = out
    expect(row.recentCount).toBeLessThan(row.priorCount) // raw volume really did fall
    expect(row.growth).toBeGreaterThan(0) // ...and it is still heating up
    expect(row.growth).toBeCloseTo(0.19, 2)
  })

  it("scales a genuinely fast riser by the same corpus shrinkage", () => {
    // "Complexity and Algorithms in Graphs", live: 39 → 60. Raw +54%; by share
    // 60/13953 vs 39/22808 → +151%.
    const out = rankHeatingTopics([d("Computer Science", [["graphs", 60]])], priors([["graphs", 39]]), csCorpus)
    expect(out[0].growth).toBeCloseTo(1.5147, 3)
  })

  it("still ranks a topic that lost share as declining", () => {
    // Falling faster than the corpus: 184 → 60 is −49% by share, and must not
    // be rescued by the correction.
    const out = rankHeatingTopics([d("Computer Science", [["fading", 60]])], priors([["fading", 184]]), csCorpus)
    expect(out[0].growth).toBeLessThan(0)
    expect(out[0].growth).toBeCloseTo(-0.467, 2)
  })

  it("orders the board by share growth, not by raw growth", () => {
    // Raw: riser +54%, shrinker −27% → riser first either way, but the
    // shrinker must be ABOVE zero, not below it.
    const out = rankHeatingTopics(
      [d("Computer Science", [["mml", 134], ["graphs", 60]])],
      priors([["mml", 184], ["graphs", 39]]),
      csCorpus,
    )
    expect(out.map((t) => t.key)).toEqual(["graphs", "mml"])
    expect(out.every((t) => (t.growth ?? 0) > 0)).toBe(true)
  })

  it("carries the two shares growth was computed from (so the bars can be drawn from them)", () => {
    const out = rankHeatingTopics([d("Computer Science", [["mml", 134]])], priors([["mml", 184]]), csCorpus)
    const [row] = out
    expect(row.recentShare).toBeCloseTo(134 / CS_RECENT, 10)
    expect(row.priorShare).toBeCloseTo(184 / CS_PRIOR, 10)
    expect(row.growth).toBeCloseTo((row.recentShare - row.priorShare) / row.priorShare, 10)
    // The raw counts survive too — absolute volume is still shown as text.
    expect([row.priorCount, row.recentCount]).toEqual([184, 134])
  })

  it("keeps the volume floor on the RAW recent count (a share floor would be meaningless)", () => {
    // Under the floor in raw terms, yet a huge share gain: it must still be out.
    const out = rankHeatingTopics(
      [d("Computer Science", [["tiny", MIN_RECENT_COUNT - 1]])],
      priors([["tiny", 1]]),
      csCorpus,
    )
    expect(out).toEqual([])
  })

  it("a genuine zero prior is still \"new\", with priorShare 0 and a real recentShare", () => {
    const out = rankHeatingTopics([d("Computer Science", [["fresh", 40]])], priors([["fresh", 0]]), csCorpus)
    expect(out[0]).toMatchObject({ growth: null, priorCount: 0, priorShare: 0 })
    expect(out[0].recentShare).toBeCloseTo(40 / CS_RECENT, 10)
  })

  it("an EMPTY prior corpus yields no NaN/Infinity — every such row is a genuine 'new'", () => {
    // totalPrior 0 can only coexist with priorCount 0 (a topic cannot outnumber
    // its corpus), so the row is "new" and no division is ever attempted.
    const out = rankHeatingTopics(
      [d("Computer Science", [["fresh", 40]])],
      priors([["fresh", 0]]),
      corpus("Computer Science", CS_RECENT, 0),
    )
    expect(out).toHaveLength(1)
    expect(out[0].growth).toBeNull()
    expect(Number.isFinite(out[0].recentShare)).toBe(true)
    expect(out[0].priorShare).toBe(0)
  })

  it("drops rows whose discipline's PRIOR corpus was never measured (no raw-count fallback)", () => {
    // A failed count is unknown, not 1: falling back to raw growth would
    // silently reintroduce the indexing-lag headwind on those rows only, making
    // the board's ranking incomparable. A genuine "new" row needs no prior
    // denominator, so it survives.
    const out = rankHeatingTopics(
      [d("Computer Science", [["ratio", 134], ["fresh", 40]])],
      priors([["ratio", 184], ["fresh", 0]]),
      corpus("Computer Science", CS_RECENT, null),
    )
    expect(out.map((t) => t.key)).toEqual(["fresh"])
  })

  it("drops every row of a discipline whose RECENT corpus was never measured", () => {
    const out = rankHeatingTopics(
      [d("Computer Science", [["ratio", 134], ["fresh", 40]])],
      priors([["ratio", 184], ["fresh", 0]]),
      corpus("Computer Science", null, CS_PRIOR),
    )
    expect(out).toEqual([])
  })

  it("drops rows of a discipline with no totals entry at all, keeping the other discipline's", () => {
    const out = rankHeatingTopics(
      [d("Computer Science", [["cs", 134]]), d("Neuro", [["n", 20]])],
      priors([["cs", 184], ["n", 10]]),
      totals("Neuro"),
    )
    expect(out.map((t) => t.key)).toEqual(["n"])
  })

  it("never emits a non-finite growth or share for malformed corpus sizes", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = rankHeatingTopics(
        [d("Computer Science", [["x", 134]])],
        priors([["x", 184]]),
        corpus("Computer Science", bad, bad),
      )
      for (const row of out) {
        expect(Number.isFinite(row.recentShare)).toBe(true)
        expect(Number.isFinite(row.priorShare)).toBe(true)
        expect(row.growth === null || Number.isFinite(row.growth)).toBe(true)
      }
    }
  })
})

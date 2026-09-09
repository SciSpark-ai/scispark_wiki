import { describe, it, expect } from "vitest"
import { summarizeAcceptance } from "../acceptance"

describe("summarizeAcceptance", () => {
  it("ingest: 3 applied, 1 reverted → acceptRate 2/3, cost-per-accepted = totalCostUsd / 2", () => {
    const changesets = [
      { id: "cs-1", skill: "ingest" },
      { id: "cs-2", skill: "ingest" },
      { id: "cs-3", skill: "ingest" },
    ]
    const revertedIds = new Set(["cs-2"])
    const usageRecords = [
      { skill: "ingest", costUsd: 1 },
      { skill: "ingest", costUsd: 2 },
      { skill: "ingest", costUsd: 3 },
    ]

    const result = summarizeAcceptance(changesets, revertedIds, usageRecords)

    expect(result).toEqual([
      {
        skill: "ingest",
        applied: 3,
        reverted: 1,
        acceptRate: 2 / 3,
        totalCostUsd: 6,
        costPerAcceptedUsd: 3, // 6 / (3 - 1)
      },
    ])
  })

  it("a changeset skill absent from USAGE_SKILLS gets null costs, not zero", () => {
    const changesets = [{ id: "cs-1", skill: "note" }]

    const result = summarizeAcceptance(changesets, new Set(), [
      { skill: "some-unrelated-skill", costUsd: 99 },
    ])

    expect(result).toEqual([
      {
        skill: "note",
        applied: 1,
        reverted: 0,
        acceptRate: 1,
        totalCostUsd: null,
        costPerAcceptedUsd: null,
      },
    ])
  })

  it("zero applied changesets but real usage spend on a mapped skill → null rate, null cost-per-accepted, real total cost", () => {
    // e.g. Spark Deep spent money across bottleneck/ideation calls but exited
    // honestly (do_not_generate) before ever assembling an `idea` changeset.
    const usageRecords = [
      { skill: "spark-bottleneck", costUsd: 1.5 },
      { skill: "spark-ideation", costUsd: 2 },
    ]

    const result = summarizeAcceptance([], new Set(), usageRecords)

    expect(result).toEqual([
      {
        skill: "spark-deep",
        applied: 0,
        reverted: 0,
        acceptRate: null,
        totalCostUsd: 3.5,
        costPerAcceptedUsd: null,
      },
    ])
  })

  it("all applied changesets reverted → costPerAcceptedUsd null (denominator ≤ 0) even with real cost", () => {
    const changesets = [{ id: "cs-1", skill: "enrich" }]
    const revertedIds = new Set(["cs-1"])
    const usageRecords = [{ skill: "enrich", costUsd: 4 }]

    const result = summarizeAcceptance(changesets, revertedIds, usageRecords)

    expect(result).toEqual([
      {
        skill: "enrich",
        applied: 1,
        reverted: 1,
        acceptRate: 0,
        totalCostUsd: 4,
        costPerAcceptedUsd: null,
      },
    ])
  })

  it("an unpriced call keeps acceptance costs unknown, even alongside priced calls", () => {
    const changesets = [{ id: "cs-1", skill: "lint" }]
    const usageRecords = [
      { skill: "lint-screen", costUsd: null },
      { skill: "lint-judge", costUsd: 2 },
    ]

    const result = summarizeAcceptance(changesets, new Set(), usageRecords)

    expect(result[0].totalCostUsd).toBeNull()
    expect(result[0].costPerAcceptedUsd).toBeNull()
  })

  it("lint's two usage-skill names (lint-screen, lint-judge) are summed under one 'lint' entry", () => {
    const changesets = [{ id: "cs-1", skill: "lint" }]
    const usageRecords = [
      { skill: "lint-screen", costUsd: 0.5 },
      { skill: "lint-judge", costUsd: 1.5 },
      { skill: "digest", costUsd: 100 }, // unrelated skill, must not leak in
    ]

    const result = summarizeAcceptance(changesets, new Set(), usageRecords)

    expect(result).toHaveLength(1)
    expect(result[0].totalCostUsd).toBe(2)
  })

  it("sorts by applied descending", () => {
    const changesets = [
      { id: "cs-1", skill: "a" },
      { id: "cs-2", skill: "b" },
      { id: "cs-3", skill: "b" },
    ]

    const result = summarizeAcceptance(changesets, new Set(), [])

    expect(result.map((r) => r.skill)).toEqual(["b", "a"])
  })

  it("empty inputs → empty result", () => {
    expect(summarizeAcceptance([], new Set(), [])).toEqual([])
  })
})

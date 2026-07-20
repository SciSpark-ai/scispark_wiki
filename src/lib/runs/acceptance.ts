/**
 * Pure per-skill "cost per accepted change" summary (Task 4). Turns the vault's
 * changeset audit trail + revert telemetry + LLM usage ledger into one row per
 * changeset-producing skill: how many changesets it produced, how many were
 * later reverted, and what its all-time LLM spend cost per surviving
 * (non-reverted) change. No storage/IO here — the route (src/app/api/usage/route.ts)
 * does the reading; this module just does the arithmetic, so it's fully
 * unit-testable and deterministic.
 */

export interface SkillAcceptance {
  skill: string
  applied: number
  reverted: number
  /** applied === 0 → null */
  acceptRate: number | null
  /** all-time usage cost of this changeset-producer's LLM skills; null when unmapped */
  totalCostUsd: number | null
  /** totalCostUsd / (applied - reverted); null when denominator ≤ 0 or cost unmapped */
  costPerAcceptedUsd: number | null
}

/**
 * Maps a changeset-producing skill (Changeset.skill / the `skill` carried on a
 * changeset_revert event) to the usage-ledger skill name(s) whose LLM spend
 * should be attributed to it. From `grep 'name: "' src/lib/skills src/lib/spark`.
 * A changeset skill absent from this map gets `totalCostUsd: null` — its cost
 * is unmapped/unknown, not zero.
 */
const USAGE_SKILLS: Record<string, string[]> = {
  ingest: ["ingest"],
  enrich: ["enrich"],
  lint: ["lint-screen", "lint-judge"],
  "memory-consolidation": ["memory-consolidation"],
  "spark-deep": ["spark-bottleneck", "spark-ideation", "spark-scoop-terms", "spark-scoop-verdict", "spark-audit"],
}

/**
 * `changesets` is every applied changeset ever recorded (id + producing skill,
 * from `.scispark/changesets/*.json`); `revertedIds` is the set of changeset
 * ids later reverted (changeset_revert events unioned with ingest's log.md undo
 * entries — see the route); `usageRecords` is the whole LLM usage ledger
 * (skill + costUsd, costUsd null when a call's cost couldn't be priced).
 *
 * Returns one entry per distinct changeset-producing skill seen in
 * `changesets`, PLUS one zero-applied entry for any `USAGE_SKILLS` key that
 * has matching usage spend but no applied changeset at all — e.g. a Spark
 * Deep run that spent money across bottleneck/ideation/scoop/audit calls but
 * exited honestly (`do_not_generate`) before ever assembling an `idea`
 * changeset. That spend must still surface; `acceptRate`/`costPerAcceptedUsd`
 * are both null there since nothing was ever accepted. Sorted by `applied`
 * descending.
 */
export function summarizeAcceptance(
  changesets: Array<{ id: string; skill: string }>,
  revertedIds: Set<string>,
  usageRecords: Array<{ skill: string; costUsd: number | null }>,
): SkillAcceptance[] {
  const bySkill = new Map<string, { applied: number; reverted: number }>()
  for (const cs of changesets) {
    const entry = bySkill.get(cs.skill) ?? { applied: 0, reverted: 0 }
    entry.applied += 1
    if (revertedIds.has(cs.id)) entry.reverted += 1
    bySkill.set(cs.skill, entry)
  }

  // Reverse map: usage-ledger skill name -> the changeset-producing skill it bills to.
  const usageNameToSkill = new Map<string, string>()
  for (const [skill, names] of Object.entries(USAGE_SKILLS)) {
    for (const name of names) usageNameToSkill.set(name, skill)
  }

  // Surface a zero-applied entry for a mapped skill with real spend but no
  // (yet) applied changeset, so that spend is never silently dropped.
  for (const rec of usageRecords) {
    const skill = usageNameToSkill.get(rec.skill)
    if (skill != null && !bySkill.has(skill)) {
      bySkill.set(skill, { applied: 0, reverted: 0 })
    }
  }

  const results: SkillAcceptance[] = []
  for (const [skill, { applied, reverted }] of bySkill) {
    const acceptRate = applied === 0 ? null : (applied - reverted) / applied

    const usageNames = USAGE_SKILLS[skill]
    const totalCostUsd = usageNames
      ? usageRecords
          .filter((r) => usageNames.includes(r.skill))
          .reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
      : null

    const acceptedCount = applied - reverted
    const costPerAcceptedUsd =
      totalCostUsd === null || acceptedCount <= 0 ? null : totalCostUsd / acceptedCount

    results.push({ skill, applied, reverted, acceptRate, totalCostUsd, costPerAcceptedUsd })
  }

  results.sort((a, b) => b.applied - a.applied)
  return results
}

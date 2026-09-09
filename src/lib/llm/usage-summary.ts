import type { UsageRecord } from "./metering"
import { addCosts } from "./pricing"

export interface UsageSummary {
  today: {
    totalUsd: number | null
    bySkill: Array<{ skill: string; totalUsd: number | null }>
  }
  days: Array<{ date: string; totalUsd: number | null }>
  unpricedCount: number
}

// Mirrors metering.ts's utcDateString exactly so day-bucketing here matches
// the .scispark/usage/<date>.jsonl file naming the records were read from.
function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Pure summary over a usage ledger. No Date.now() — `now` is the sole source
 * of "today"/"the window end", so this is fully deterministic given its inputs.
 */
export function summarizeUsage(
  records: UsageRecord[],
  now: Date,
  opts?: { days?: number },
): UsageSummary {
  const numDays = opts?.days ?? 7
  const todayDate = utcDateString(now)

  // Fixed-length zero-filled series, oldest -> newest, ending on today.
  const dayTotals = new Map<string, number | null>()
  const orderedDates: string[] = []
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = utcDateString(d)
    orderedDates.push(dateStr)
    dayTotals.set(dateStr, 0)
  }

  const todaySkillTotals = new Map<string, number | null>()
  let todayTotalUsd: number | null = 0
  // unpricedCount is scoped to ALL records passed in, not just those that
  // fall inside the `days` window: it's a data-quality signal ("how much of
  // the ledger I was handed has no cost"), independent of how much history
  // we're charting. Callers that want it window-scoped should pre-filter
  // `records` before calling in.
  let unpricedCount = 0

  for (const r of records) {
    if (r.costUsd == null) unpricedCount++
    const costUsd = typeof r.costUsd === "number" && Number.isFinite(r.costUsd) ? r.costUsd : null
    const dateStr = utcDateString(new Date(r.ts))

    if (dayTotals.has(dateStr)) {
      dayTotals.set(dateStr, addCosts(dayTotals.get(dateStr) ?? null, costUsd))
    }

    if (dateStr === todayDate) {
      todayTotalUsd = addCosts(todayTotalUsd, costUsd)
      todaySkillTotals.set(r.skill, addCosts(todaySkillTotals.has(r.skill) ? todaySkillTotals.get(r.skill)! : 0, costUsd))
    }
  }

  const bySkill = Array.from(todaySkillTotals.entries())
    .map(([skill, totalUsd]) => ({ skill, totalUsd }))
    .sort((a, b) => (b.totalUsd ?? -1) - (a.totalUsd ?? -1))

  return {
    today: { totalUsd: todayTotalUsd, bySkill },
    days: orderedDates.map((date) => ({ date, totalUsd: dayTotals.get(date)! })),
    unpricedCount,
  }
}

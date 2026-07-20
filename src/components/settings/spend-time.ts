/**
 * Pure "relative time" formatter for the spend panel's recent-runs list
 * (Task 5). Takes an explicit `now` (defaulting to the real clock at call
 * time) rather than reading `Date.now()` internally, so it's deterministic
 * and directly unit-testable — mirrors the `now` parameter already used by
 * `summarizeUsage` (src/lib/llm/usage-summary.ts) for the same reason.
 * Extracted into its own module rather than a chart, since it's a single
 * pure string function reused by RecentRunsList render tests without
 * pulling in the rest of SpendPanel.tsx.
 */
export function relativeTime(ts: string, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - new Date(ts).getTime())
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 45) return "just now"
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 45) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.round(diffHour / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  const diffMonth = Math.round(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}mo ago`
  const diffYear = Math.round(diffMonth / 12)
  return `${diffYear}y ago`
}

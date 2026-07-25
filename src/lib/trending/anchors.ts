import type { TopicGroupFn } from "../papers/node-search"

/**
 * A broad OpenAlex discipline (e.g. "Neuroscience") that a user's narrow,
 * hand-written interest label rolls up to. SP4 scopes the trending
 * leaderboard to these anchors instead of the literal interest labels, which
 * Tong found "too narrow / badly chosen" as direct search queries.
 */
export interface AnchorDiscipline {
  id: string
  label: string
}

/** Upper bound on how many anchor disciplines the leaderboard scopes to. */
export const MAX_ANCHORS = 3

/**
 * Rolls a user's narrow interest labels up to their broad parent
 * disciplines. For each label, issues one `fieldGroupFn` call and takes the
 * highest-count field entry (the modal field for that label's recent
 * OpenAlex works). Counts are then summed per field id across all labels,
 * sorted by summed count desc (tie-broken by label asc), and capped at
 * `MAX_ANCHORS`.
 *
 * A label whose lookup throws or returns no entries contributes nothing and
 * never fails the whole derivation — only every label failing yields `[]`,
 * which is the caller's cue to fall back to some other scoping.
 */
export async function deriveAnchorDisciplines(
  labels: string[],
  fieldGroupFn: TopicGroupFn,
  window: { fromDate: string; toDate: string },
): Promise<AnchorDiscipline[]> {
  if (labels.length === 0) return []

  const modalFields = await Promise.all(
    labels.map(async (label) => {
      try {
        const entries = await fieldGroupFn({ query: label, fromDate: window.fromDate, toDate: window.toDate })
        if (entries.length === 0) return null
        return entries.reduce((best, entry) => (entry.count > best.count ? entry : best))
      } catch {
        return null
      }
    }),
  )

  const totals = new Map<string, { label: string; count: number }>()
  for (const field of modalFields) {
    if (!field) continue
    const existing = totals.get(field.key)
    if (existing) {
      existing.count += field.count
    } else {
      totals.set(field.key, { label: field.label, count: field.count })
    }
  }

  return [...totals.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_ANCHORS)
    .map(([id, { label }]) => ({ id, label }))
}

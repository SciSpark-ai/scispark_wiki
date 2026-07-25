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

/** An OpenAlex field key: "https://openalex.org/fields/17", "fields/17" or "17". */
const OPENALEX_FIELD_ID = /^(?:https?:\/\/openalex\.org\/)?(?:fields\/)?\d+$/i

/**
 * The anchor's id as an OpenAlex `primary_topic.field.id` value, or undefined
 * when it isn't one.
 *
 * A DERIVED anchor's id is a real field key (it comes straight from
 * `group_by=primary_topic.field.id`), so requests for that discipline can be
 * filtered by entity. The FALLBACK anchors built when derivation fails carry
 * the user's interest SLUG instead (see dashboard.ts's `resolveAnchors`), which
 * would be a nonsense filter value — those callers fall back to text scoping.
 */
export function openAlexFieldId(anchor: AnchorDiscipline): string | undefined {
  return OPENALEX_FIELD_ID.test(anchor.id.trim()) ? anchor.id.trim() : undefined
}

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

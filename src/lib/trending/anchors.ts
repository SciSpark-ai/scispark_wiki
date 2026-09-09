import type { TopicGroupFn } from "../papers/node-search"
import { canonicalAnchor } from "./openalex-fields"
import { openAlexSubfield } from "./openalex-subfields"

/**
 * A broad OpenAlex discipline (e.g. "Neuroscience") that a user's narrow,
 * hand-written interest label rolls up to. SP4 scopes the trending
 * leaderboard to these anchors instead of the literal interest labels, which
 * Tong found "too narrow / badly chosen" as direct search queries.
 */
export interface AnchorDiscipline {
  id: string
  label: string
  /** Optional subset of this field. Empty/omitted means the entire field. */
  subfieldIds?: string[]
}

/** Upper bound on how many anchor disciplines the leaderboard scopes to. */
export const MAX_ANCHORS = 3
export const MAX_ANCHOR_LABEL_LENGTH = 120

/** Legacy identity helper for compatibility fixtures; no longer a valid scope. */
export function customAnchor(label: string): AnchorDiscipline {
  const cleaned = label.trim().replace(/\s+/g, " ")
  return { id: `custom:${encodeURIComponent(cleaned.normalize("NFKC").toLowerCase())}`, label: cleaned }
}

/** Validate all selections, including automatic ones, against the catalog. */
export function manualAnchorError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null
  const anchors = "anchors" in raw ? raw.anchors : undefined
  const manual = "anchorsOverridden" in raw && raw.anchorsOverridden === true
  if (anchors === undefined && !manual) return null
  if (!Array.isArray(anchors) || (manual && !anchors.length) || anchors.length > MAX_ANCHORS) return `Choose 1–${MAX_ANCHORS} general fields from OpenAlex.`
  const ids = new Set<string>()
  for (const anchor of anchors) {
    const field = anchor && typeof anchor === "object" && typeof anchor.id === "string" ? canonicalAnchor(anchor.id) : undefined
    if (!field) return "Replace custom topics with official OpenAlex fields in Settings → Trending fields."
    if (ids.has(field.id)) return "Each general field must be different."
    ids.add(field.id)
    if (anchor.subfieldIds !== undefined) {
      if (!Array.isArray(anchor.subfieldIds)) return "Choose valid subfields within each general field."
      const children = new Set<string>()
      for (const id of anchor.subfieldIds) {
        const subfield = typeof id === "string" ? openAlexSubfield(id) : undefined
        if (!subfield || subfield.fieldId !== field.id) return "Choose subfields that belong to their selected general field."
        if (children.has(subfield.id)) return "Each subfield must be different."
        children.add(subfield.id)
      }
    }
  }
  return null
}

/**
 * The anchor's id as an OpenAlex `primary_topic.field.id` value, or undefined
 * when it isn't one.
 *
 * Both selected and derived anchors must resolve to the bundled catalog.
 * Unknown legacy IDs require user review, never fallback text scoping.
 */
export function openAlexFieldId(anchor: AnchorDiscipline): string | undefined {
  return canonicalAnchor(anchor.id)?.id
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
 * which is the caller's cue to ask the user to choose official fields.
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
        const entries = (await fieldGroupFn({ query: label, fromDate: window.fromDate, toDate: window.toDate }))
          .flatMap((entry) => {
            const field = canonicalAnchor(entry.key)
            return field ? [{ ...entry, key: field.id, label: field.label }] : []
          })
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
    .flatMap(([id]) => { const field = canonicalAnchor(id); return field ? [field] : [] })
}

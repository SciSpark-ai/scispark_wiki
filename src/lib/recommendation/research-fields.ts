import type { TrendingSettings } from "../trending/settings"
import { manualAnchorError } from "../trending/anchors"
import { canonicalAnchor } from "../trending/openalex-fields"
import { openAlexSubfield } from "../trending/openalex-subfields"
import type { ResearchFieldPreference } from "./contract"
import type { SourceId } from "../papers/types"
import type { FeedStrategy } from "../skills/feed-cache"

/** Pure bridge from the shared taxonomy selection to soft Feed preferences.
 * Automatic Trending derivation is not an additional user-declared interest.
 * Invalid subsets are never silently expanded into the whole parent field.
 */
export function feedResearchFields(settings: Pick<TrendingSettings, "anchors" | "anchorsOverridden">): {
  fields: ResearchFieldPreference[]; warning?: string
} {
  if (!settings.anchorsOverridden) return { fields: [] }
  if (manualAnchorError(settings)) return {
    fields: [],
    warning: "Your saved research fields need review in Settings → Trending fields. This feed used your profile and feedback instead.",
  }
  return { fields: settings.anchors.map((anchor) => ({
    ...canonicalAnchor(anchor.id)!,
    subfields: (anchor.subfieldIds ?? []).map((id) => {
      const subfield = openAlexSubfield(id)!
      return { id: subfield.id, label: subfield.label }
    }),
  })) }
}

/** Only selected leaves are preference labels; narrowed parents provide context. */
export function researchFieldTopics(fields: ResearchFieldPreference[]): string[] {
  return fields.flatMap((field) => field.subfields.length
    ? field.subfields.map((subfield) => subfield.label.toLowerCase())
    : [field.label.toLowerCase()])
}

/** Bounded fallback covers profile interests and selected fields before repeating
 * a group. Rotate sources so one topic cannot consume the entire query budget.
 */
export function researchFieldFallback(
  profileTopics: string[], fields: ResearchFieldPreference[], sources: SourceId[],
): FeedStrategy {
  const groups = [profileTopics, ...fields.map((field) => researchFieldTopics([field]))]
  const topics: string[] = []
  for (let row = 0; row < Math.max(0, ...groups.map((group) => group.length)) && topics.length < 4; row++) {
    for (const group of groups) {
      const topic = group[row]
      if (topic && !topics.includes(topic)) topics.push(topic)
      if (topics.length === 4) break
    }
  }
  const queries: FeedStrategy["queries"] = []
  for (let round = 0; round < sources.length && queries.length < 8; round++) {
    for (const [index, query] of topics.entries()) {
      queries.push({ source: sources[(index + round) % sources.length], query, rationale: "Saved research interest; planning fallback" })
      if (queries.length === 8) break
    }
  }
  return { queries }
}

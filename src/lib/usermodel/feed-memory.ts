import type { FeedbackEntry, PreferenceFacet, RecommendationPreferences } from "../recommendation/contract"

export interface FeedbackPreference {
  facet: PreferenceFacet
  effect: "boost" | "reduce" | "freshness" | "interpret_note"
  scope: "related_papers"
  horizon: "current"
}

/** Structured policy derived from the user's reason, never from a model guess.
 * The paper snapshot and verbatim note remain the evidence for its actual value.
 * No duplicate preference file: Undo/reset takes effect on the next read. */
export function feedbackPreference(reason: FeedbackEntry["reason"]): FeedbackPreference | null {
  const policy = {
    more_like_this: { facet: "example", effect: "boost" },
    less_like_this: { facet: "example", effect: "reduce" },
    not_my_topic: { facet: "topic", effect: "reduce" },
    wrong_method: { facet: "approach", effect: "reduce" },
    too_old: { facet: "recency", effect: "freshness" },
    other: { facet: "custom", effect: "interpret_note" },
  } as const
  if (reason === "dismiss" || reason === "already_know") return null
  return { ...policy[reason], scope: "related_papers", horizon: "current" }
}

export interface FeedPreferenceMemory {
  paperKey: string; title: string; abstract: string; topics: string[]
  reason: FeedbackEntry["reason"]; note: string; guidance: string; at: string
  preference: FeedbackPreference
}

const GUIDANCE: Record<FeedbackEntry["reason"], string> = {
  more_like_this: "Seek similar research questions, methods or applications. This positive example can establish interests not named at onboarding.",
  less_like_this: "Recommend fewer close matches. No reason was given: do not infer dislike of the whole discipline, venue or all methods.",
  not_my_topic: "Reduce close topical matches, not the entire declared research field.",
  wrong_method: "Reduce matches using the same evidenced method in this context, not the topic itself. Do not guess an unknown method.",
  too_old: "Favor more recent work on this subject. This is not negative topic evidence.",
  already_know: "Suppress this exact paper only. Knowing it does not imply dislike of similar research.",
  other: "Use only the preference explicitly described in the note. Do not invent a reason or generalize unrelated attributes.",
  dismiss: "Suppress this exact paper only; there is no preference inference.",
}
// Keep research abbreviations such as EEG, MRI and AI. Stop words must not crowd
// specific research terms out of the small memory context.
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "study", "paper", "of", "in", "on", "to", "an", "is", "are", "a"])
const terms = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((word) => !STOP.has(word)))

/** Feed-specific user memory reconstructed from canonical, undoable feedback.
 * No duplicate summary file, clicks or generated explanations. One vote is usable
 * immediately. This is lexical retrieval, not an embedding index. */
export function selectFeedPreferenceMemory(entries: FeedbackEntry[], preferences: RecommendationPreferences, now: Date, context = ""): FeedPreferenceMemory[] {
  if (!preferences.learnFromFeedback) return []
  const latest = new Map<string, FeedbackEntry>()
  for (const entry of entries) {
    const at = Date.parse(entry.at)
    if (!Number.isFinite(at) || at > now.getTime() || (preferences.resetAt && at <= Date.parse(preferences.resetAt))) continue
    if (now.getTime() - at > 180 * 86_400_000) continue
    if (!latest.has(entry.paperKey) || Date.parse(latest.get(entry.paperKey)!.at) <= at) latest.set(entry.paperKey, entry)
  }
  const query = terms(context)
  const candidates = [...latest.values()].filter((entry) => entry.reason !== "dismiss" && entry.reason !== "already_know")
  const relevance = (entry: FeedbackEntry) => {
    const overlap = [...terms(`${entry.title} ${entry.abstract ?? ""} ${entry.topics.join(" ")} ${entry.fields?.join(" ") ?? ""} ${entry.note ?? ""}`)].filter((word) => query.has(word)).length
    return Math.min(overlap, 8) + 2 ** (-(now.getTime() - Date.parse(entry.at)) / 86_400_000 / 30)
  }
  candidates.sort((a, b) => relevance(b) - relevance(a) || b.at.localeCompare(a.at) || a.paperKey.localeCompare(b.paperKey))
  const positive = candidates.filter((entry) => entry.reason === "more_like_this")
  const negative = candidates.filter((entry) => entry.reason !== "more_like_this")
  const selected: FeedPreferenceMemory[] = []
  let size = 2 // JSON array brackets, plus one comma between records below.
  // Alternate signs so a burst of dislikes cannot crowd out a separate interest.
  for (let row = 0; row < Math.max(positive.length, negative.length) && selected.length < 24; row++) {
    for (const entry of [positive[row], negative[row]]) {
      if (!entry || selected.length >= 24) continue
      const preference = feedbackPreference(entry.reason)
      if (!preference) continue
      const memory: FeedPreferenceMemory = { paperKey: entry.paperKey, title: entry.title, abstract: entry.abstract?.slice(0, 1000) ?? "",
        topics: [...new Set([...entry.topics, ...(entry.fields ?? [])])].slice(0, 20), reason: entry.reason,
        note: entry.note ?? "", guidance: GUIDANCE[entry.reason], at: entry.at, preference }
      const length = JSON.stringify(memory).length + (selected.length ? 1 : 0)
      if (size + length > 18_000) continue
      selected.push(memory)
      size += length
    }
  }
  return selected
}

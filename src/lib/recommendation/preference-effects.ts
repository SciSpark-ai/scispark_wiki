import type { MemoryEffect, MemoryMatch } from "./contract"
import type { FeedPreferenceMemory } from "../usermodel/feed-memory"

const fold = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()
const supported = (quote: string, texts: string[]) => quote.trim().length >= 8 && texts.some((text) => fold(text).includes(fold(quote)))
export const FEEDBACK_LIMIT = 20
export const feedbackDecay = (at: string, now: Date) => {
  const age = (now.getTime() - Date.parse(at)) / 86_400_000
  return Number.isFinite(age) && age >= 0 && age <= 180 ? 2 ** (-age / 30) : 0
}

/** The AI proposes semantic matches. Code owns reason semantics, grounding,
 * independent-example counting, decay and score magnitude. Quotes establish
 * provenance, not proof that the proposed semantic relationship is correct. */
export function preferenceEffects(matches: MemoryMatch[], memories: FeedPreferenceMemory[], text: string, now: Date) {
  const effects: MemoryEffect[] = []
  let freshnessStrength = 0
  let freshnessPaperKey: string | undefined
  const seen = new Set<string>()
  let rejected = 0
  for (const match of matches) {
    const memory = memories.find((entry) => entry.paperKey === match.paperKey)
    if (!memory || seen.has(match.paperKey)) { rejected++; continue }
    const policy = memory.preference
    const custom = policy.facet === "custom"
    const validPolicy = custom
      ? Boolean(memory.note.trim())
      : match.facet === policy.facet && match.effect === policy.effect
    if (!validPolicy || (match.effect === "freshness") !== (match.facet === "recency") ||
      !supported(match.candidateEvidence, [text]) ||
      !supported(match.memoryEvidence, custom ? [memory.note] : [memory.title, memory.abstract, memory.note])) {
      rejected++; continue
    }
    const strength = feedbackDecay(memory.at, now) * (match.match === "close" ? 1 : .5)
    if (!strength) { rejected++; continue }
    seen.add(match.paperKey)
    // A bare dislike has lower confidence than a specified reason. One explicit
    // example still affects the next feed immediately; no two-vote prerequisite.
    const points = (memory.reason === "less_like_this" ? 4 : 8) * strength
    effects.push({ ...match, at: memory.at, reason: memory.reason,
      adjustment: match.effect === "freshness" ? 0 : points * (match.effect === "boost" ? 1 : -1) })
    // Freshness feedback narrows only this matched subject, never the whole feed.
    // Multiple age votes do not compound into an ever-shrinking time window.
    if (match.effect === "freshness" && strength > freshnessStrength) {
      freshnessStrength = strength
      freshnessPaperKey = memory.paperKey
    }
  }
  return { effects, rejected, freshnessStrength, freshnessPaperKey }
}

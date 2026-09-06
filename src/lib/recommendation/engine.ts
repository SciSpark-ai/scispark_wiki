import { mergeRecords, paperKey, type PaperRecord } from "../papers/types"
import type { FeedPreferenceMemory } from "../usermodel/feed-memory"
import { FEEDBACK_LIMIT, preferenceEffects } from "./preference-effects"
import type { SearchFn, FeedStrategy } from "../skills/feed"
import {
  AssessmentSchema, VenueSignalSchema, RECOMMENDATION_VERSION,
  type Assessment, type FeedbackEntry, type RecommendationPreferences,
  type RecommendationRun, type ScoreBreakdown, type VenueSignal,
} from "./contract"

export const WEIGHTS = { relevance: 70, recency: 20, venue: 10 } as const
const DAY = 86_400_000
const fold = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()
const round = (value: number) => Math.round(value * 10) / 10
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))

export interface RecommendationContext {
  text: string
  topics: string[]
  hasQuestion: boolean
  hasApproach: boolean
  memories?: FeedPreferenceMemory[]
}
export interface Candidate {
  paper: PaperRecord
  sources: string[]
  queries: string[]
}
export interface RecommendedPaper extends Candidate { ranking: ScoreBreakdown }

/** Exact source dates only; an impossible date must never earn a freshness bonus. */
export function publicationDate(paper: PaperRecord): string | null {
  const date = paper.date?.slice(0, 10)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : null
}

export function recencyScore(paper: PaperRecord, now: Date, halfLifeDays = 14): number | null {
  const date = publicationDate(paper)
  if (!date || date > now.toISOString().slice(0, 10)) return null
  return round(100 * 2 ** (-(now.getTime() - Date.parse(`${date}T00:00:00Z`)) / DAY / Math.max(7, Math.min(14, halfLifeDays))))
}

/** No embeddings or learned model: exact alias joins, with normalized-title fallback
 * only when at least one side lacks a DOI. Conflicting DOIs must not be conflated. */
function sameWork(a: PaperRecord, b: PaperRecord): boolean {
  if (a.ids.doi && b.ids.doi && fold(a.ids.doi) !== fold(b.ids.doi)) return false
  if (paperKey(a) === paperKey(b)) return true
  for (const kind of ["doi", "arxiv", "pmid", "s2", "openalex"] as const) {
    if (a.ids[kind] && b.ids[kind] && fold(a.ids[kind]!) === fold(b.ids[kind]!)) return true
  }
  return !(a.ids.doi && b.ids.doi) && fold(a.title) === fold(b.title)
}

export function interleaveCandidates(groups: Candidate[][], excluded: Set<string>): Candidate[] {
  const result: Candidate[] = []
  for (let row = 0; row < Math.max(0, ...groups.map((group) => group.length)); row++) {
    for (const group of groups) {
      const candidate = group[row]
      if (!candidate) continue
      const existing = result.find((entry) => sameWork(entry.paper, candidate.paper))
      if (existing) {
        const oldDate = publicationDate(existing.paper)
        const newDate = publicationDate(candidate.paper)
        existing.paper = mergeRecords(existing.paper, candidate.paper)
        if (oldDate && newDate) existing.paper.date = oldDate < newDate ? oldDate : newDate
        existing.sources = [...new Set([...existing.sources, ...candidate.sources])]
        existing.queries = [...new Set([...existing.queries, ...candidate.queries])]
      } else result.push({ ...candidate, paper: { ...candidate.paper } })
    }
  }
  return result.filter(({ paper }) => {
    const aliases = Object.entries(paper.ids).map(([kind, id]) => `${kind}:${fold(id!)}`)
    return ![paperKey(paper), ...aliases, `title:${fold(paper.title)}`].some((key) => excluded.has(key))
  })
}

/** One latest vote per paper; repeated clicking cannot manufacture evidence.
 * At least two different papers per topic; 30-day decay; total influence <=5 points. */
export function learnTopicAdjustments(entries: FeedbackEntry[], preferences: RecommendationPreferences, now: Date): RecommendationRun["learnedTopics"] {
  if (!preferences.learnFromFeedback) return []
  const latest = new Map<string, FeedbackEntry>()
  for (const entry of entries) {
    if (entry.at > now.toISOString() || (preferences.resetAt && entry.at <= preferences.resetAt)) continue
    if (!latest.has(entry.paperKey) || latest.get(entry.paperKey)!.at <= entry.at) latest.set(entry.paperKey, entry)
  }
  const topics = new Map<string, { sum: number; examples: number }>()
  for (const entry of latest.values()) {
    const direction = entry.reason === "more_like_this" ? 1 : entry.reason === "not_my_topic" ? -1 : 0
    if (!direction) continue
    const age = (now.getTime() - Date.parse(entry.at)) / DAY
    if (age > 180) continue
    for (const topic of new Set(entry.topics.map(fold))) {
      const previous = topics.get(topic) ?? { sum: 0, examples: 0 }
      topics.set(topic, { sum: previous.sum + direction * 2 ** (-age / 30), examples: previous.examples + 1 })
    }
  }
  return [...topics].filter(([, value]) => value.examples >= 2)
    .map(([topic, value]) => ({ topic, adjustment: round(clamp(value.sum * 2, 5)), examples: value.examples }))
    .sort((a, b) => a.topic.localeCompare(b.topic))
}

export function candidateText(paper: PaperRecord): string {
  return `${paper.title}\n${paper.abstract?.slice(0, 2000) ?? ""}`
}

export function scoreCandidate(
  candidate: Candidate, raw: Assessment, context: RecommendationContext,
  learned: RecommendationRun["learnedTopics"], now: Date, rawVenue?: VenueSignal,
): RecommendedPaper | null {
  const parsed = AssessmentSchema.safeParse(raw)
  if (!parsed.success || parsed.data.excluded) return null
  const assessment = structuredClone(parsed.data)
  const sourceText = fold(candidateText(candidate.paper))
  const supported = (evidence: string) => evidence.trim().length >= 8 && sourceText.includes(fold(evidence))
  let numerator = 0
  let denominator = 0
  for (const [dimension, weight, applicable] of [
    ["question", 50, context.hasQuestion], ["topic", 30, true], ["approach", 20, context.hasApproach],
  ] as const) {
    const score = assessment[dimension]
    if (!applicable) { score.grade = null; score.evidence = ""; continue }
    // Missing/unsupported evidence is not silently renormalized into a high score.
    if (score.grade === null || (score.grade > 0 && !supported(score.evidence))) score.grade = 0
    numerator += (score.grade / 4) * weight
    denominator += weight
  }
  const relevance = round(numerator / denominator * 100)
  if (relevance < 50) return null
  const matchedTopics = [...new Set(assessment.matches.filter((match) =>
    context.topics.some((topic) => fold(topic) === fold(match.topic)) && supported(match.evidence),
  ).map((match) => fold(match.topic)))]
  assessment.matches = assessment.matches.filter((match) => matchedTopics.includes(fold(match.topic)) && supported(match.evidence))
  const effects = preferenceEffects(assessment.memoryMatches ?? [], context.memories ?? [], candidateText(candidate.paper), now)
  // Keep the old helper usable for callers with no memory contract. The live
  // v2 pipeline never stacks its old topic bonus onto evidence-backed effects.
  const adjustments = context.memories === undefined ? learned.filter((entry) => matchedTopics.includes(entry.topic)).map((entry) => entry.adjustment) : []
  const legacyAdjustment = adjustments.length ? clamp(adjustments.reduce((a, b) => a + b, 0) / adjustments.length, 5) : 0
  const rawAdjustment = effects.effects.filter((effect) => effect.effect !== "freshness").reduce((sum, effect) => sum + effect.adjustment, 0)
  const cappedAdjustment = clamp(rawAdjustment, FEEDBACK_LIMIT)
  const feedbackAdjustment = round(cappedAdjustment + legacyAdjustment)
  const parsedVenue = VenueSignalSchema.safeParse(rawVenue)
  const venue = parsedVenue.success && parsedVenue.data.year <= now.getUTCFullYear() ? parsedVenue.data : null
  const baselineRecency = recencyScore(candidate.paper, now)
  const recencyHalfLifeDays = baselineRecency === null ? 14 : round(14 / (1 + effects.freshnessStrength))
  const recency = recencyScore(candidate.paper, now, recencyHalfLifeDays)
  const memoryEffects = effects.effects.filter((effect) => effect.effect !== "freshness" || baselineRecency !== null).map((effect) => ({ ...effect,
    adjustment: round(effect.effect === "freshness"
      ? effect.paperKey === effects.freshnessPaperKey ? ((recency ?? 0) - (recencyScore(candidate.paper, now) ?? 0)) * .2 : 0
      : effect.adjustment * (rawAdjustment ? cappedAdjustment / rawAdjustment : 1)),
  }))
  // Allocate the final rounding tenth to the last non-freshness effect so the
  // visible contributions sum exactly to the displayed feedback adjustment.
  const scoredEffects = memoryEffects.filter((effect) => effect.effect !== "freshness")
  if (scoredEffects.length) {
    const preceding = scoredEffects.slice(0, -1).reduce((sum, effect) => sum + effect.adjustment, 0)
    scoredEffects[scoredEffects.length - 1].adjustment = round(feedbackAdjustment - preceding)
  }
  // Never persist rejected model matches as if they were applied preferences.
  if (assessment.memoryMatches) assessment.memoryMatches = memoryEffects.map(({ paperKey, facet, effect, match, candidateEvidence, memoryEvidence }) => ({ paperKey, facet, effect, match, candidateEvidence, memoryEvidence }))
  const total = round(Math.max(0, Math.min(100, relevance * .7 + (recency ?? 0) * .2 + (venue?.score ?? 50) * .1 + feedbackAdjustment)))
  return { ...candidate, ranking: {
    version: RECOMMENDATION_VERSION, relevance, recency, venue, feedbackAdjustment, total, assessment,
    memoryEffects, recencyHalfLifeDays,
    matchedTopics, confidence: candidate.paper.abstract ? "abstract" : "title-only",
    dateStatus: recency === null ? "unknown" : publicationDate(candidate.paper)! >= new Date(now.getTime() - 14 * DAY).toISOString().slice(0, 10) ? "recent" : "older",
    sources: candidate.sources, queries: candidate.queries,
  } }
}

function similarity(a: RecommendedPaper, b: RecommendedPaper): number {
  const tokens = (paper: RecommendedPaper) => new Set(fold(paper.paper.title).match(/[\p{L}\p{N}]{4,}/gu) ?? [])
  const x = tokens(a), y = tokens(b)
  const overlap = [...x].filter((word) => y.has(word)).length
  const lexical = overlap / Math.max(1, x.size + y.size - overlap)
  const topicOverlap = a.ranking.matchedTopics.some((topic) => b.ranking.matchedTopics.includes(topic))
  return Math.max(lexical, topicOverlap ? .6 : 0)
}

/** Greedy MMR-style selection. Stable ties; no model can override the score order.
 * Date buckets stay separate; diversification cannot promote older papers into "recent". */
export function selectRecommendations(items: RecommendedPaper[], preferences: RecommendationPreferences, limit = 12): RecommendedPaper[] {
  const penalty = { focused: 3, balanced: 10, exploratory: 18 }[preferences.diversity]
  const selected: RecommendedPaper[] = []
  for (const status of ["recent", "older", "unknown"] as const) {
    const remaining = items.filter((item) => item.ranking.dateStatus === status)
    while (remaining.length && selected.length < limit) {
      const value = (item: RecommendedPaper) => (item.ranking.total ?? 0) - penalty * Math.max(0, ...selected.map((chosen) => similarity(item, chosen)))
      remaining.sort((a, b) => value(b) - value(a) || paperKey(a.paper).localeCompare(paperKey(b.paper)))
      selected.push(remaining.shift()!)
    }
  }
  return selected
}

export async function withDeadline<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Source timed out")), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

/** Reusable, storage-free retrieval stage. A source adapter must throw on failure,
 * and preserve the requested source; adapters that swallow errors lose diagnostics. */
export async function retrieveRecommendationCandidates(
  strategy: FeedStrategy, search: SearchFn, excluded: Set<string>, now: Date,
  opts: { cap?: number; timeoutMs?: number } = {},
): Promise<{ candidates: Candidate[]; retrieval: RecommendationRun["retrieval"]; olderFromDate: string | null }> {
  const fromDate = new Date(now.getTime() - 14 * DAY).toISOString().slice(0, 10)
  const toDate = now.toISOString().slice(0, 10)
  const retrieval: RecommendationRun["retrieval"] = []
  const run = async (from: string): Promise<Candidate[]> => {
    const groups = await Promise.all(strategy.queries.map(async (query) => {
      const trace: RecommendationRun["retrieval"][number] = { source: query.source, query: query.query, fromDate: from, count: 0 }
      retrieval.push(trace)
      try {
        const papers = await withDeadline(search(query.source, query.query, 25, { fromDate: from, sort: "relevance" }), opts.timeoutMs ?? 20_000)
        const eligible = papers.filter((paper) => {
          const date = publicationDate(paper)
          // Unknown dates remain inspectable, never described as inside the window.
          if (date) return date >= from && date <= toDate
          const year = paper.year ?? Number(paper.date?.slice(0, 4))
          return !year || (year >= Number(from.slice(0, 4)) && year <= now.getUTCFullYear())
        })
        trace.count = eligible.length
        return eligible.map((paper) => ({ paper, sources: [query.source], queries: [query.query] }))
      } catch {
        // Do not expose arbitrary adapter errors: URLs can include data-source keys.
        trace.error = "Source unavailable or timed out"
        return []
      }
    }))
    return interleaveCandidates(groups, excluded)
  }
  let candidates = await run(fromDate)
  let olderFromDate: string | null = null
  if (candidates.filter(({ paper }) => publicationDate(paper)).length < 10) {
    olderFromDate = new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10)
    candidates = interleaveCandidates([candidates, await run(olderFromDate)], excluded)
  }
  // Keep actual recent work ahead of older/undated fallback before the bounded AI pass.
  candidates.sort((a, b) => {
    const bucket = (c: Candidate) => !publicationDate(c.paper) ? 2 : publicationDate(c.paper)! >= fromDate ? 0 : 1
    return bucket(a) - bucket(b)
  })
  return { candidates: candidates.slice(0, opts.cap ?? 50), retrieval, olderFromDate }
}

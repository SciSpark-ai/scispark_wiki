import { z } from "zod"

export const RECOMMENDATION_VERSION = "weighted-v2"
const RecommendationVersionSchema = z.enum(["weighted-v1", RECOMMENDATION_VERSION])
export const RecommendationPreferencesSchema = z.object({
  diversity: z.enum(["focused", "balanced", "exploratory"]).default("balanced"),
  learnFromFeedback: z.boolean().default(true),
  resetAt: z.string().datetime().nullable().default(null),
}).strict()
export type RecommendationPreferences = z.infer<typeof RecommendationPreferencesSchema>
export const DEFAULT_RECOMMENDATION_PREFERENCES = RecommendationPreferencesSchema.parse({})

export const FeedbackReasonSchema = z.enum(["more_like_this", "less_like_this", "not_my_topic", "wrong_method", "too_old", "already_know", "other", "dismiss"])
export type FeedbackReason = z.infer<typeof FeedbackReasonSchema>
export const FEEDBACK_LABELS: Record<FeedbackReason, string> = {
  more_like_this: "More like this", less_like_this: "Less like this", not_my_topic: "Not my topic",
  wrong_method: "Not the method I need", too_old: "Too old", other: "Something else",
  already_know: "Already read this", dismiss: "Dismiss",
}
export const FeedbackEntrySchema = z.object({
  paperKey: z.string().min(1).max(500), title: z.string().max(2000),
  topics: z.array(z.string().min(1).max(200)).max(20),
  reason: FeedbackReasonSchema, at: z.string().datetime(),
  note: z.string().max(600).optional(),
  abstract: z.string().max(2000).optional(),
  fields: z.array(z.string().max(200)).max(20).optional(),
  publicationDate: z.string().max(30).optional(),
}).strict()
export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>
export const FeedbackRecordSchema = z.object({ version: z.literal(1), entries: z.array(FeedbackEntrySchema).max(2000) }).strict()
export const FEEDBACK_PATH = "profile/recommendation-feedback.json"

export const VenueSignalSchema = z.object({
  score: z.number().min(0).max(100),
  source: z.string().min(1).max(200), metric: z.string().min(1).max(200),
  year: z.number().int().min(1900).max(2200),
  cohort: z.string().min(1).max(300), url: z.string().url().refine((url) => /^https?:\/\//.test(url)),
}).strict()
export type VenueSignal = z.infer<typeof VenueSignalSchema>

const GradeSchema = z.object({ grade: z.number().int().min(0).max(4).nullable(), evidence: z.string().max(400) }).strict()
export const PreferenceFacetSchema = z.enum(["example", "topic", "approach", "recency", "custom"])
export type PreferenceFacet = z.infer<typeof PreferenceFacetSchema>
export const MemoryMatchSchema = z.object({
  paperKey: z.string().min(1).max(500),
  facet: PreferenceFacetSchema,
  effect: z.enum(["boost", "reduce", "freshness"]),
  // The model identifies a semantic relation, never a numeric score or weight.
  match: z.enum(["close", "related"]),
  candidateEvidence: z.string().min(8).max(160),
  memoryEvidence: z.string().min(8).max(160),
}).strict()
export type MemoryMatch = z.infer<typeof MemoryMatchSchema>
export const MemoryEffectSchema = MemoryMatchSchema.extend({
  at: z.string().datetime(), reason: FeedbackReasonSchema,
  adjustment: z.number().min(-20).max(20),
}).strict()
export type MemoryEffect = z.infer<typeof MemoryEffectSchema>
export const AssessmentSchema = z.object({
  index: z.number().int().nonnegative(),
  question: GradeSchema, topic: GradeSchema, approach: GradeSchema,
  matches: z.array(z.object({ topic: z.string().max(200), evidence: z.string().max(400) }).strict()).max(8),
  excluded: z.boolean(),
  // Optional only for old caches/providers; absent is reported as unchecked.
  memoryMatches: z.array(MemoryMatchSchema).max(3).optional(),
}).strict()
export type Assessment = z.infer<typeof AssessmentSchema>
export const AssessmentsSchema = z.object({ assessments: z.array(AssessmentSchema).max(20) })

export const ScoreBreakdownSchema = z.object({
  version: RecommendationVersionSchema,
  relevance: z.number().min(0).max(100).nullable(),
  recency: z.number().min(0).max(100).nullable(),
  venue: VenueSignalSchema.nullable(),
  feedbackAdjustment: z.number().min(-20).max(20),
  memoryEffects: z.array(MemoryEffectSchema).max(3).optional(),
  recencyHalfLifeDays: z.number().min(7).max(14).optional(),
  total: z.number().min(0).max(100).nullable(),
  assessment: AssessmentSchema.nullable(),
  matchedTopics: z.array(z.string()).max(20),
  dateStatus: z.enum(["recent", "older", "unknown"]),
  confidence: z.enum(["abstract", "title-only", "unranked"]),
  sources: z.array(z.string()), queries: z.array(z.string()),
})
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>

export const RecommendationRunSchema = z.object({
  version: RecommendationVersionSchema, preferences: RecommendationPreferencesSchema,
  weights: z.object({ relevance: z.literal(70), recency: z.literal(20), venue: z.literal(10) }),
  fromDate: z.string(), toDate: z.string(), olderFromDate: z.string().nullable(),
  warnings: z.array(z.string()),
  retrieval: z.array(z.object({ source: z.string(), query: z.string(), fromDate: z.string().optional(), count: z.number(), error: z.string().optional() })),
  learnedTopics: z.array(z.object({ topic: z.string(), adjustment: z.number(), examples: z.number() })),
  status: z.enum(["ranked", "unranked"]),
  // Planning plus up to five ten-paper assessment batches, 24 memories each.
  memoryPaperKeys: z.array(z.string()).max(144).optional(),
  memoryStatus: z.enum(["off", "none", "checked", "incomplete"]).optional(),
})
export type RecommendationRun = z.infer<typeof RecommendationRunSchema>

export function profileSection(markdown: string | null, heading: string): string {
  const lines = (markdown ?? "").split("\n")
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start < 0) return ""
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^##\s/.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim()
}

export function readRecommendationPreferences(profile: string | null): RecommendationPreferences {
  try {
    return RecommendationPreferencesSchema.parse(JSON.parse(profileSection(profile, "Recommendation settings")))
  } catch {
    return { ...DEFAULT_RECOMMENDATION_PREFERENCES }
  }
}

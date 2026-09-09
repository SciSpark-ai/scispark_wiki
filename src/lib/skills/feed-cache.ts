/** Browser-safe feed cache contract: no skills, provider SDKs or server runtime. */
import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { FeedResult } from "./feed"
import { ScoreBreakdownSchema, RecommendationRunSchema } from "../recommendation/contract"
import { feedExclusionReason } from "../papers/eligibility"
export type { FeedResult, FeedItem } from "./feed"
export const FEED_CACHE_PATH = ".scispark/feed/latest.json"

const StrategyQueriesSchema = z
  .array(
    z.object({
      source: z.enum(["arxiv", "openalex", "s2", "pubmed"]),
      query: z.string(),
      rationale: z.string(),
    }),
  )
  .min(1)
  .max(8)

export const StrategySchema = z.object({
  queries: StrategyQueriesSchema,
})

export type FeedStrategy = z.infer<typeof StrategySchema>

export const FEED_BADGE_VALUES = [
  "high-impact",
  "breakthrough",
  "new-method",
  "trending",
  "new-evidence",
  "review",
  "application",
  "dataset",
] as const

export type FeedBadge = (typeof FEED_BADGE_VALUES)[number]

/** Maps a model- or cache-supplied badge string onto the fixed vocabulary,
 * `undefined` for anything off-vocabulary — schema-loose + validate-in-code,
 * same pattern as the index validation elsewhere in this pipeline (a stray
 * badge must degrade one card's band, never fail the whole re-rank). */
export function normalizeFeedBadge(badge: string | undefined): FeedBadge | undefined {
  return (FEED_BADGE_VALUES as readonly string[]).includes(badge ?? "") ? (badge as FeedBadge) : undefined
}

const PaperIdsCacheSchema = z.object({
  doi: z.string().optional(),
  arxiv: z.string().optional(),
  openalex: z.string().optional(),
  s2: z.string().optional(),
  pmid: z.string().optional(),
})

const PaperAuthorCacheSchema = z.object({
  name: z.string(),
  openalexId: z.string().optional(),
})

const PaperRecordCacheSchema = z.object({
  publicationTypes: z.array(z.string()).optional(),
  isRetracted: z.boolean().optional(),
  ids: PaperIdsCacheSchema,
  title: z.string(),
  abstract: z.string().optional(),
  authors: z.array(PaperAuthorCacheSchema),
  year: z.number().optional(),
  date: z.string().optional(),
  venue: z.string().optional(),
  citationCount: z.number().optional(),
  oaUrl: z.string().optional(),
  pdfUrl: z.string().optional(),
  htmlUrl: z.string().optional(),
  fields: z.array(z.string()),
  source: z.enum(["arxiv", "openalex", "s2", "pubmed"]),
})

const FeedItemCacheSchema = z.object({
  ranking: ScoreBreakdownSchema.optional(),
  paper: PaperRecordCacheSchema,
  score: z.number(),
  whyThis: z.string(),
  whyYou: z.string(),
  whyNow: z.string(),
  // Optional: a cache written before tldr/tags/badge existed still validates (back-compat).
  tldr: z.string().optional(),
  tags: z.array(z.string()).optional(),
  badge: z.string().optional(),
})

const FeedResultCacheSchema = z.object({
  recommendation: RecommendationRunSchema.optional(),
  generatedAt: z.string(),
  items: z.array(FeedItemCacheSchema),
  costUsd: z.number(),
  strategy: StrategySchema,
  stats: z.object({ retrieved: z.number(), ranked: z.number() }),
})

/**
 * Loads and validates the cached `FeedResult` written by `runFeed`. A missing file, corrupt
 * JSON, or content that fails `FeedResultCacheSchema` validation all resolve to `null` rather
 * than throwing — callers treat "no usable cache" uniformly regardless of cause.
 */
export async function loadFeed(storage: VaultStorage): Promise<FeedResult | null> {
  const raw = await storage.read(FEED_CACHE_PATH)
  if (raw === null) return null

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return null
  }

  const result = FeedResultCacheSchema.safeParse(parsedJson)
  if (!result.success) return null
  // The cache schema accepts any badge string (see FeedItemCacheSchema);
  // re-normalize onto the fixed vocabulary here so consumers only ever see
  // a real FeedBadge (or none).
  return {
    ...result.data,
    items: result.data.items.filter((item) => !feedExclusionReason(item.paper)).map((item) => ({ ...item, badge: normalizeFeedBadge(item.badge) })),
  }
}

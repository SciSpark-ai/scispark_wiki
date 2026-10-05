import { z } from "zod"
import { slugifyTitle } from "../wiki/authoring"
import { PaperTextSchema } from "../papers/text-contract"

export const REVIEW_INTRO = "Manage your review and follow its progress below."
export const LEGACY_REVIEW_INTRO = "Here is the review brief. Adjust the scope or context, then start when you're ready. No research calls have started."

/** Isomorphic storage contract: validate rich history before rendering it. */
export const PaperSnapshotSchema = z.object({
  ids: z.object({ doi: z.string().optional(), arxiv: z.string().optional(), openalex: z.string().optional(), s2: z.string().optional(), pmid: z.string().optional() }),
  title: z.string(), abstract: z.string().optional(),
  authors: z.array(z.object({ name: z.string(), openalexId: z.string().optional() })),
  year: z.number().optional(), date: z.string().optional(), venue: z.string().optional(), citationCount: z.number().optional(),
  oaUrl: z.string().optional(), pdfUrl: z.string().optional(), htmlUrl: z.string().optional(),
  fields: z.array(z.string()), source: z.enum(["arxiv", "openalex", "s2", "pubmed"]),
  publicationTypes: z.array(z.string()).optional(), isRetracted: z.boolean().optional(),
})
const source = z.enum(["arxiv", "openalex", "s2", "pubmed"])
export const ChatPaperSlugSchema = z.string().min(1).max(80).refine(slug => slug === slugifyTitle(slug))
/** Server-resolved evidence survives discovery-cache refreshes and History navigation. */
export const ChatPaperContextSchema = z.object({
  slug: ChatPaperSlugSchema,
  paper: PaperSnapshotSchema.extend({ abstract: z.string().max(16_000).optional() }),
  digestText: z.string().max(16_000).optional(),
  capturedAt: z.string().datetime(),
  source: PaperTextSchema.optional(),
})
export type ChatPaperContext = z.infer<typeof ChatPaperContextSchema>
export const SearchResultSchema = z.object({
  query: z.string(),
  plan: z.object({
    interpretation: z.string(), sort: z.enum(["relevance", "date"]), fromDate: z.string().nullable(),
    queries: z.array(z.object({ source, query: z.string(), rationale: z.string() })),
  }),
  items: z.array(z.object({
    paper: PaperSnapshotSchema, score: z.number(), whyMatch: z.string(),
    foundBy: z.array(z.object({ source, rationale: z.string() })),
  })),
  stats: z.object({ retrieved: z.number(), deduplicated: z.number() }),
  costUsd: z.number().nullable(), warnings: z.array(z.string()),
})
export const ChatBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("review-citations"), runId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), versionId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), sourceIds: z.array(z.string().regex(/^P\d+$/)) }),
  z.object({ type: z.literal("review"), runId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }),
  z.object({ type: z.literal("paper-results"), retrievedAt: z.string().datetime(), result: SearchResultSchema }),
  z.object({ type: z.literal("paper-citations"), papers: z.array(PaperSnapshotSchema) }),
])
export type ChatBlock = z.infer<typeof ChatBlockSchema>

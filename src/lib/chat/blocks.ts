import { z } from "zod"

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

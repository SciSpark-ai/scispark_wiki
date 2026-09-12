import { z } from "zod"
import { PaperSnapshotSchema } from "../chat/blocks"
import { AnswerCoverageSchema } from "./coverage"
import { TokenRatesSchema } from "../llm/scoped-pricing"

export const ReviewId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
export const ReviewSource = z.enum(["arxiv", "openalex", "s2", "pubmed"])
export const ReviewModelSchema = z.object({
  provider: z.enum(["openai", "openrouter", "anthropic", "google"]), model: z.string().min(1),
  engine: z.enum(["codex", "claude-code"]).optional(),
  endpoint: z.string(), rates: TokenRatesSchema.nullable(),
}).strict()
export const ContextItemSchema = z.object({
  id: z.string(), label: z.string(), text: z.string().max(8000), hash: z.string(),
  kind: z.enum(["profile", "preference", "project", "note", "conversation"]),
}).strict()
export const BriefSchema = z.object({
  question: z.string().trim().min(5).max(2000), scope: z.string().max(4000),
  sources: z.array(ReviewSource).min(1).max(4).refine((s) => new Set(s).size === s.length),
  allowanceUsd: z.number().finite().min(0.01).max(100),
  usePersonalContext: z.boolean(), context: z.array(ContextItemSchema).max(20),
  model: ReviewModelSchema, projectId: ReviewId.optional(),
  /** Public query terms are generated solely from question/scope, never private context. */
  limits: z.object({ searchRounds: z.literal(2), papers: z.number().int().min(2).max(30) }).strict(),
}).strict()
export type ReviewBrief = z.infer<typeof BriefSchema>
export const ReviewEvidenceSchema = z.object({
  id: z.string().regex(/^P\d+$/), title: z.string(), text: z.string().max(100_000),
  access: z.enum(["abstract", "full-text", "uploaded-pdf"]), locator: z.string(),
  hash: z.string(), retrievedAt: z.iso.datetime(), paper: PaperSnapshotSchema.extend({ source: z.enum(["arxiv", "openalex", "s2", "pubmed", "uploaded"]) }),
  notes: z.array(z.string()),
}).strict()
export type EvidenceRecord = z.infer<typeof ReviewEvidenceSchema>
export const ReportVersionSchema = z.object({
  id: ReviewId, parent: ReviewId.nullable(), createdAt: z.iso.datetime(),
  markdown: z.string().max(300_000), verification: z.enum(["checked-draft", "needs-review", "edited"]),
  author: z.enum(["pipeline", "user", "revision"]), sourceIds: z.array(z.string()),
  evidence: z.array(ReviewEvidenceSchema).max(40).optional(),
  answerCoverage: AnswerCoverageSchema.optional(),
  personalRelevance: z.string().max(8000).optional(),
}).strict()
export type ReportVersion = z.infer<typeof ReportVersionSchema>
export const ReviewRunSchema = z.object({
  version: z.literal(1), id: ReviewId, sessionId: ReviewId, revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), brief: BriefSchema,
  status: z.enum(["awaiting-approval", "queued", "running", "interrupted", "paused", "completed", "partial", "cancelled", "failed"]),
  stage: z.string(), approvedRevision: z.number().int().nullable(), ownerPid: z.number().int().nullable(),
  groundingAttempt: z.number().int().nonnegative().default(0),
  checkpoints: z.record(z.string(), z.string()), evidence: z.array(ReviewEvidenceSchema).max(40),
  versions: z.array(ReportVersionSchema), warnings: z.array(z.string()),
  error: z.string().nullable(), completionEvent: z.boolean(),
  draft: z.object({ markdown: z.string().max(300_000), updatedAt: z.iso.datetime() }).nullable().default(null),
  uploads: z.array(z.object({ hash: z.string(), name: z.string(), record: ReviewEvidenceSchema }).strict()).max(4).default([]),
  approvals: z.array(z.object({ revision: z.number().int(), at: z.iso.datetime(), brief: BriefSchema }).strict()).default([]),
}).strict()
export type ReviewRun = z.infer<typeof ReviewRunSchema>
export const BriefInputSchema = z.object({ sessionId: ReviewId, operationId: ReviewId,
  question: z.string().trim().min(5).max(2000), sources: z.array(ReviewSource).min(1).max(4),
}).strict()
export const ReviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), revision: z.number().int() }).strict(),
  z.object({ action: z.literal("amend"), revision: z.number().int(), question: z.string().min(5).max(2000), scope: z.string().max(4000), allowanceUsd: z.number().min(0.01).max(100), usePersonalContext: z.boolean(), rates: TokenRatesSchema.nullable() }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("resume"), revision: z.number().int(), acknowledgeUncertainCharge: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("edit"), parent: ReviewId, markdown: z.string().min(1).max(300_000) }).strict(),
  z.object({ action: z.literal("revise"), parent: ReviewId, instruction: z.string().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("knowledge-base"), versionId: ReviewId }).strict(),
])
export type ReviewAction = z.infer<typeof ReviewActionSchema>

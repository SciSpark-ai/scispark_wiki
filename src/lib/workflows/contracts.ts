import { z } from "zod"
import { ScopedPriceSchema } from "../llm/scoped-pricing"
import { isSafeVaultRelativePath } from "../vault/safe-path"
import { ToolManifestSchema, DigestSchema, ProfileIdSchema, RoleTiersSchema, TierModelsSchema, ToolRefSchema, UuidSchema } from "../extensions/contracts"

const CountSchema = z.number().int().nonnegative().safe()
const SecondsSchema = z.number().finite().nonnegative()
const CostSchema = z.number().finite().nonnegative().nullable()
export const RunAllowanceSchema = z.object({
  modelCalls: CountSchema, commandCalls: CountSchema, activeSeconds: SecondsSchema, costUsd: CostSchema,
}).strict()
export type RunAllowance = z.infer<typeof RunAllowanceSchema>
export const DEFAULT_RUN_ALLOWANCE: Readonly<RunAllowance> = Object.freeze({ modelCalls: 30, commandCalls: 60, activeSeconds: 1800, costUsd: 2 })
export const RunStatusSchema = z.enum([
  "queued", "running", "waiting_for_choice", "waiting_for_setup", "paused_limit", "interrupted",
  "needs_attention", "completed", "failed", "cancelled",
])
export type RunStatus = z.infer<typeof RunStatusSchema>
/** Internal durable coordination records, never an authenticated API response DTO. */
export const WorkflowLeaseSchema = z.object({
  id: UuidSchema, processId: UuidSchema, pid: z.number().int().positive(), expiresAt: z.number().finite(),
}).strict()
export type WorkflowLease = z.infer<typeof WorkflowLeaseSchema>
export const WorkflowJournalSchema = z.object({
  schemaVersion: z.literal(1), runId: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  status: RunStatusSchema, lease: WorkflowLeaseSchema.nullable(), cancelRequested: UuidSchema.optional(),
  actions: z.array(z.object({ operationId: UuidSchema, type: z.enum(["cancel", "resume"]) }).strict()),
}).strict()
export type WorkflowJournal = z.infer<typeof WorkflowJournalSchema>
const WriteIntentSchema = z.enum(["outputs_only", "update_wiki"])
export const StartRunInputSchema = z.object({
  operationId: UuidSchema, tool: ToolRefSchema, input: z.record(z.string(), z.unknown()),
  sessionId: UuidSchema.optional(), contextRefs: z.array(z.string().min(1)),
  allowance: RunAllowanceSchema.partial().optional(), writeIntent: WriteIntentSchema,
}).strict()
export type StartRunInput = z.infer<typeof StartRunInputSchema>
export const StepIntentSchema = z.object({
  id: UuidSchema, kind: z.enum(["model", "command", "read", "wiki_write"]),
  replay: z.enum(["read_only", "idempotent", "reconcile"]), inputHash: DigestSchema,
}).strict()
export type StepIntent = z.infer<typeof StepIntentSchema>
const ArtifactPathSchema = z.string().refine(isSafeVaultRelativePath, "Expected a relative artifact path")
export const ArtifactSchema = z.object({
  id: UuidSchema, kind: z.enum(["markdown", "papers", "bibtex", "file"]), title: z.string().min(1),
  path: ArtifactPathSchema, sha256: DigestSchema, mediaType: z.string().min(1), sourceRefs: z.array(z.string().min(1)),
}).strict()
export type Artifact = z.infer<typeof ArtifactSchema>
/** No caller-controlled paths. Limits apply to actual bytes before persistence. */
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024
export const ArtifactInputSchema = ArtifactSchema.pick({ kind: true, title: true, mediaType: true, sourceRefs: true }).extend({
  title: z.string().trim().min(1).max(500),
  mediaType: z.string().max(127).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
  sourceRefs: z.array(z.string().min(1).max(2048)).max(1000),
  bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength <= MAX_ARTIFACT_BYTES, "Artifact exceeds 25 MiB"),
}).strict()
export type ArtifactInput = z.infer<typeof ArtifactInputSchema>
export const ArtifactIdsSchema = z.array(UuidSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "Duplicate artifact IDs")
export const WikiProposalInputSchema = z.object({
  artifactIds: ArtifactIdsSchema,
  changes: z.array(z.object({ path: z.string().min(1).max(1024), before: z.string().max(MAX_ARTIFACT_BYTES).nullable(), after: z.string().max(MAX_ARTIFACT_BYTES).nullable() }).strict()).min(1).max(100),
}).strict()
export type WikiProposalInput = z.infer<typeof WikiProposalInputSchema>
export const SaveRunInputSchema = z.object({ artifactIds: ArtifactIdsSchema, operationId: UuidSchema }).strict()

export const RunModelSchema = z.object({
  scopedPrices: z.object({ fast: ScopedPriceSchema.optional(), strong: ScopedPriceSchema.optional() }).strict().optional(),
  engine: z.enum(["api", "codex", "claude-code"]), tierModels: TierModelsSchema,
  roleTiers: RoleTiersSchema, timeoutSeconds: z.number().int().min(30).max(600).optional(),
}).strict()
export type RunModel = z.infer<typeof RunModelSchema>
/** Opaque immutable identities. Preparation/resolution and retention belong to later tasks. */
export const PreparedEnvironmentRefSchema = z.object({ id: UuidSchema, digest: DigestSchema, lockDigest: DigestSchema }).strict()
export const ConnectionConfigurationRefSchema = z.object({ id: UuidSchema, revision: DigestSchema }).strict()
export type PreparedEnvironmentRef = z.infer<typeof PreparedEnvironmentRefSchema>
export type ConnectionConfigurationRef = z.infer<typeof ConnectionConfigurationRefSchema>
export const ToolRunSchema = z.object({
  schemaVersion: z.literal(1), id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  operationId: UuidSchema, tool: ToolRefSchema, dependencies: z.array(ToolRefSchema),
  input: z.record(z.string(), z.unknown()), sessionId: UuidSchema.optional(), contextRefs: z.array(z.string().min(1)),
  model: RunModelSchema, preparedEnvironmentRefs: z.array(PreparedEnvironmentRefSchema),
  connectionConfigurationRefs: z.array(ConnectionConfigurationRefSchema),
  writeIntent: WriteIntentSchema, allowance: RunAllowanceSchema, usage: RunAllowanceSchema,
  status: RunStatusSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  eventCursor: CountSchema, artifacts: z.array(ArtifactSchema),
  nativeRunRef: z.object({ kind: z.string().min(1), id: z.union([UuidSchema, z.string().regex(/^review_[a-f0-9]{32}$/)]) }).strict().optional(),
}).strict()
export type ToolRun = z.infer<typeof ToolRunSchema>

// Derive input from its own discriminated schema: Omit<RunEvent, ...> loses
// variant-specific fields when applied non-distributively to a union.
const EventPayloads = [
  z.object({ type: z.literal("status"), status: RunStatusSchema }).strict(),
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z.object({ type: z.literal("artifact"), artifact: ArtifactSchema }).strict(),
  z.object({ type: z.literal("choice"), id: UuidSchema, prompt: z.string().min(1), options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) }).strict()).min(1) }).strict(),
  z.object({ type: z.literal("error"), code: z.string().min(1), message: z.string().min(1) }).strict(),
] as const
export const RunEventInputSchema = z.discriminatedUnion("type", EventPayloads)
export type RunEventInput = z.infer<typeof RunEventInputSchema>
const eventIdentity = { runId: UuidSchema, seq: CountSchema.min(1) }
export const RunEventSchema = z.discriminatedUnion("type", [
  EventPayloads[0].extend(eventIdentity), EventPayloads[1].extend(eventIdentity),
  EventPayloads[2].extend(eventIdentity), EventPayloads[3].extend(eventIdentity), EventPayloads[4].extend(eventIdentity),
])
export type RunEvent = z.infer<typeof RunEventSchema>

/** Counts are consumed before dispatch; only settled active time/cost replace holds. */
export const AttemptEstimateSchema = RunAllowanceSchema.extend({ accountingOwner: z.enum(["workflow", "native"]) }).strict()
export type AttemptEstimate = z.infer<typeof AttemptEstimateSchema>
export const FinancialLedgerRefSchema = z.object({ ledger: z.enum(["review", "local-review", "meter"]), attemptId: UuidSchema }).strict()
export const AttemptTicketSchema = z.object({
  id: UuidSchema, runId: UuidSchema, step: StepIntentSchema, estimate: AttemptEstimateSchema, reservedAt: z.iso.datetime(),
}).strict()
export type AttemptTicket = z.infer<typeof AttemptTicketSchema>
export const AttemptResultSchema = RunAllowanceSchema.extend({
  outcome: z.enum(["known", "unknown"]), financialLedgerRef: FinancialLedgerRefSchema.optional(),
  usage: z.object({ inputTokens: CountSchema, outputTokens: CountSchema, cachedInputTokens: CountSchema.optional(),
    reasoningTokens: CountSchema.optional(), reported: z.boolean().optional(),
    engine: z.enum(["codex", "claude-code"]).optional(), billingMode: z.literal("subscription").optional() }).strict().optional(),
}).strict()
export type AttemptResult = z.infer<typeof AttemptResultSchema>
export const RunUsageSchema = RunAllowanceSchema.extend({
  heldCostUsd: SecondsSchema, heldActiveSeconds: SecondsSchema, heldAttempts: CountSchema, uncertain: z.boolean(),
}).strict()
export type RunUsage = z.infer<typeof RunUsageSchema>

export const UsageJournalSchema = z.object({
  schemaVersion: z.literal(1), runId: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  baseUsage: RunAllowanceSchema, allowance: RunAllowanceSchema,
  extensions: z.array(z.object({ operationId: UuidSchema, delta: RunAllowanceSchema.partial() }).strict()),
  attempts: z.array(z.object({ ticket: AttemptTicketSchema, state: z.enum(["reserved", "known", "unknown", "not_dispatched"]), dispatchedAt: z.iso.datetime().optional(), result: AttemptResultSchema.optional() }).strict().refine(row => row.state !== "not_dispatched" || row.ticket.estimate.accountingOwner === "native", "Only proven native preparation can be released")),
}).strict()
export type UsageJournal = z.infer<typeof UsageJournalSchema>

/** Public observation deliberately excludes input, captured configuration and internal references. */
export const ToolRunDtoSchema = ToolRunSchema.pick({ schemaVersion: true, id: true, profileId: true, operationId: true,
  tool: true, dependencies: true, sessionId: true, contextRefs: true, writeIntent: true, allowance: true, usage: true,
  status: true, createdAt: true, updatedAt: true, eventCursor: true, artifacts: true }).extend({ cancelRequested: z.boolean().default(false) })
export type ToolRunDto = z.infer<typeof ToolRunDtoSchema>
const PositiveDeltaSchema = RunAllowanceSchema.partial().refine(delta => Object.keys(delta).length > 0 && Object.values(delta).every(v => v !== null && v > 0), "Expected positive allowance deltas")
export const RunActionInputSchema = z.discriminatedUnion("action", [
  z.object({ operationId: UuidSchema, action: z.literal("cancel") }).strict(),
  z.object({ operationId: UuidSchema, action: z.literal("resume") }).strict(),
  z.object({ operationId: UuidSchema, action: z.literal("extend"), delta: PositiveDeltaSchema }).strict(),
])
export type RunActionInput = z.infer<typeof RunActionInputSchema>
export const ToolSummarySchema = ToolManifestSchema.pick({ ref: true, name: true, description: true, capabilities: true, kind: true, engines: true, outputKinds: true }).extend({ enabled: z.boolean() })
export type ToolSummary = z.infer<typeof ToolSummarySchema>

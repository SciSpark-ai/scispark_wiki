import { z } from "zod"
import { isSafeVaultRelativePath } from "../vault/safe-path"
import { DigestSchema, ProfileIdSchema, RoleTiersSchema, TierModelsSchema, ToolRefSchema, UuidSchema } from "../extensions/contracts"

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
export const RunModelSchema = z.object({
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
  nativeRunRef: z.object({ kind: z.string().min(1), id: UuidSchema }).strict().optional(),
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

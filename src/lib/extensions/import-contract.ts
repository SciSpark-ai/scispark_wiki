import { z } from "zod"
import { DigestSchema, ProfileIdSchema, ToolManifestSchema, ToolRefSchema, ToolOverrideSchema, UuidSchema } from "./contracts"

export const IMPORT_LIMITS = { compressedBytes: 50 * 1024 * 1024, expandedBytes: 250 * 1024 * 1024, entries: 10_000, fileBytes: 25 * 1024 * 1024 } as const
const Text = z.string().min(1).max(1000)
/** Portable relative paths: no ambiguous aliases across case-insensitive hosts. */
export const PackagePathSchema = z.string().min(1).max(1000).refine((path) => {
  if (path !== path.normalize("NFC") || /[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith("/")) return false
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}, "Invalid archive path")
const PackageId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/).refine((id) => !id.toLowerCase().startsWith("scispark.builtin"), "Reserved builtin identity")
const sourceFields = { packageId: PackageId.optional() }
export const ImportSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("github"), url: z.string().max(2000).refine((value) => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value), "Expected a GitHub repository URL without credentials"), ref: z.string().min(1).max(200).regex(/^[A-Za-z0-9_./-]+$/).optional(), ...sourceFields }).strict(),
  ...(["local-folder", "zip", "agent"] as const).map((kind) => z.object({ kind: z.literal(kind), path: z.string().min(1).max(4000), ...sourceFields }).strict()),
])
export type ImportSource = z.infer<typeof ImportSourceSchema>
export const SetupRecipeSchema = z.object({
  commands: z.array(z.object({ executable: z.string().min(1).max(200).regex(/^[A-Za-z0-9_./+-]+$/), argv: z.array(z.string().max(4000).refine((s) => !s.includes("\0"))).max(100), network: z.array(z.string().max(253).regex(/^[a-z0-9][a-z0-9.-]*$/)).max(50) }).strict()).max(30),
  runtimes: z.array(Text).max(30), unsupported: z.array(Text).max(100),
  environment: z.object({ runtime: z.enum(["node22", "python3.12"]), lockFile: PackagePathSchema, lockDigest: DigestSchema }).strict().optional(),
  connectionAdapter: z.literal("scispark-http-v1").optional(),
  internalModelCalls: z.boolean().optional(),
  requiredModels: z.array(z.string().min(1).max(150)).max(20).optional(),
}).strict()
export type SetupRecipe = z.infer<typeof SetupRecipeSchema>
export const DependencySlotSchema = z.object({ id: Text, capability: Text, eligible: z.array(ToolRefSchema).min(1).max(50) }).strict()
/** Reviewed runtime recipes are separate from environment installation. */
export const ExecutionCommandSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
  executableId: z.enum(["node", "python"]), entrypoint: PackagePathSchema,
  argv: z.array(z.string().max(4000).refine(value => !value.includes("\0"))).max(100),
}).strict()
export const AdapterProposalSchema = z.object({
  skillId: Text, name: Text, description: z.string().max(16000), kind: z.enum(["instructions", "command"]), entrypoint: PackagePathSchema,
  capabilities: z.array(Text).max(100), resources: z.array(PackagePathSchema).max(1000), dependencies: z.array(ToolRefSchema).max(100),
  dependencySlots: z.array(DependencySlotSchema).max(30), connections: z.array(Text).max(100), engines: z.array(Text).max(30),
  executionCommands: z.array(ExecutionCommandSchema).max(30).optional(),
  inputSchema: z.record(z.string(), z.unknown()), outputKinds: z.array(Text).max(100), setup: SetupRecipeSchema,
}).strict()
export type AdapterProposal = z.infer<typeof AdapterProposalSchema>
export const FileRecordSchema = z.object({ path: PackagePathSchema, sha256: DigestSchema, bytes: z.number().int().nonnegative().max(IMPORT_LIMITS.fileBytes) }).strict()
export const StagedPackageSchema = z.object({
  schemaVersion: z.literal(1), id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  packageId: Text, version: Text, discoveryGrantId: UuidSchema.optional(),
  provenance: ToolManifestSchema.shape.provenance,
  files: z.array(FileRecordSchema).max(IMPORT_LIMITS.entries),
}).strict()
export type StagedPackage = z.infer<typeof StagedPackageSchema>
export const CompatibilitySchema = z.object({ status: z.enum(["needs-review", "ready", "needs-setup", "unsupported"]), reasons: z.array(Text).max(100) }).strict()
export const ImportToolSchema = z.object({ manifest: ToolManifestSchema, proposal: AdapterProposalSchema, inferred: z.boolean(), reviewed: z.boolean(), hostUnsupported: z.array(Text).max(100), compatibility: CompatibilitySchema, requirements: SetupRecipeSchema, files: z.array(FileRecordSchema).max(IMPORT_LIMITS.entries) }).strict()
export const ImportPreviewSchema = z.object({ schemaVersion: z.literal(1), id: UuidSchema, stageId: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema, tools: z.array(ImportToolSchema).min(1).max(1000), recognizedMetadata: z.array(PackagePathSchema).max(1000), warnings: z.array(Text).max(100) }).strict()
export type ImportPreview = z.infer<typeof ImportPreviewSchema>
export const ResolvedPackageGraphSchema = z.object({ status: z.enum(["resolved", "blocked"]), reason: z.enum(["dependency-cycle", "missing-dependency", "version-conflict", "ambiguous-manifest"]).optional(), nodes: z.array(ToolRefSchema).max(10000), edges: z.array(z.object({ parent: ToolRefSchema, dependency: ToolRefSchema }).strict()).max(10000) }).strict()
export type ResolvedPackageGraph = z.infer<typeof ResolvedPackageGraphSchema>

// Model-facing command requests contain identities, never host filesystem roots.
const CommandId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/)
export const CommandInvocationSchema = z.object({
  id: UuidSchema, executableId: CommandId,
  argv: z.array(z.string().max(16000).refine(s => !s.includes("\0"))).max(200),
  cwd: z.union([z.literal("."), PackagePathSchema]),
  resourceIds: z.array(CommandId).max(1000), connectionIds: z.array(CommandId).max(100),
  timeoutMs: z.number().int().min(100).max(300_000).default(300_000),
  outputBytes: z.number().int().min(1).max(2 * 1024 * 1024).default(2 * 1024 * 1024),
}).strict()
export type CommandInvocation = z.input<typeof CommandInvocationSchema>
export const SandboxReadinessSchema = z.object({
  status: z.enum(["ready", "needs-setup", "unsupported"]),
  platform: z.string(), runtimeVersion: z.literal("0.0.78"),
  evidence: z.array(z.object({ check: z.string(), status: z.enum(["passed", "failed", "unavailable"]), detail: z.string() }).strict()),
}).strict()
export type SandboxReadiness = z.infer<typeof SandboxReadinessSchema>
export const CommandResultSchema = z.object({
  invocationId: UuidSchema, exitCode: z.number().int().nullable(), stdout: z.string(), stderr: z.string(),
  termination: z.enum(["exited", "cancelled", "timeout", "output-limit", "parent-disconnect", "unavailable", "worker-lost"]),
  reconciliationRef: z.string(), uncertain: z.boolean(),
}).strict()
export type CommandResult = z.infer<typeof CommandResultSchema>

export type CompatibilityReport = z.infer<typeof CompatibilitySchema>
export const EnvironmentRecordSchema = z.object({
  schemaVersion: z.literal(1), id: UuidSchema, setupId: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  tool: ToolRefSchema, recipeDigest: DigestSchema, toolchainDigest: DigestSchema, lockDigest: DigestSchema, digest: DigestSchema,
  state: z.enum(["needs-setup", "installing", "interrupted", "needs-reconciliation", "unsupported", "ready"]),
  contentDigest: DigestSchema.optional(), pendingDiscard: UuidSchema.optional(),
  executed: z.boolean(), completedSteps: z.number().int().nonnegative(), reason: z.string().max(1000),
}).strict()
export type EnvironmentRecord = z.infer<typeof EnvironmentRecordSchema>
export const ConnectionBindingSchema = z.object({
  id: UuidSchema, service: z.literal("semantic-scholar"), adapter: z.literal("scispark-http-v1"),
  credentialHandle: z.literal("settings:paperSources.s2"),
}).strict()
export type ConnectionBinding = z.infer<typeof ConnectionBindingSchema>
export const ConnectionRecordSchema = ConnectionBindingSchema.extend({
  profileId: ProfileIdSchema, vaultId: DigestSchema, revision: DigestSchema,
}).strict()
export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>

/** Optional catalog suggestions never enable or execute a tool. */
export const CatalogEntrySchema = z.object({
  id: Text, name: Text, source: ImportSourceSchema, version: Text,
  proposal: AdapterProposalSchema, requiredConnections: z.array(Text), expectedCapabilities: z.array(Text),
  notices: z.array(PackagePathSchema), bundleDigest: DigestSchema,
}).strict()
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>
/** Inert source provenance only; this schema grants no network authority. */
export const OpenCiteSourceReferenceSchema = z.string().max(2048).refine(value => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.port } catch { return false }
}, "Expected an HTTP or HTTPS source reference")
export const OpenCiteFullTextStatusSchema = z.enum(["not-requested", "request-limit", "no-location", "policy-denied", "size-limit", "retrieval-failed", "invalid-pdf", "conversion-failed", "available", "unknown"])
export const OpenCiteResultSchema = z.object({
  sourceStatus: z.enum(["ok", "no-results", "rate-limited", "unavailable"]),
  papers: z.array(z.object({ title: z.string().min(1).max(2000), doi: z.string().max(1000), url: z.union([OpenCiteSourceReferenceSchema,z.literal("")]), authors: z.array(z.string().max(500)).max(50), year: z.number().int().min(1000).max(9999).nullable(), abstract: z.string().max(16000), access: z.enum(["abstract", "full-text"]), fullTextStatus: OpenCiteFullTextStatusSchema.optional(), sourceRefs: z.array(z.string().max(2048)).max(20) }).strict()).max(20),
  artifacts: z.array(z.object({kind:z.enum(["papers","bibtex","file","markdown"]),title:z.string().max(500),mediaType:z.string(),sourceRefs:z.array(z.string().max(2048)).max(1000),text:z.string().max(500000).optional(),base64:z.string().max(700000).optional()}).strict()).max(8),
}).strict()
export type OpenCiteResult = z.infer<typeof OpenCiteResultSchema>

/** Explicit selections only; no default home/config expansion. */
export const DiscoveryRootSchema = z.object({
  agent: z.enum(["codex", "claude", "custom"]),
  layout: z.enum(["config", "skills", "plugin-cache", "package"]),
  path: z.string().min(1).max(4000).refine(value => value.startsWith("/") && !/[\x00-\x1f]/.test(value), "Select an absolute folder"),
}).strict()
export type DiscoveryRoot = z.infer<typeof DiscoveryRootSchema>
export const DiscoveryGrantSchema = z.object({
  id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  roots: z.array(DiscoveryRootSchema).min(1).max(16),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(), revoked: z.boolean(),
}).strict()
export type DiscoveryGrant = z.infer<typeof DiscoveryGrantSchema>
export const DiscoveredSkillSchema = z.object({
  id: UuidSchema, name: Text, description: z.string().max(16000), identity: DigestSchema,
  researchScore: z.number().int().min(0).max(100),
  origins: z.array(z.object({ rootIndex: z.number().int().nonnegative().max(15), agent: DiscoveryRootSchema.shape.agent, label: Text }).strict()).min(1).max(1000),
  compatibility: CompatibilitySchema,
}).strict()
export type DiscoveredSkill = z.infer<typeof DiscoveredSkillSchema>
export const DiscoveryActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), operationId: UuidSchema, roots: z.array(DiscoveryRootSchema).min(1).max(16) }).strict(),
  z.object({ action: z.literal("discover"), operationId: UuidSchema, grantId: UuidSchema }).strict(),
  z.object({ action: z.literal("stage"), operationId: UuidSchema, grantId: UuidSchema, candidateId: UuidSchema }).strict(),
  z.object({ action: z.literal("revoke"), operationId: UuidSchema, grantId: UuidSchema }).strict(),
])
export type DiscoveryAction = z.infer<typeof DiscoveryActionSchema>
export const DiscoveryQuerySchema = z.object({ grantId: UuidSchema }).strict()
export const DiscoveryGrantDtoSchema = DiscoveryGrantSchema.omit({ profileId: true, vaultId: true })
export const DiscoveryStageDtoSchema = ImportPreviewSchema.omit({ profileId: true, vaultId: true })

/** Private source authority, saved separately from immutable package identity. */
export const UpdateSourceSchema = z.object({ source: ImportSourceSchema, locator: z.string().min(1).max(4000) }).strict()
export const ApprovedUpdateSourceSchema = UpdateSourceSchema.extend({ inspectedProposal: AdapterProposalSchema, reviewedProposal: AdapterProposalSchema }).strict()
export const UpdatePreviewSchema = z.object({
  id: UuidSchema, current: ToolRefSchema, kind: z.enum(["metadata", "staged"]), revision: Text,
  candidate: ToolRefSchema.optional(), changedResources: z.array(PackagePathSchema).max(IMPORT_LIMITS.entries),
  dependencies: z.array(ToolRefSchema).max(100), addedCapabilities: z.array(Text).max(100), addedConnections: z.array(Text).max(100),
  proposal: AdapterProposalSchema.optional(), checkedAt: z.number().int().nonnegative(),
}).strict()
export type UpdatePreview = z.infer<typeof UpdatePreviewSchema>
export const ActiveRunDispositionSchema = z.enum(["finish", "cancel"])
export const ToolMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), operationId: UuidSchema }).strict(),
  z.object({ action: z.literal("bind-connection"), operationId: UuidSchema, target: ToolRefSchema, service: z.literal("semantic-scholar") }).strict(),
  z.object({ action: z.literal("enable"), operationId: UuidSchema, enabled: z.boolean(), activeRunDisposition: ActiveRunDispositionSchema.optional() }).strict(),
  z.object({ action: z.literal("binding"), operationId: UuidSchema, patch: ToolOverrideSchema.omit({ toolKey: true }) }).strict(),
  z.object({ action: z.literal("check-update"), operationId: UuidSchema, grantId: UuidSchema.optional() }).strict(),
  z.object({ action: z.literal("apply-update"), operationId: UuidSchema, previewId: UuidSchema }).strict(),
  z.object({ action: z.literal("rollback"), operationId: UuidSchema, digest: DigestSchema }).strict(),
  z.object({ action: z.literal("remove"), operationId: UuidSchema, activeRunDisposition: ActiveRunDispositionSchema.optional() }).strict(),
  z.object({ action: z.literal("acknowledge-and-discard-setup"), operationId: UuidSchema, tool: ToolRefSchema, setupId: UuidSchema }).strict(),
])
export type ToolMutation = z.infer<typeof ToolMutationSchema>
export const ToolRemovalResultSchema = z.object({ status: z.enum(["removed", "disabled", "decision-required", "cancellation-pending"]), runIds: z.array(UuidSchema) }).strict()
export type ToolRemovalResult = z.infer<typeof ToolRemovalResultSchema>

export const ToolMutationResultSchema = z.union([ToolRefSchema, z.object({ updated: z.literal(true) }).strict(), ToolRemovalResultSchema, UpdatePreviewSchema.nullable(), EnvironmentRecordSchema])
export type ToolMutationResult = z.infer<typeof ToolMutationResultSchema>

/** Management recovery projection intentionally omits all runtime/recipe details. */
export const ToolSetupStateSchema = z.object({ tool: ToolRefSchema, setupId: UuidSchema, state: EnvironmentRecordSchema.shape.state, reason: z.string().max(1000) }).strict()
export const ToolUpdateStateSchema = z.object({ preview: UpdatePreviewSchema, consent: z.enum(["valid", "renewal-required", "not-required"]), preparedTool: ToolRefSchema.optional(), readiness: CompatibilitySchema.optional(), setup: ToolSetupStateSchema.optional() }).strict()
export type ToolUpdateState = z.infer<typeof ToolUpdateStateSchema>

/** Fixed named supporting nodes only. Ambiguous slots remain user-owned choices. */
export const ParallelHostActionSchema = z.object({
  type: z.literal("parallel"),
  branches: z.array(z.object({ tool: ToolRefSchema, input: z.record(z.string(), z.unknown()) }).strict()).length(2),
}).strict()

/** Fixed host-authored guidance only; never wrap external exception text. */
export class ToolInputBindingError extends Error {
  constructor() { super("This request does not fit the tool's reviewed input. Shorten the question or review its question input binding in the import source before starting it.") }
}

import { z } from "zod"
import { DigestSchema, ProfileIdSchema, ToolManifestSchema, ToolRefSchema, UuidSchema } from "./contracts"

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
}).strict()
export type SetupRecipe = z.infer<typeof SetupRecipeSchema>
export const DependencySlotSchema = z.object({ id: Text, capability: Text, eligible: z.array(ToolRefSchema).min(1).max(50) }).strict()
export const AdapterProposalSchema = z.object({
  skillId: Text, name: Text, description: z.string().max(16000), kind: z.enum(["instructions", "command"]), entrypoint: PackagePathSchema,
  capabilities: z.array(Text).max(100), resources: z.array(PackagePathSchema).max(1000), dependencies: z.array(ToolRefSchema).max(100),
  dependencySlots: z.array(DependencySlotSchema).max(30), connections: z.array(Text).max(100), engines: z.array(Text).max(30),
  inputSchema: z.record(z.string(), z.unknown()), outputKinds: z.array(Text).max(100), setup: SetupRecipeSchema,
}).strict()
export type AdapterProposal = z.infer<typeof AdapterProposalSchema>
export const FileRecordSchema = z.object({ path: PackagePathSchema, sha256: DigestSchema, bytes: z.number().int().nonnegative().max(IMPORT_LIMITS.fileBytes) }).strict()
export const StagedPackageSchema = z.object({
  schemaVersion: z.literal(1), id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  packageId: Text, version: Text,
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

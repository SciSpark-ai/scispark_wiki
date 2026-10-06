import { z } from "zod"
import { ToolKeySchema, ToolRefSchema, ToolOverrideSchema, UuidSchema } from "./contracts"
import { AdapterProposalSchema, CompatibilitySchema, DiscoveryStageDtoSchema, ImportSourceSchema, ToolSetupStateSchema, ToolUpdateStateSchema, UpdatePreviewSchema } from "./import-contract"
import { ToolSummarySchema } from "../workflows/contracts"
export const ToolObservationSchema = z.object({
  readiness: CompatibilitySchema,
  setup: ToolSetupStateSchema.optional(),
  blockedTool: z.object({ tool: ToolRefSchema, name: z.string().min(1).max(1000) }).strict().optional(),
  connectionRequirements: z.array(z.object({ tool: ToolRefSchema, name: z.string().min(1).max(1000), service: z.literal("semantic-scholar") }).strict()),
}).strict()
export const LibraryToolSchema = ToolSummarySchema.extend({ connections: z.array(z.string()), installed: z.boolean(), pinned: z.boolean(), ...ToolObservationSchema.shape, pendingManagement: z.object({ operationId: UuidSchema, action: z.enum(["remove", "disable"]), runIds: z.array(UuidSchema) }).strict().optional(), override: ToolOverrideSchema.optional() }).strict()
export type LibraryTool = z.infer<typeof LibraryToolSchema>
export const LibrarySchema = z.object({ tools: z.array(LibraryToolSchema), discoveryDismissed: z.boolean(), catalog: z.array(z.object({ id: z.literal("opencite"), name: z.string(), description: z.string() }).strict()) }).strict()
export type ToolLibrary = z.infer<typeof LibrarySchema>
export const ToolsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("metadata") }).strict(),
  z.object({ action: z.literal("pin"), operationId: UuidSchema, key: ToolKeySchema, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal("dismiss-discovery"), operationId: UuidSchema, dismissed: z.boolean() }).strict(),
])
export const ImportRequestSchema = z.union([
  z.object({ source: ImportSourceSchema.refine(source => source.kind === "github" || (source.kind === "local-folder" && source.path.startsWith("/")), "Choose GitHub or an explicit folder") }).strict(),
  z.object({ catalogId: z.enum(["opencite", "literature-review"]) }).strict(),
])
export const ImportActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), selected: z.array(ToolRefSchema).min(1).max(1000), proposals: z.array(AdapterProposalSchema).min(1).max(1000) }).strict(),
])
export const ImportStateSchema = z.object({ preview: DiscoveryStageDtoSchema, tools: z.array(z.object({ tool: ToolRefSchema, ...ToolObservationSchema.shape }).strict()) }).strict()
export type ImportState = z.infer<typeof ImportStateSchema>
export const ToolDetailSchema = z.object({ versions: z.array(z.object({ ref: ToolRefSchema, current: z.boolean(), readiness: CompatibilitySchema }).strict()), update: UpdatePreviewSchema.nullable(), pendingUpdate: ToolUpdateStateSchema.nullable() }).strict()
export type ToolDetail = z.infer<typeof ToolDetailSchema>
/** Selection only: Task16 validates this exact ref against enabled bindings before submit. */
export function toolHref(ref: z.infer<typeof ToolRefSchema>): string {
  const tool = ToolRefSchema.parse(ref)
  if (tool.packageId === "scispark.builtin" && tool.skillId === "trending") return "/trending"
  if (tool.packageId === "scispark.builtin" && tool.skillId === "idea-spark") return "/spark"
  return `/chat?tool=${encodeURIComponent(JSON.stringify(tool))}`
}
export function parseToolIntent(value: string) { return ToolRefSchema.parse(JSON.parse(value)) }

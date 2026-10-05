import { z } from "zod"

export const UuidSchema = z.uuid()
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
/** Existing adopted vaults use 32 hex characters; newer profiles use UUIDs. */
export const ProfileIdSchema = z.union([UuidSchema, z.string().regex(/^[a-f0-9]{32}$/)])
const LabelSchema = z.string().min(1).max(1000)
export const ToolRefSchema = z.object({
  packageId: LabelSchema, skillId: LabelSchema, version: LabelSchema, digest: DigestSchema,
}).strict()
export type ToolRef = z.infer<typeof ToolRefSchema>
export type ToolKey = string
/** Names are identities, never filesystem paths. JSON avoids delimiter collisions. */
export function toolKey(ref: Pick<ToolRef, "packageId" | "skillId">): ToolKey {
  const identity = ToolRefSchema.pick({ packageId: true, skillId: true }).parse({ packageId: ref.packageId, skillId: ref.skillId })
  return JSON.stringify([identity.packageId, identity.skillId])
}
export const ToolKeySchema = z.string().refine((value) => {
  try {
    const pair = z.tuple([LabelSchema, LabelSchema]).parse(JSON.parse(value))
    return JSON.stringify(pair) === value
  } catch { return false }
}, "Expected canonical tool identity")
export const ToolManifestSchema = z.object({
  ref: ToolRefSchema, name: LabelSchema, description: z.string(), capabilities: z.array(LabelSchema),
  kind: z.enum(["native", "instructions", "command"]), entrypoint: LabelSchema,
  dependencies: z.array(ToolRefSchema), resources: z.array(LabelSchema),
  connections: z.array(LabelSchema), engines: z.array(LabelSchema),
  inputSchema: z.record(z.string(), z.unknown()), outputKinds: z.array(LabelSchema),
  provenance: z.object({ source: z.enum(["builtin", "github", "local", "agent"]), locator: LabelSchema, revision: LabelSchema }).strict(),
}).strict()
export type ToolManifest = z.infer<typeof ToolManifestSchema>

export const ModelSelectionSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "openrouter"]),
  model: z.string().min(1).max(150),
  // A non-secret endpoint selection; credentials are never part of a snapshot.
  baseUrl: z.url().refine((value) => {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  }, "Expected a non-secret HTTP endpoint").optional(),
}).strict()
export const TierSchema = z.enum(["fast", "strong"])
export const TierModelsSchema = z.object({ fast: ModelSelectionSchema, strong: ModelSelectionSchema }).strict()
export const RoleTiersSchema = z.record(LabelSchema, TierSchema)
export const ToolOverrideSchema = z.object({
  toolKey: ToolKeySchema, tierModels: TierModelsSchema.partial().optional(), roleTiers: RoleTiersSchema.optional(),
}).strict()
export type ToolOverride = z.infer<typeof ToolOverrideSchema>
export const ProfileToolsSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.array(z.object({ tool: ToolRefSchema, enabled: z.boolean() }).strict()),
  pins: z.array(ToolRefSchema), overrides: z.array(ToolOverrideSchema), migrated: z.boolean(),
}).strict().superRefine((state, ctx) => {
  for (const [field, keys] of [
    ["enabled", state.enabled.map((binding) => toolKey(binding.tool))],
    ["pins", state.pins.map(toolKey)],
    ["overrides", state.overrides.map((override) => override.toolKey)],
  ] as const) {
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: [field], message: "Duplicate tool identity" })
  }
})
export type ProfileTools = z.infer<typeof ProfileToolsSchema>

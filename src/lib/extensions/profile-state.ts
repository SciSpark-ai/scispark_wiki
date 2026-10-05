import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { DigestSchema, ProfileIdSchema, ToolKeySchema, ToolOverrideSchema, ToolRefSchema, toolKey, type ProfileTools, type ToolKey, type ToolManifest } from "./contracts"
import { NATIVE_TOOL_MANIFESTS } from "./native-catalog"
import { getCurrentToolManifest, getToolManifest } from "./registry"
import { profileRuntimePath, readProfileTools, readImportedManifests, updateProfileTools } from "./store"

const OriginSchema = z.object({ schemaVersion: z.literal(1), profileId: ProfileIdSchema, vaultId: DigestSchema, origin: z.enum(["new", "legacy"]) }).strict()
const BindingPatchSchema = ToolOverrideSchema.omit({ toolKey: true }).extend({ tool: ToolRefSchema.optional() }).strict()
export type ToolBindingPatch = z.infer<typeof BindingPatchSchema>

/** Persist classification outside research before any scaffold or publication.
 * If state writing fails, the marker makes retry keep the original origin. */
export async function initializeProfileTools(ctx: WorkflowContext, origin: "new" | "legacy"): Promise<ProfileTools> {
  return updateProfileTools(ctx, async (current) => {
    const runtime = new NodeFsVaultStorage(profileRuntimePath(ctx))
    const raw = await runtime.read("origin.json")
    const marker = raw === null ? OriginSchema.parse({ schemaVersion: 1, profileId: ctx.profileId, vaultId: ctx.vaultId, origin }) : OriginSchema.parse(JSON.parse(raw))
    if (marker.profileId !== ctx.profileId || marker.vaultId !== ctx.vaultId) throw new Error("Profile tool origin ownership mismatch")
    if (raw === null) await runtime.write("origin.json", JSON.stringify(marker, null, 2))
    if (current?.migrated) return current
    const state: ProfileTools = current ?? { schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: false }
    if (marker.origin === "legacy") {
      for (const manifest of NATIVE_TOOL_MANIFESTS) {
        const key = toolKey(manifest.ref)
        const pin = state.pins.find((ref) => toolKey(ref) === key) ?? manifest.ref
        if (!state.pins.some((ref) => toolKey(ref) === key)) state.pins.push(pin)
        if (!state.enabled.some(({ tool }) => toolKey(tool) === key)) state.enabled.push({ tool: pin, enabled: true })
      }
    }
    return { ...state, migrated: true }
  })
}

export async function setToolEnabled(ctx: WorkflowContext, key: ToolKey, enabled: boolean): Promise<ProfileTools> {
  ToolKeySchema.parse(key)
  z.boolean().parse(enabled)
  const imports = await readImportedManifests(ctx)
  return updateProfileTools(ctx, (state) => {
    if (!state?.migrated) throw new Error("Initialize profile tools before changing bindings")
    const manifest = getCurrentToolManifest(key) ?? imports.find(m => toolKey(m.ref) === key)
    if (!manifest) throw new Error("Unknown tool identity")
    const ref = state.pins.find((pin) => toolKey(pin) === key) ?? state.enabled.find(b => toolKey(b.tool) === key)?.tool ?? manifest.ref
    const bindings = state.enabled.filter(({ tool }) => toolKey(tool) !== key)
    if (enabled) bindings.push({ tool: ref, enabled: true })
    return { ...state, enabled: bindings, pins: state.pins.some((pin) => toolKey(pin) === key) ? state.pins : [...state.pins, ref] }
  })
}

export async function setToolBinding(ctx: WorkflowContext, key: ToolKey, patch: ToolBindingPatch): Promise<ProfileTools> {
  ToolKeySchema.parse(key)
  const parsed = BindingPatchSchema.parse(patch)
  const imports = await readImportedManifests(ctx)
  return updateProfileTools(ctx, (state) => {
    if (!state?.migrated) throw new Error("Initialize profile tools before changing bindings")
    if (!getCurrentToolManifest(key) && !imports.some(m => toolKey(m.ref) === key)) throw new Error("Unknown tool identity")
    if (parsed.tool && (toolKey(parsed.tool) !== key || !getToolManifest(parsed.tool) && !imports.some(m => JSON.stringify(m.ref) === JSON.stringify(parsed.tool)))) throw new Error("Unknown tool version or mismatched identity")
    const old = state.overrides.find((override) => override.toolKey === key)
    const override = ToolOverrideSchema.parse({ ...old, toolKey: key, ...(parsed.tierModels ? { tierModels: { ...old?.tierModels, ...parsed.tierModels } } : {}), ...(parsed.roleTiers ? { roleTiers: { ...old?.roleTiers, ...parsed.roleTiers } } : {}) })
    return {
      ...state,
      pins: parsed.tool ? [...state.pins.filter((pin) => toolKey(pin) !== key), parsed.tool] : state.pins,
      enabled: parsed.tool ? state.enabled.map((binding) => toolKey(binding.tool) === key ? { ...binding, tool: parsed.tool! } : binding) : state.enabled,
      overrides: [...state.overrides.filter((binding) => binding.toolKey !== key), override],
    }
  })
}

/** Enabled catalog choices are distinct from adapter execution readiness. */
export async function listEnabledTools(ctx: WorkflowContext): Promise<ToolManifest[]> {
  const state = await readProfileTools(ctx), imports = await readImportedManifests(ctx)
  return (state?.enabled ?? []).flatMap(({ tool, enabled }) => {
    const manifest = getToolManifest(tool) ?? imports.find(m => JSON.stringify(m.ref) === JSON.stringify(tool))
    return enabled && manifest ? [manifest] : []
  })
}

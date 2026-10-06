import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { toolKey, type ProfileTools } from "./contracts"
import { readProfileTools, readImportedManifests, updateProfileTools, canonicalJSON, ManagementHistoryFullError } from "./store"
import { getToolManifest } from "./registry"
import { NATIVE_TOOL_MANIFESTS } from "./native-catalog"
import { observeToolPreparation } from "./observation"
import { checkToolUpdate } from "./versions"
import { LibrarySchema, ToolsActionSchema } from "./ui-contract"
import { sha256 } from "./acquire"
const defaults = (): ProfileTools => ({ schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true, sidebarPins: [] })
export function sidebarPins(state: ProfileTools | null) {
  return state?.sidebarPins ?? state?.enabled.filter(b => b.enabled && b.tool.packageId === "scispark.builtin" && ["trending", "idea-spark"].includes(b.tool.skillId)).map(b => toolKey(b.tool)) ?? []
}
/** Local observation only. No remote metadata, source folder scan, or setup. */
export async function listToolLibrary(ctx: WorkflowContext) {
  const state = await readProfileTools(ctx), refs = new Map(NATIVE_TOOL_MANIFESTS.map(m => [toolKey(m.ref), m.ref]))
  for (const ref of state?.pins ?? []) refs.set(toolKey(ref), ref)
  for (const b of state?.enabled ?? []) refs.set(toolKey(b.tool), b.tool)
  const imports = [...refs.values()].some(r => !getToolManifest(r)) ? await readImportedManifests(ctx) : []
  const tools = await Promise.all([...refs.values()].map(async ref => {
    const manifest = getToolManifest(ref) ?? imports.find(m => canonicalJSON(m.ref) === canonicalJSON(ref))
    if (!manifest) return null
    const key = toolKey(ref), binding = state?.enabled.find(b => toolKey(b.tool) === key)
    const observation = await observeToolPreparation(ctx, ref)
    const pending = state?.managementOperations?.find(o => o.toolKey === key && "status" in o.result && o.result.status === "cancellation-pending")
    const pendingManagement = pending && "runIds" in pending.result ? { operationId: pending.operationId, action: pending.hash === sha256(canonicalJSON({ key, action: { action: "remove", operationId: pending.operationId, activeRunDisposition: "cancel" } })) ? "remove" : "disable", runIds: pending.result.runIds } : undefined
    const { name, description, capabilities, kind, engines, outputKinds, connections } = manifest
    return { ref, name, description, capabilities, kind, engines, outputKinds, connections, ...(pendingManagement ? { pendingManagement } : {}), enabled: binding?.enabled ?? false, installed: !!binding, pinned: sidebarPins(state).includes(key), ...observation, ...(state?.overrides.find(o => o.toolKey === key) ? { override: state.overrides.find(o => o.toolKey === key) } : {}) }
  }))
  return LibrarySchema.parse({ tools: tools.filter(Boolean), discoveryDismissed: state?.discoveryDismissed ?? false, catalog: [{ id: "opencite", name: "OpenCite", description: "Semantic Scholar search, public PDFs and BibTeX. Requires local setup." }] })
}
export async function applyToolsAction(ctx: WorkflowContext, input: z.infer<typeof ToolsActionSchema>) {
  const action = ToolsActionSchema.parse(input)
  if (action.action === "metadata") {
    const state = await readProfileTools(ctx)
    const keys = new Set((state?.enabled ?? []).filter(b => b.tool.packageId !== "scispark.builtin").map(b => toolKey(b.tool)))
    for (const key of keys) await checkToolUpdate(ctx, key).catch(() => null)
    return { updated: true as const }
  }
  await updateProfileTools(ctx, current => {
    const state = current ?? defaults(), hash = sha256(canonicalJSON(action)), previous = state.preferenceOperations?.find(o => o.operationId === action.operationId)
    if (previous) { if (previous.hash !== hash) throw new Error("Preference operation conflict"); return state }
    if ((state.preferenceOperations?.length ?? 0) >= 10000) throw new ManagementHistoryFullError()
    let next = state
    if (action.action === "pin") {
      if (!state.enabled.some(b => b.enabled && toolKey(b.tool) === action.key)) throw new Error("Enable the tool before pinning")
      next = { ...state, sidebarPins: [...sidebarPins(state).filter(k => k !== action.key), ...(action.pinned ? [action.key] : [])] }
    } else next = { ...state, discoveryDismissed: action.dismissed }
    return { ...next, preferenceOperations: [...(state.preferenceOperations ?? []), { operationId: action.operationId, hash }] }
  })
  return { updated: true as const }
}

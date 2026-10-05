import type { WorkflowContext } from "../workflows/context"
import { ToolKeySchema, toolKey, type ToolKey, type ToolManifest } from "./contracts"
import { getToolManifest } from "./registry"
import { readProfileTools, readImportedManifests } from "./store"

export class ToolDisabledError extends Error {
  readonly status = 409
  constructor() { super("This tool is not enabled. Add it from Tools to continue.") }
}
/** An execution gate, never a migration or implicit enable operation. */
export async function requireEnabledTool(ctx: WorkflowContext, key: ToolKey): Promise<ToolManifest> {
  ToolKeySchema.parse(key)
  const state = await readProfileTools(ctx)
  const binding = state?.enabled.find(item => item.enabled && toolKey(item.tool) === key)
  if (!binding) throw new ToolDisabledError()
  const pin = state?.pins.find(ref => toolKey(ref) === key)
  if (pin && JSON.stringify(pin) !== JSON.stringify(binding.tool)) throw new ToolDisabledError()
  const manifest = getToolManifest(binding.tool) ?? (await readImportedManifests(ctx)).find(item => JSON.stringify(item.ref) === JSON.stringify(binding.tool))
  if (!manifest) throw new Error("The captured tool version is unavailable")
  return manifest
}

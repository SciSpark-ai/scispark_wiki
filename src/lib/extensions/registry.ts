import { ToolKeySchema, ToolManifestSchema, ToolRefSchema, toolKey, type ToolKey, type ToolManifest, type ToolRef } from "./contracts"
import { NATIVE_TOOL_MANIFESTS } from "./native-catalog"

const manifests = new Map(NATIVE_TOOL_MANIFESTS.map((manifest) => [JSON.stringify(manifest.ref), manifest]))
const adapters = new Map<string, ToolAdapter>()
export type ToolAdapter = (...args: unknown[]) => Promise<unknown>

export function getToolManifest(ref: ToolRef): ToolManifest | undefined {
  const manifest = manifests.get(JSON.stringify(ToolRefSchema.parse(ref)))
  return manifest ? ToolManifestSchema.parse(manifest) : undefined
}
export function getCurrentToolManifest(key: ToolKey): ToolManifest | undefined {
  ToolKeySchema.parse(key)
  const manifest = [...manifests.values()].reverse().find((manifest) => toolKey(manifest.ref) === key)
  return manifest ? ToolManifestSchema.parse(manifest) : undefined
}
/** Catalog insertion accepts validated metadata only; it does not load skills.
 * Import/install ownership and persisted version selection belong to later tasks. */
export function registerToolManifest(candidate: ToolManifest): () => void {
  const manifest = ToolManifestSchema.parse(candidate)
  const id = JSON.stringify(manifest.ref)
  if (manifests.has(id)) throw new Error("Tool manifest already registered")
  manifests.set(id, manifest)
  return () => { if (manifests.get(id) === manifest) manifests.delete(id) }
}
/** Adapter readiness is exact-version scoped, independent of profile authorization. */
export function registerToolAdapter(ref: ToolRef, adapter: ToolAdapter): () => void {
  const id = JSON.stringify(ToolRefSchema.parse(ref))
  if (adapters.has(id)) throw new Error("Tool adapter already registered")
  if (typeof adapter !== "function") throw new Error("A tool adapter must be callable")
  adapters.set(id, adapter)
  return () => { if (adapters.get(id) === adapter) adapters.delete(id) }
}
export function hasToolAdapter(ref: ToolRef): boolean {
  return adapters.has(JSON.stringify(ToolRefSchema.parse(ref)))
}

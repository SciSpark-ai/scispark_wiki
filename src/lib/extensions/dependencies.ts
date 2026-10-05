import { ToolManifestSchema, ToolRefSchema, toolKey, type ToolManifest, type ToolRef } from "./contracts"
import { DependencySlotSchema, type ResolvedPackageGraph } from "./import-contract"
import { z } from "zod"

/** Object key order supplied by callers cannot change an immutable identity. */
export function exactRef(ref: ToolRef): string { return JSON.stringify(ToolRefSchema.parse(ref)) }
export function resolveDependencies(manifests: ToolManifest[], selected: ToolRef[]): ResolvedPackageGraph {
  if (manifests.length > 10000 || selected.length > 1000) throw new Error("Dependency graph limit exceeded")
  const catalog = new Map<string, ToolManifest>(), nodes: ToolRef[] = [], edges: ResolvedPackageGraph["edges"] = []
  for (const candidate of manifests) {
    const m = ToolManifestSchema.parse(candidate), id = exactRef(m.ref), old = catalog.get(id)
    if (old && JSON.stringify(old) !== JSON.stringify(m)) return { status: "blocked", reason: "ambiguous-manifest", nodes: [], edges: [] }
    catalog.set(id, m)
  }
  const done = new Set<string>(), visiting = new Set<string>(), versions = new Map<string, string>()
  let reason: ResolvedPackageGraph["reason"]
  const visit = (ref: ToolRef, depth: number): boolean => {
    if (depth > 1000) throw new Error("Dependency depth limit exceeded")
    const id = exactRef(ref), key = toolKey(ref), manifest = catalog.get(id)
    if (visiting.has(id)) { reason = "dependency-cycle"; return false }
    if (versions.has(key) && versions.get(key) !== id) { reason = "version-conflict"; return false }
    if (!manifest) { reason = "missing-dependency"; return false }
    if (done.has(id)) return true
    versions.set(key, id); visiting.add(id)
    for (const dep of manifest.dependencies) {
      if (edges.length >= 10000) throw new Error("Dependency edge limit exceeded")
      edges.push({ parent: manifest.ref, dependency: dep })
      if (!visit(dep, depth + 1)) return false
    }
    visiting.delete(id); done.add(id); nodes.push(manifest.ref)
    return true
  }
  for (const root of selected) if (!visit(ToolRefSchema.parse(root), 0)) return { status: "blocked", reason, nodes: [], edges: [] }
  return { status: "resolved", nodes, edges }
}

/** R3: a future runner may ask only about the candidates frozen in this slot.
 * The caller persists this result against the owning parent step, never a catalog search. */
export function selectDeclaredHelper(slots: z.infer<typeof DependencySlotSchema>[], slotId: string, candidate: ToolRef): ToolRef {
  const declared = z.array(DependencySlotSchema).max(30).parse(slots).find((slot) => slot.id === slotId)
  if (!declared) throw new Error("Undeclared dependency capability")
  const chosen = declared.eligible.find((ref) => exactRef(ref) === exactRef(candidate))
  if (!chosen) throw new Error("Helper is not an immutable eligible candidate")
  return chosen
}

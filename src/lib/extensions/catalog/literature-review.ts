import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { CatalogEntrySchema, ImportToolSchema, StagedPackageSchema, type AdapterProposal, type CatalogEntry } from "../import-contract"
import { canonicalJSON, snapshotDigest, importStorage } from "../store"
import type { ToolRef } from "../contracts"
import type { WorkflowContext } from "../../workflows/context"
import { openciteCatalogEntry } from "./opencite"
import openCiteLock from "./opencite.lock.json"
import lock from "./literature-review.lock.json"

const provenance = { source: "github" as const, locator: "https://github.com/neuromechanist/research-skills", revision: lock.researchSkillsRevision }
const outputKinds = ["markdown", "papers", "bibtex", "file"]
/** Same reviewed import identity calculation, verified against real inspect/review.
 * This is catalog data only, never an import, enabled binding or setup override. */
function snapshot(packageId: string, version: string, proposal: AdapterProposal, files: typeof lock.files) {
  const command = proposal.kind === "command" || proposal.setup.commands.length || proposal.setup.runtimes.length
  const tool = ImportToolSchema.parse({ manifest: { ref: { packageId, skillId: proposal.skillId, version, digest: "0".repeat(64) }, name: proposal.name, description: proposal.description, kind: proposal.kind, entrypoint: proposal.entrypoint, dependencies: proposal.dependencies, resources: proposal.resources, capabilities: proposal.capabilities, connections: proposal.connections, engines: proposal.engines, inputSchema: proposal.inputSchema, outputKinds: proposal.outputKinds, provenance }, proposal, inferred: false, reviewed: true, hostUnsupported: [], requirements: proposal.setup, files,
    compatibility: command ? { status: "unsupported", reasons: ["Command isolation and dependency setup are not available in package inspection"] } : { status: "ready", reasons: [] } })
  tool.manifest.ref.digest = snapshotDigest(tool)
  return tool
}
export function literatureReviewCatalogGraph() {
  const source = openciteCatalogEntry()
  const opencite = snapshot("neuromechanist.opencite", source.version, source.proposal, openCiteLock.files)
  const nodes: ReturnType<typeof snapshot>[] = []
  function node(name: string, dependencies: ToolRef[]) {
    const proposal: AdapterProposal = { skillId: `host/${name}/SKILL.md`, name: name === "lit-review" ? "Literature review" : name === "collection" ? "Strand collection" : `manuscript:${name}`, description: "Pinned full local Markdown literature-review protocol. Semantic Scholar only; unavailable evidence remains explicit. Optional GitHub, LaTeX, canonical lookup and PDF figure review are not adapted.", kind: "instructions", entrypoint: `host/${name}/protocol.md`, capabilities: name === "lit-review" ? ["literature-review"] : [], resources: lock.files.map(f => f.path), dependencies, dependencySlots: [], connections: [], engines: ["api", "codex", "claude-code"], inputSchema: name === "lit-review" ? { type: "object", properties: { question: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["question"], additionalProperties: false } : { type: "object" }, outputKinds, setup: { commands: [], runtimes: [], unsupported: [], internalModelCalls: false } }
    const result = snapshot("neuromechanist.literature-review", lock.version, proposal, lock.files)
    nodes.push(result); return result.manifest.ref
  }
  const humanizer = node("humanizer", [])
  const writing = node("manuscript-writing", [humanizer])
  const review = node("paper-review", [opencite.manifest.ref, humanizer])
  const collection = node("collection", [opencite.manifest.ref])
  node("lit-review", [collection, writing, review, humanizer])
  const graph = [opencite, ...nodes].map(t => ({ ref: t.manifest.ref, dependencies: t.manifest.dependencies }))
  if (canonicalJSON(graph) !== canonicalJSON(lock.graph) || openCiteLock.bundleDigest !== lock.opencite.bundleDigest) throw new Error("Literature-review dependency lock mismatch")
  return { opencite, nodes, root: nodes.at(-1)! }
}
export function literatureReviewCatalogEntry(): CatalogEntry {
  const { root } = literatureReviewCatalogGraph()
  return CatalogEntrySchema.parse({ id: "literature-review", name: "Literature review", version: lock.version, source: { kind: "github", url: provenance.locator, ref: provenance.revision, packageId: "neuromechanist.literature-review" }, proposal: root.proposal, requiredConnections: ["semantic-scholar"], expectedCapabilities: ["literature-review"], notices: ["LICENSE", "humanizer/LICENSE"], bundleDigest: lock.bundleDigest })
}
/** Explicit catalog selection stages inert bytes; normal review/import and the
 * exact OpenCite dependency's separate preparation are still required. */
export async function stageLiteratureReviewCatalogEntry(ctx: WorkflowContext) {
  const storage = await importStorage(ctx), id = randomUUID()
  for (const file of lock.files) {
    const bytes = await readFile(join(process.cwd(), "src/lib/extensions/catalog/literature-review", file.path))
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Literature-review bundle integrity mismatch")
    await storage.writeBinary(`imports/${id}/files/${file.path}`, bytes)
  }
  const stage = StagedPackageSchema.parse({ schemaVersion: 1, id, profileId: ctx.profileId, vaultId: ctx.vaultId, packageId: "neuromechanist.literature-review", version: lock.version, provenance, files: lock.files })
  await storage.write(`imports/${id}/stage.json`, JSON.stringify(stage))
  return stage
}

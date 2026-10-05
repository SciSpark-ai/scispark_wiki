import { randomUUID } from "node:crypto"
import { posix, join } from "node:path"
import { rm } from "node:fs/promises"
import { z } from "zod"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import type { WorkflowContext } from "../workflows/context"
import { UuidSchema } from "./contracts"
import { DiscoveryActionSchema, DiscoveryGrantSchema, DiscoveredSkillSchema, ImportPreviewSchema, type DiscoveryAction, type DiscoveryGrant, type DiscoveryRoot, type DiscoveredSkill, type ImportPreview } from "./import-contract"
import { canonicalDiscoveryRoots, collectAgentPackages } from "./agent-locations"
import { acquireAgentSnapshot, sha256 } from "./acquire"
import { inspectPackage, selectDiscoveredPreview } from "./inspect"
import { canonicalJSON, importStorage, profileRuntimePath, requireDiscoveryGrant, withDiscoveryGrant } from "./store"

const CandidateSchema = z.object({ public: DiscoveredSkillSchema, previewId: UuidSchema, skillId: z.string().min(1).max(1000) }).strict()
const RecordSchema = z.object({ grant: DiscoveryGrantSchema, scanned: z.boolean(), candidates: z.array(CandidateSchema).max(1000), stageIds: z.array(UuidSchema).max(1000) }).strict()
type Record = z.infer<typeof RecordSchema>
const recordPath = (id: string) => `discovery/grants/${UuidSchema.parse(id)}.json`
async function readRecord(ctx: WorkflowContext, id: string): Promise<Record> {
  await requireDiscoveryGrant(ctx, id)
  const storage = new NodeFsVaultStorage(profileRuntimePath(ctx))
  const record = RecordSchema.parse(JSON.parse((await storage.read(recordPath(id)))!))
  return record
}
async function save(ctx: WorkflowContext, record: Record) {
  const parsed = RecordSchema.parse(record), storage = await importStorage(ctx)
  if (await storage.hasSymlinkTraversal(recordPath(parsed.grant.id))) throw new Error("Discovery permission denied")
  if (JSON.stringify(parsed).length > 16 * 1024 * 1024) throw new Error("Discovery result limit exceeded")
  await storage.write(recordPath(parsed.grant.id), JSON.stringify(parsed))
}
export async function grantDiscovery(ctx: WorkflowContext, roots: DiscoveryRoot[]): Promise<DiscoveryGrant> {
  const canonical = await canonicalDiscoveryRoots(roots), now = Date.now()
  const grant = DiscoveryGrantSchema.parse({ id: randomUUID(), profileId: ctx.profileId, vaultId: ctx.vaultId, roots: canonical, createdAt: now, expiresAt: now + 30 * 60 * 1000, revoked: false })
  await save(ctx, { grant, scanned: false, candidates: [], stageIds: [] }); return grant
}
/** GET uses this saved projection exclusively; it never touches agent sources. */
export async function readDiscoveryResults(ctx: WorkflowContext, grantId: string): Promise<DiscoveredSkill[]> {
  return (await readRecord(ctx, grantId)).candidates.map(candidate => candidate.public)
}
function identity(tool: ImportPreview["tools"][number]) {
  const directory = posix.dirname(tool.proposal.entrypoint)
  const relative = (path: string) => posix.relative(directory, path)
  // Exclude source/version/entry aliases, include all resolved resource bytes,
  // runtime requirements and exact dependency refs. Names alone never merge.
  const proposal = { ...tool.proposal, skillId: "SKILL.md", entrypoint: "SKILL.md", resources: tool.proposal.resources.map(relative), executionCommands: tool.proposal.executionCommands?.map(command => ({ ...command, entrypoint: relative(command.entrypoint) })) }
  const files = tool.files.map(file => ({ ...file, path: relative(file.path) })).sort((a, b) => a.path.localeCompare(b.path))
  return sha256(canonicalJSON({ proposal, files, hostUnsupported: tool.hostUnsupported }))
}
export async function discoverAgentSkills(ctx: WorkflowContext, grantId: string): Promise<DiscoveredSkill[]> {
  await requireDiscoveryGrant(ctx, grantId)
  return withDiscoveryGrant(ctx, grantId, async () => {
    const record = await readRecord(ctx, grantId)
    if (record.scanned) return record.candidates.map(candidate => candidate.public)
    const check = () => { if (Date.now() >= record.grant.expiresAt) throw new Error("Discovery permission expired") }
    const packages = await collectAgentPackages(record.grant.roots, check)
    const stageIds: string[] = [], previews: string[] = []
    try {
      const candidates = new Map<string, z.infer<typeof CandidateSchema>>()
      for (const pkg of packages) {
        check()
        // Inspection snapshots are private session state; no installed binding,
        // source path, execution permission or human review is created here.
        const stage = await acquireAgentSnapshot(ctx, pkg.files, `agent-package:${pkg.sourceKey}`, grantId); stageIds.push(stage.id)
        const preview = await inspectPackage(ctx, stage, pkg.entries); previews.push(preview.id)
        for (const tool of preview.tools) {
          const digest = identity(tool), origin = { rootIndex: pkg.rootIndex, agent: record.grant.roots[pkg.rootIndex].agent, label: `${pkg.label}: ${tool.proposal.skillId}` }
          const existing = candidates.get(digest)
          if (existing) existing.public.origins.push(origin)
          else {
            const text = `${tool.manifest.name} ${tool.manifest.description}`.toLowerCase()
            const researchScore = Math.min(100, ["research", "paper", "literature", "citation", "science", "scientific", "manuscript", "bibliograph", "experiment", "dataset"].filter(term => text.includes(term)).length * 10)
            candidates.set(digest, { previewId: preview.id, skillId: tool.proposal.skillId, public: { id: randomUUID(), name: tool.manifest.name, description: tool.manifest.description, identity: digest, researchScore, origins: [origin], compatibility: tool.compatibility } })
          }
        }
      }
      check()
      record.candidates = [...candidates.values()].sort((a, b) => b.public.researchScore - a.public.researchScore || a.public.name.localeCompare(b.public.name))
      record.stageIds = stageIds; record.scanned = true; await save(ctx, record)
      return record.candidates.map(candidate => candidate.public)
    } catch (error) {
      for (const id of stageIds) await rm(join(profileRuntimePath(ctx), "imports", id), { recursive: true, force: true })
      for (const id of previews) await rm(join(profileRuntimePath(ctx), "imports", "previews", id + ".json"), { force: true })
      throw error
    }
  })
}
export async function stageDiscoveredSkill(ctx: WorkflowContext, grantId: string, candidateId: string): Promise<ImportPreview> {
  await requireDiscoveryGrant(ctx, grantId); UuidSchema.parse(candidateId)
  return withDiscoveryGrant(ctx, grantId, async () => {
    const record = await readRecord(ctx, grantId), candidate = record.candidates.find(candidate => candidate.public.id === candidateId)
    if (!candidate) throw new Error("Discovery permission: candidate is not in this session")
    return selectDiscoveredPreview(ctx, candidate.previewId, candidate.skillId)
  })
}
export async function revokeDiscovery(ctx: WorkflowContext, grantId: string): Promise<void> {
  await requireDiscoveryGrant(ctx, grantId)
  await withDiscoveryGrant(ctx, grantId, async () => {
    const record = await readRecord(ctx, grantId)
    record.grant.revoked = true; record.candidates = []; await save(ctx, record)
    // Immutable committed objects are independent of this temporary session.
    for (const id of record.stageIds) await rm(join(profileRuntimePath(ctx), "imports", id), { recursive: true, force: true })
  })
}
/** Serialized durable operation IDs cover all POST actions. Replaying an old
 * success never renews or bypasses a revoked/expired permission. */
export async function applyDiscoveryAction(ctx: WorkflowContext, input: DiscoveryAction): Promise<DiscoveryGrant | DiscoveredSkill[] | ImportPreview | { revoked: true }> {
  const action = DiscoveryActionSchema.parse(input), storage = await importStorage(ctx)
  return storage.exclusive("discovery-operations", async () => {
    const path = `discovery/operations/${action.operationId}.json`
    if (await storage.hasSymlinkTraversal(path)) throw new Error("Discovery permission denied")
    const hash = sha256(canonicalJSON(action)), raw = await storage.read(path)
    if (raw) {
      const previous = z.object({ hash: z.string(), grantId: UuidSchema, result: z.unknown(), vaultId: z.string() }).strict().parse(JSON.parse(raw))
      if (previous.hash !== hash || previous.vaultId !== ctx.vaultId) throw new Error("Discovery operation conflict")
      if (action.action !== "revoke") await requireDiscoveryGrant(ctx, previous.grantId)
      switch (action.action) {
        case "grant": return DiscoveryGrantSchema.parse(previous.result)
        case "discover": return z.array(DiscoveredSkillSchema).max(1000).parse(previous.result)
        case "stage": return ImportPreviewSchema.parse(previous.result)
        case "revoke": return z.object({ revoked: z.literal(true) }).strict().parse(previous.result)
      }
    }
    let result: DiscoveryGrant | DiscoveredSkill[] | ImportPreview | { revoked: true }
    switch (action.action) {
      case "grant": result = await grantDiscovery(ctx, action.roots); break
      case "discover": result = await discoverAgentSkills(ctx, action.grantId); break
      case "stage": result = await stageDiscoveredSkill(ctx, action.grantId, action.candidateId); break
      case "revoke": await revokeDiscovery(ctx, action.grantId); result = { revoked: true }; break
    }
    await storage.write(path, JSON.stringify({ hash, grantId: action.action === "grant" ? (result as DiscoveryGrant).id : action.grantId, result, vaultId: ctx.vaultId }))
    return result
  })
}

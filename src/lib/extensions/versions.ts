import { bindToolConnection } from "./connections"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { cancelRun, restoreAndListWorkflowRuns } from "../workflows/coordinator"
import { readWorkflowJournal, leaseOwnerAlive } from "../workflows/journal"
import { resolveRunModel } from "../workflows/model"
import { withVaultExclusive } from "../vault/exclusive"
import { ToolKeySchema, ToolOverrideSchema, ToolRefSchema, UuidSchema, DigestSchema, toolKey, type ToolKey, type ToolRef, type ProfileTools, type ToolOverride } from "./contracts"
import { UpdatePreviewSchema, UpdateSourceSchema, ApprovedUpdateSourceSchema, AdapterProposalSchema, ImportPreviewSchema, EnvironmentRecordSchema, ToolMutationSchema, ToolMutationResultSchema, ToolSetupStateSchema, ToolUpdateStateSchema, type ToolUpdateState, type EnvironmentRecord, type CompatibilityReport, type ToolMutationResult, type ToolMutation, type UpdatePreview, type ToolRemovalResult } from "./import-contract"
import { canonicalJSON, importStorage, readImportedManifests, readProfileTools, updateProfileTools, withDiscoveryGrant, requireDiscoveryGrant, readImportedTool, ManagementHistoryFullError } from "./store"
import { acquirePackage, acquireUpdateSnapshot, checkGithubRevision, sha256 } from "./acquire"
import { collectAgentPackages } from "./agent-locations"
import { inspectPackage, reviewImport, reviseImportPreview, commitImport } from "./inspect"
import { acknowledgeAndDiscardToolSetup, readToolEnvironmentState, checkToolReadiness, ensureToolEnvironment, resolveToolPreparationClosure, resolvePreparedEnvironmentRefs, resolveToolConnectionRefs } from "./setup"
import { NATIVE_TOOL_MANIFESTS } from "./native-catalog"
import { getToolManifest } from "./registry"

async function managementStorage(ctx: WorkflowContext) {
  const storage = await importStorage(ctx)
  return {
    exclusive: storage.exclusive.bind(storage),
    read: async (path: string) => { if (await storage.hasSymlinkTraversal(path)) throw new Error("Tool management path alias"); return storage.read(path) },
    write: async (path: string, value: string) => { if (await storage.hasSymlinkTraversal(path)) throw new Error("Tool management path alias"); return storage.write(path, value) },
  }
}
const RemoteCheck = z.object({ vaultId: DigestSchema, checkedAt: z.number().int().nonnegative(), revision: z.string().regex(/^[a-f0-9]{40}$/).nullable() }).strict()
const hash = (v: unknown) => sha256(canonicalJSON(v))
const sourcePath = (ref: ToolRef) => `versions/sources/${ref.digest}.json`
const PreviewRecord = z.object({ vaultId: DigestSchema, preview: UpdatePreviewSchema, importPreviewId: UuidSchema.optional(), grantId: UuidSchema.optional(), preparedTool: ToolRefSchema.optional() }).strict()
const History = z.object({ vaultId: DigestSchema, entries: z.array(z.object({ ref: ToolRefSchema, override: ToolOverrideSchema.optional() }).strict()).max(10000) }).strict()
const AuxiliaryReceipt = z.object({ hash: DigestSchema, vaultId: DigestSchema, result: z.union([UpdatePreviewSchema.nullable(), EnvironmentRecordSchema, z.object({ updated: z.literal(true) }).strict()]) }).strict()
const CheckRecord = z.object({ vaultId: DigestSchema, current: ToolRefSchema, checkedAt: z.number(), preview: UpdatePreviewSchema.nullable() }).strict()
const historyPath = (key: ToolKey) => `versions/history/${hash(ToolKeySchema.parse(key))}.json`
const same = (a: unknown, b: unknown) => canonicalJSON(a) === canonicalJSON(b)
function currentRef(state: ProfileTools | null, key: ToolKey) {
  const ref = state?.pins.find(r => toolKey(r) === key) ?? state?.enabled.find(b => toolKey(b.tool) === key)?.tool ?? NATIVE_TOOL_MANIFESTS.find(m => toolKey(m.ref) === key)?.ref
  if (!ref) throw new Error("Tool is not installed in this profile")
  return ref
}
async function readHistory(ctx: WorkflowContext, key: ToolKey) {
  const raw = await (await managementStorage(ctx)).read(historyPath(key))
  const result = raw ? History.parse(JSON.parse(raw)) : { vaultId: ctx.vaultId, entries: [] }
  if (result.vaultId !== ctx.vaultId || result.entries.some(e => toolKey(e.ref) !== key)) throw new Error("Version history ownership mismatch")
  return result
}
/** Prepared configuration is not activation authority. Only an actual current
 * binding or an atomic publication receipt makes this version rollback-eligible. */
function wasPublished(state: ProfileTools | null, ref: ToolRef): boolean {
  if (state?.pins.some(pin => same(pin, ref)) || state?.enabled.some(binding => same(binding.tool, ref))) return true
  return state?.managementOperations?.some(operation => operation.toolKey === toolKey(ref)
    && (same(operation.previousTool, ref) || same(operation.result, ref))) ?? false
}
async function remember(ctx: WorkflowContext, ref: ToolRef, override?: ToolOverride) {
  const key = toolKey(ref), history = await readHistory(ctx, key)
  // First captured per-version configuration stays immutable for rollback.
  if (!history.entries.some(e => same(e.ref, ref))) {
    history.entries.push({ ref, ...(override ? { override } : {}) })
    await (await managementStorage(ctx)).write(historyPath(key), JSON.stringify(History.parse(history)))
  }
}
/** No GC: all package/environment/configuration/run records remain retained.
 * This deliberately favors reproducibility over reclaiming disk space. */
export async function listToolVersions(ctx: WorkflowContext, key: ToolKey) {
  ToolKeySchema.parse(key)
  const history = await readHistory(ctx, key), state = await readProfileTools(ctx)
  const current = state?.pins.find(r => toolKey(r) === key) ?? state?.enabled.find(b => toolKey(b.tool) === key)?.tool
  const entries = history.entries.filter(entry => wasPublished(state, entry.ref))
  if (current && !entries.some(e => same(e.ref, current))) entries.push({ ref: current, override: state?.overrides.find(o => o.toolKey === key) })
  return Promise.all(entries.map(async entry => {
    try {
      const model = await resolveRunModel(ctx, entry.ref, same(entry.ref, current) ? state?.overrides.find(o => o.toolKey === key) ?? null : entry.override ?? null)
      const readiness = getToolManifest(entry.ref)?.kind === "native" ? { status: "ready" as const, reasons: [] } : await checkToolReadiness(ctx, entry.ref, model)
      return { ref: entry.ref, current: same(entry.ref, current), readiness: publicReadiness(readiness) }
    } catch { return { ref: entry.ref, current: same(entry.ref, current), readiness: { status: "needs-setup" as const, reasons: ["Restore the retained package and configuration before using this version"] } } }
  }))
}

/** Saved metadata observation has no source/network side effects. */
export async function readSavedToolMetadata(ctx: WorkflowContext, key: ToolKey): Promise<UpdatePreview | null> {
  ToolKeySchema.parse(key)
  const raw = await (await managementStorage(ctx)).read(`versions/checks/${hash(key)}.json`)
  if (!raw) return null
  const record = CheckRecord.parse(JSON.parse(raw))
  if (record.vaultId !== ctx.vaultId) throw new Error("Update metadata owner mismatch")
  return same(record.current, currentRef(await readProfileTools(ctx), key)) ? record.preview : null
}

/** Automatic calls only fetch remote commit metadata. Explicit checks stage bytes;
 * local/agent checks require a live grant exactly matching the saved package root. */
export async function checkToolUpdate(ctx: WorkflowContext, key: ToolKey, options: { force?: boolean; grantId?: string } = {}): Promise<UpdatePreview | null> {
  ToolKeySchema.parse(key)
  const storage = await managementStorage(ctx)
  return storage.exclusive("tool-management", async () => checkUpdate(ctx, key, options))
}
async function checkUpdate(ctx: WorkflowContext, key: ToolKey, options: { force?: boolean; grantId?: string }): Promise<UpdatePreview | null> {
  const storage = await managementStorage(ctx), current = currentRef(await readProfileTools(ctx), key)
  const raw = await storage.read(sourcePath(current))
  if (!raw) { if (options.force) throw new Error("Original source needs explicit re-import"); return null }
  const parsedOrigin = ApprovedUpdateSourceSchema.safeParse(JSON.parse(raw))
  if (!parsedOrigin.success) { if (options.force) throw new Error("Original inspected proposal is unavailable; re-import explicitly"); return null }
  const origin = parsedOrigin.data, old = await readImportedTool(ctx, current)
  if (origin.source.kind !== "github" && !options.force) return null
  const path = `versions/checks/${hash(key)}.json`, checkedAt = Date.now()
  if (!options.force) {
    const saved = await storage.read(path)
    if (saved) {
      const previous = CheckRecord.parse(JSON.parse(saved))
      if (previous.vaultId !== ctx.vaultId) throw new Error("Update check ownership mismatch")
      if (same(previous.current, current) && checkedAt - previous.checkedAt < 86400000) return previous.preview
    }
  }
  const base = { id: randomUUID(), current, changedResources: [], dependencies: [], addedCapabilities: [], addedConnections: [], checkedAt }
  const remotePath = `versions/remote-checks/${hash(origin.source)}.json`
  if (origin.source.kind === "github" && !options.force) {
    const raw = await storage.read(remotePath), cached = raw ? RemoteCheck.parse(JSON.parse(raw)) : null
    if (cached && cached.vaultId !== ctx.vaultId) throw new Error("Update check ownership mismatch")
    let revision = cached?.revision ?? null
    if (!cached || checkedAt - cached.checkedAt >= 86400000) {
      // Per-origin cache is shared by tools from the same approved repo/ref.
      // Failed attempts also count toward the automatic 24-hour limit.
      await storage.write(remotePath, JSON.stringify({ vaultId: ctx.vaultId, checkedAt, revision: null }))
      revision = await checkGithubRevision(origin.source)
      await storage.write(remotePath, JSON.stringify({ vaultId: ctx.vaultId, checkedAt, revision }))
    }
    const preview = !revision || revision === old.manifest.provenance.revision ? null : UpdatePreviewSchema.parse({ ...base, kind: "metadata", revision })
    await storage.write(path, JSON.stringify({ vaultId: ctx.vaultId, current, checkedAt, preview }))
    return preview
  }
  if (origin.source.kind !== "github" && !options.grantId) throw new Error("Renew original package read consent before checking updates")
  return withDiscoveryGrant(ctx, origin.source.kind === "github" ? undefined : options.grantId, async check => {
    let stage
    if (origin.source.kind === "github") {
      stage = await acquirePackage(ctx, origin.source)
      await storage.write(remotePath, JSON.stringify(RemoteCheck.parse({ vaultId: ctx.vaultId, checkedAt, revision: stage.provenance.revision })))
    }
    else {
      if (origin.source.kind === "zip") throw new Error("Archive update needs an explicit re-import")
      const grant = await requireDiscoveryGrant(ctx, options.grantId!)
      if (grant.roots.length !== 1 || grant.roots[0].path !== origin.source.path || grant.roots[0].layout !== "package") throw new Error("Update permission must select only the original package path")
      const packages = await collectAgentPackages(grant.roots, () => { if (Date.now() >= grant.expiresAt) throw new Error("Update permission expired") })
      if (packages.length !== 1 || packages[0].path !== origin.source.path) throw new Error("Original package is unavailable")
      await check()
      stage = await acquireUpdateSnapshot(ctx, packages[0].files, UpdateSourceSchema.parse({ source: origin.source, locator: origin.locator }), grant.id)
    }
    if (stage.packageId !== current.packageId) throw new Error("Update source identity changed; re-import explicitly")
    let inspected = await inspectPackage(ctx, stage)
    const incoming = inspected.tools.find(t => t.manifest.ref.skillId === current.skillId)
    if (!incoming) throw new Error("Updated package no longer contains this tool")
    if (!same(origin.reviewedProposal, old.proposal)) throw new Error("Original reviewed proposal is unavailable; re-import explicitly")
    // R30: compare whole validated top-level fields. Only unchanged source
    // fields inherit prior user edits; changed source fields always win.
    const merged: Record<string, unknown> = { ...incoming.proposal }
    for (const field of new Set([...Object.keys(origin.inspectedProposal), ...Object.keys(incoming.proposal), ...Object.keys(origin.reviewedProposal)])) {
      const name = field as keyof typeof incoming.proposal
      if (same(incoming.proposal[name], origin.inspectedProposal[name])) {
        if (origin.reviewedProposal[name] === undefined) delete merged[field]
        else merged[field] = origin.reviewedProposal[name]
      }
    }
    inspected = await reviseImportPreview(ctx, inspected.id, [AdapterProposalSchema.parse(merged)])
    const tool = inspected.tools[0]
    // Ignore inspection's unreviewed flag when comparing actual source content.
    if (same(tool.files, old.files) && same(tool.proposal, old.proposal) && same(tool.hostUnsupported, old.hostUnsupported)) return null
    const changedResources = [...new Set([...old.files.map(f => f.path), ...tool.files.map(f => f.path)])].filter(path => old.files.find(f => f.path === path)?.sha256 !== tool.files.find(f => f.path === path)?.sha256)
    const preview = UpdatePreviewSchema.parse({ ...base, kind: "staged", revision: stage.provenance.revision, candidate: tool.manifest.ref, changedResources, dependencies: tool.manifest.dependencies,
      addedCapabilities: tool.manifest.capabilities.filter(c => !old.manifest.capabilities.includes(c)), addedConnections: tool.manifest.connections.filter(c => !old.manifest.connections.includes(c)), proposal: tool.proposal })
    await check()
    await storage.write(`versions/previews/${preview.id}.json`, JSON.stringify(PreviewRecord.parse({ vaultId: ctx.vaultId, preview, importPreviewId: inspected.id, grantId: stage.discoveryGrantId })))
    await check()
    await storage.write(`versions/latest/${hash(key)}.json`, JSON.stringify({ id: preview.id }))
    return preview
  })
}

function receipt(state: ProfileTools | null, operationId: string, requestHash: string) {
  const previous = state?.managementOperations?.find(o => o.operationId === operationId)
  if (previous && previous.hash !== requestHash) throw new Error("Tool operation conflict")
  return previous?.result
}
function withReceipt(state: ProfileTools, key: ToolKey, operationId: string, requestHash: string, result: NonNullable<ProfileTools["managementOperations"]>[number]["result"], previousTool?: ToolRef): ProfileTools {
  if (!receipt(state, operationId, requestHash) && (state.managementOperations?.length ?? 0) >= 10000) throw new ManagementHistoryFullError()
  return { ...state, managementOperations: [...(state.managementOperations ?? []).filter(o => o.operationId !== operationId), { operationId, toolKey: key, hash: requestHash, result, ...(previousTool ? { previousTool } : {}) }] }
}
async function prepared(ctx: WorkflowContext, ref: ToolRef, install: boolean, override?: ToolOverride | null) {
  const { manifest, dependencies } = await resolveToolPreparationClosure(ctx, ref)
  const model = await resolveRunModel(ctx, ref, override)
  for (const candidate of [ref, ...dependencies]) {
    if (getToolManifest(candidate)?.kind === "native") continue
    const tool = await readImportedTool(ctx, candidate)
    if (install && tool.requirements.environment) {
      const record = await ensureToolEnvironment(ctx, candidate, tool.requirements)
      if (record.state !== "ready") throw new Error("Updated tool environment needs setup")
    }
    if ((await checkToolReadiness(ctx, candidate, model)).status !== "ready") throw new Error("Tool is not ready; review access and setup requirements")
  }
  if (manifest.engines.length && !manifest.engines.includes(model.engine)) throw new Error("Tool engine needs setup")
  await resolvePreparedEnvironmentRefs(ctx, [ref, ...dependencies], model)
  await resolveToolConnectionRefs(ctx, [ref, ...dependencies])
}
async function switchBinding(ctx: WorkflowContext, key: ToolKey, old: ToolRef, next: ToolRef, action: ToolMutation, check: () => Promise<void>, override?: ToolOverride | null) {
  return withVaultExclusive(ctx.storage, "workflow-coordinator", async () => {
    const state = await readProfileTools(ctx)
    if (!state || !same(currentRef(state, key), old)) throw new Error("Tool binding changed; check again")
    await remember(ctx, old, state.overrides.find(o => o.toolKey === key))
    await remember(ctx, next, override === undefined ? state.overrides.find(o => o.toolKey === key) : override ?? undefined)
    await updateProfileTools(ctx, async current => {
      if (!current || !same(currentRef(current, key), old)) throw new Error("Tool binding changed; check again")
      await check()
      const result = { ...current, pins: [...current.pins.filter(r => toolKey(r) !== key), next],
        enabled: current.enabled.map(b => toolKey(b.tool) === key ? { ...b, tool: next } : b),
        overrides: override === undefined ? current.overrides : [...current.overrides.filter(o => o.toolKey !== key), ...(override ? [override] : [])] }
      return withReceipt(result, key, action.operationId, hash({ key, action }), next, old)
    })
    return next
  })
}
export async function applyToolUpdate(ctx: WorkflowContext, key: ToolKey, previewId: string, operationId: string): Promise<ToolRef> {
  return ToolRefSchema.parse(await applyToolAction(ctx, key, { action: "apply-update", previewId, operationId }))
}
export async function rollbackTool(ctx: WorkflowContext, key: ToolKey, digest: string, operationId: string): Promise<ToolRef> {
  return ToolRefSchema.parse(await applyToolAction(ctx, key, { action: "rollback", digest, operationId }))
}
export async function removeTool(ctx: WorkflowContext, key: ToolKey, operationId: string, activeRunDisposition?: "finish" | "cancel"): Promise<ToolRemovalResult> {
  return ToolMutationResultSchema.parse(await applyToolAction(ctx, key, { action: "remove", operationId, activeRunDisposition })) as ToolRemovalResult
}
async function affectedRuns(ctx: WorkflowContext, key: ToolKey) {
  const runs: string[] = []
  for (const run of await restoreAndListWorkflowRuns(ctx)) {
    if (![run.tool, ...run.dependencies].some(ref => toolKey(ref) === key)) continue
    const journal = await readWorkflowJournal(ctx, run.id)
    if (!["completed", "cancelled", "failed"].includes(journal.status) || leaseOwnerAlive(journal.lease) || journal.cancelRequested) runs.push(run.id)
  }
  return runs
}
async function remove(ctx: WorkflowContext, key: ToolKey, action: Extract<ToolMutation, { action: "remove" | "enable" }>): Promise<ToolRemovalResult> {
  return withVaultExclusive(ctx.storage, "workflow-coordinator", async () => {
    const runIds = await affectedRuns(ctx, key)
    if (runIds.length && !action.activeRunDisposition) return { status: "decision-required", runIds }
    const state = await readProfileTools(ctx)
    const installed = state?.pins.find(r => toolKey(r) === key) ?? state?.enabled.find(b => toolKey(b.tool) === key)?.tool
    if (installed) await remember(ctx, installed, state?.overrides.find(o => o.toolKey === key))
    // Fence starts before sending cancellation. Finish removes in one atomic write.
    if (action.activeRunDisposition === "cancel") await updateProfileTools(ctx, current => {
      if (!current) throw new Error("Tool is not installed")
      const disabled = { ...current, enabled: current.enabled.map(b => toolKey(b.tool) === key ? { ...b, enabled: false } : b) }
      return withReceipt(disabled, key, action.operationId, hash({ key, action }), { status: "cancellation-pending", runIds }, installed)
    })
    if (action.activeRunDisposition === "cancel") {
      for (const id of runIds) {
        const journal = await readWorkflowJournal(ctx, id)
        if (!["completed", "failed", "cancelled"].includes(journal.status)) await cancelRun(ctx, id, action.operationId)
      }
      const pending = await affectedRuns(ctx, key)
      if (pending.length) return { status: "cancellation-pending", runIds: pending }
    }
    const result = { status: action.action === "remove" ? "removed" as const : "disabled" as const, runIds }
    await updateProfileTools(ctx, current => {
      if (!current) throw new Error("Tool is not installed")
      const next = action.action === "remove"
        ? { ...current, enabled: current.enabled.filter(b => toolKey(b.tool) !== key), sidebarPins: current.sidebarPins?.filter(k => k !== key), pins: current.pins.filter(r => toolKey(r) !== key), overrides: current.overrides.filter(o => o.toolKey !== key) }
        : { ...current, enabled: current.enabled.map(b => toolKey(b.tool) === key ? { ...b, enabled: false } : b), pins: installed ? [...current.pins.filter(r => toolKey(r) !== key), installed] : current.pins }
      return withReceipt(next, key, action.operationId, hash({ key, action }), result, installed)
    })
    return result
  })
}

/** All mutation entry points share strict DTOs and durable operation identity. */
export async function applyToolAction(ctx: WorkflowContext, key: ToolKey, input: ToolMutation): Promise<ToolMutationResult> {
  ToolKeySchema.parse(key)
  const action = ToolMutationSchema.parse(input), storage = await managementStorage(ctx)
  return storage.exclusive("tool-management", async () => {
    const requestHash = hash({ key, action }), state = await readProfileTools(ctx), previous = receipt(state, action.operationId, requestHash)
    if (previous && !("status" in previous && previous.status === "cancellation-pending")) return previous
    const auxiliaryPath = `versions/operations/${action.operationId}.json`, auxiliaryRaw = await storage.read(auxiliaryPath)
    if (auxiliaryRaw) {
      const saved = AuxiliaryReceipt.parse(JSON.parse(auxiliaryRaw))
      if (saved.hash !== requestHash || saved.vaultId !== ctx.vaultId) throw new Error("Tool operation conflict")
      if (action.action === "check-update" && action.grantId) await requireDiscoveryGrant(ctx, action.grantId)
      return saved.result
    }
    if (state?.managementOperations?.some(o => o.toolKey === key && o.operationId !== action.operationId && "status" in o.result && o.result.status === "cancellation-pending")) throw new Error("Tool cancellation is pending; retry the original operation after the run stops")
    if (!previous && (state?.managementOperations?.length ?? 0) >= 10000) throw new ManagementHistoryFullError()
    if (action.action === "remove" || action.action === "enable" && !action.enabled) return remove(ctx, key, action)
    const ref = currentRef(state, key)
    if (action.action === "prepare" || action.action === "bind-connection") {
      if (!state?.enabled.some(b => same(b.tool, ref))) throw new Error("Install this tool first")
      if (state.managementOperations?.some(o => o.toolKey === key && "status" in o.result && o.result.status === "cancellation-pending")) throw new Error("Wait for pending cancellation")
      const closure = await resolveToolPreparationClosure(ctx, ref)
      if (action.action === "bind-connection") {
        if (![ref, ...closure.dependencies].some(candidate => same(candidate, action.target))) throw new Error("Connection target is not in the current tool closure")
        const targetKey = toolKey(action.target), tool = await readImportedTool(ctx, action.target)
        if (!tool.manifest.connections.includes(action.service) || tool.requirements.connectionAdapter !== "scispark-http-v1") throw new Error("Connection is not declared by this tool")
        // Stable per-tool identity replaces the current selection, retaining old revisions.
        const hex = hash({ profileId: ctx.profileId, vaultId: ctx.vaultId, key: targetKey, service: action.service })
        const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`
        await bindToolConnection(ctx, targetKey, { id, service: action.service, adapter: "scispark-http-v1", credentialHandle: "settings:paperSources.s2" })
      } else for (const candidate of [ref, ...closure.dependencies]) {
        if (getToolManifest(candidate)?.kind === "native") continue
        const tool = await readImportedTool(ctx, candidate)
        if (tool.requirements.environment || tool.manifest.kind === "command" || tool.requirements.commands.length || tool.requirements.runtimes.length) {
          const setup = await ensureToolEnvironment(ctx, candidate, tool.requirements)
          if (setup.state !== "ready") break
        }
      }
      const result = { updated: true as const }
      await storage.write(auxiliaryPath, JSON.stringify(AuxiliaryReceipt.parse({ hash: requestHash, vaultId: ctx.vaultId, result })))
      return result
    }
    if (action.action === "apply-update") {
      const raw = await storage.read(`versions/previews/${action.previewId}.json`)
      if (!raw) throw new Error("Update preview is unavailable")
      const record = PreviewRecord.parse(JSON.parse(raw))
      if (record.vaultId !== ctx.vaultId || record.preview.id !== action.previewId || !same(record.preview.current, ref) || !record.importPreviewId || record.preview.kind !== "staged") throw new Error("Update preview is stale or belongs to another profile")
      return withDiscoveryGrant(ctx, record.grantId, async check => {
        const raw = await storage.read(`imports/previews/${record.importPreviewId}.json`)
        if (!raw) throw new Error("Update import preview is unavailable")
        const inspected = ImportPreviewSchema.parse(JSON.parse(raw)), tool = inspected.tools.find(t => t.manifest.ref.skillId === ref.skillId)
        if (!tool || !same(tool.proposal, record.preview.proposal) || !same(tool.manifest.ref, record.preview.candidate)) throw new Error("Update preview integrity mismatch")
        // This explicit action authorizes the exact displayed proposal.
        const reviewed = await reviewImport(ctx, inspected.id, [tool.proposal])
        const [next] = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref], { prepareCatalogOnly: true })
        await check()
        await storage.write(`versions/previews/${record.preview.id}.json`, JSON.stringify(PreviewRecord.parse({ ...record, preparedTool: next })))
        await prepared(ctx, next, true)
        return switchBinding(ctx, key, ref, next, action, check)
      })
    }
    if (action.action === "rollback") {
      const saved = (await readHistory(ctx, key)).entries.find(e => e.ref.digest === action.digest)
      if (!saved || !wasPublished(state, saved.ref)) throw new Error("Retained tool version is unavailable")
      await prepared(ctx, saved.ref, false, saved.override ?? null)
      return switchBinding(ctx, key, ref, saved.ref, action, async () => {}, saved.override ?? null)
    }
    if (action.action === "check-update" || action.action === "acknowledge-and-discard-setup") {
      if (action.action === "acknowledge-and-discard-setup") {
        const closure = await resolveToolPreparationClosure(ctx, ref)
        const belongs = toolKey(action.tool) === key || closure.dependencies.some(candidate => same(candidate, action.tool))
        if (!belongs || !(await readImportedManifests(ctx)).some(m => same(m.ref, action.tool))) throw new Error("Setup tool is not owned by this profile")
      }
      const result = action.action === "check-update" ? await checkUpdate(ctx, key, { force: true, grantId: action.grantId }) : await acknowledgeAndDiscardToolSetup(ctx, action.tool, action.setupId, action.operationId)
      await storage.write(auxiliaryPath, JSON.stringify(AuxiliaryReceipt.parse({ hash: requestHash, vaultId: ctx.vaultId, result })))
      return result
    }
    if (action.action === "enable" && action.enabled) await prepared(ctx, ref, false)
    return withVaultExclusive(ctx.storage, "workflow-coordinator", async () => {
      await updateProfileTools(ctx, current => {
        if (!current || !same(currentRef(current, key), ref)) throw new Error("Tool binding changed")
        let next = current
        if (action.action === "enable") next = { ...current, pins: [...current.pins.filter(p => toolKey(p) !== key), ref], enabled: [...current.enabled.filter(b => toolKey(b.tool) !== key), { tool: ref, enabled: action.enabled }] }
        if (action.action === "binding") next = { ...current, overrides: [...current.overrides.filter(o => o.toolKey !== key), ToolOverrideSchema.parse({ ...current.overrides.find(o => o.toolKey === key), ...action.patch, toolKey: key })] }
        return withReceipt(next, key, action.operationId, requestHash, { updated: true })
      })
      return { updated: true }
    })
  })
}

function publicReadiness(readiness: CompatibilityReport): CompatibilityReport {
  const reasons = { "ready": "", "needs-review": "Review the tool's access and setup requirements", "needs-setup": "Prepare the required environment, model and connections", "unsupported": "Required execution support is unavailable" }
  return { status: readiness.status, reasons: readiness.status === "ready" ? [] : [reasons[readiness.status]] }
}
export function projectToolSetup(record: EnvironmentRecord) {
  const reasons: Record<EnvironmentRecord["state"], string> = {
    "needs-setup": "Prepare this tool before starting a run", installing: "Setup is in progress", interrupted: "Setup stopped; review and retry",
    "needs-reconciliation": "A setup attempt is uncertain. Acknowledge and discard its staging before retrying; previous usage remains charged.",
    unsupported: "Required execution support is unavailable", ready: "The retained environment is prepared",
  }
  return ToolSetupStateSchema.parse({ tool: record.tool, setupId: record.setupId, state: record.state, reason: reasons[record.state] })
}
/** Saved staging/result metadata only. Original source folders are never read. */
export async function readToolUpdate(ctx: WorkflowContext, key: ToolKey): Promise<ToolUpdateState | null> {
  ToolKeySchema.parse(key)
  const storage = await managementStorage(ctx), raw = await storage.read(`versions/latest/${hash(key)}.json`)
  if (!raw) return null
  const { id } = z.object({ id: UuidSchema }).strict().parse(JSON.parse(raw))
  const recordRaw = await storage.read(`versions/previews/${id}.json`)
  if (!recordRaw) return null
  const record = PreviewRecord.parse(JSON.parse(recordRaw)), state = await readProfileTools(ctx)
  const current = state?.pins.find(r => toolKey(r) === key) ?? state?.enabled.find(b => toolKey(b.tool) === key)?.tool
  if (record.vaultId !== ctx.vaultId || record.preview.id !== id || !same(record.preview.current, current)) return null
  const consent = !record.grantId ? "not-required" : await requireDiscoveryGrant(ctx, record.grantId).then(() => "valid" as const, () => "renewal-required" as const)
  let readiness: CompatibilityReport | undefined, setup: ReturnType<typeof projectToolSetup> | undefined
  if (record.preparedTool) {
    try {
      readiness = publicReadiness(await checkToolReadiness(ctx, record.preparedTool))
      const environment = await readToolEnvironmentState(ctx, record.preparedTool)
      if (environment) setup = projectToolSetup(environment)
    } catch { readiness = { status: "needs-setup", reasons: ["Restore the pending package and setup state"] } }
  }
  return ToolUpdateStateSchema.parse({ preview: record.preview, consent, preparedTool: record.preparedTool, readiness, setup })
}

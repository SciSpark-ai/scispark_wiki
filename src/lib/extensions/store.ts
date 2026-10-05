import { join } from "node:path"
import { AsyncLocalStorage } from "node:async_hooks"
import { mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { z } from "zod"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { DiscoveryGrantSchema, ImportToolSchema, type ImportPreview } from "./import-contract"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "../workflows/context"
import { DigestSchema, ProfileIdSchema, ProfileToolsSchema, ToolRefSchema, UuidSchema, toolKey, type ToolManifest, type ToolRef, type ProfileTools } from "./contracts"

const STATE_PATH = ".scispark/tools/state.json"
export function extensionObjectPath(ctx: WorkflowContext, digest: string): string {
  return join(ctx.runtimeRoot, "objects", DigestSchema.parse(digest))
}
export function profileRuntimePath(ctx: WorkflowContext): string {
  return join(ctx.runtimeRoot, "profiles", ProfileIdSchema.parse(ctx.profileId))
}
export async function readProfileTools(ctx: WorkflowContext): Promise<ProfileTools | null> {
  ProfileIdSchema.parse(ctx.profileId)
  DigestSchema.parse(ctx.vaultId)
  const raw = await ctx.storage.read(STATE_PATH)
  return raw === null ? null : ProfileToolsSchema.parse(JSON.parse(raw))
}
export async function writeProfileTools(ctx: WorkflowContext, state: ProfileTools): Promise<void> {
  await updateProfileTools(ctx, () => state)
}

/** One exclusion boundary owns the read/modify/atomic-write cycle. Callers must
 * not nest writeProfileTools under the same profile-tools lock. */
export async function updateProfileTools(ctx: WorkflowContext, update: (current: ProfileTools | null) => Promise<ProfileTools> | ProfileTools): Promise<ProfileTools> {
  ProfileIdSchema.parse(ctx.profileId)
  DigestSchema.parse(ctx.vaultId)
  return withVaultExclusive(ctx.storage, "profile-tools", async () => {
    const current = await readProfileTools(ctx)
    const state = ProfileToolsSchema.parse(await update(current))
    // Every binding writer shares this fence, including ordinary imports. Check
    // under profile-tools after the callback without acquiring another lock.
    // Completing cancellation may remove/disable the binding, but cannot reopen
    // it in the same transaction while the prior cancellation is still pending.
    const cancelling = new Set((current?.managementOperations ?? []).filter(operation => "status" in operation.result && operation.result.status === "cancellation-pending").map(operation => operation.toolKey))
    if (state.enabled.some(binding => binding.enabled && cancelling.has(toolKey(binding.tool)))) throw new Error("Tool cancellation is pending; finish the original operation before enabling it")
    if (JSON.stringify(current) !== JSON.stringify(state)) await ctx.storage.write(STATE_PATH, JSON.stringify(state, null, 2))
    return state
  })
}

/** Runtime import records are profile-owned, outside research content. */
export async function importStorage(ctx: WorkflowContext): Promise<NodeFsVaultStorage> {
  DigestSchema.parse(ctx.vaultId)
  const root = profileRuntimePath(ctx)
  const runtime = new NodeFsVaultStorage(ctx.runtimeRoot)
  if (await runtime.hasSymlinkTraversal(`profiles/${ctx.profileId}`)) throw new Error("Import runtime symlink traversal")
  await mkdir(root, { recursive: true, mode: 0o700 })
  return new NodeFsVaultStorage(root)
}

const ImportCatalogSchema = z.object({ schemaVersion: z.literal(1), tools: z.array(ToolRefSchema).max(10000) }).strict()
export const ImportedSnapshotSchema = z.object({ schemaVersion: z.literal(1), tool: ImportToolSchema }).strict()

/** Durable metadata lookup never registers executable adapters or selects a
 * newer version. Integrity checks make corruption a setup failure, not a fallback. */
export async function readImportedManifests(ctx: WorkflowContext): Promise<ToolManifest[]> {
  const storage = await importStorage(ctx), raw = await storage.read("imports/catalog.json")
  if (!raw) return []
  const catalog = ImportCatalogSchema.parse(JSON.parse(raw))
  const manifests: ToolManifest[] = []
  for (const ref of catalog.tools) {
    const object = new NodeFsVaultStorage(extensionObjectPath(ctx, ref.digest))
    if (await new NodeFsVaultStorage(ctx.runtimeRoot).hasSymlinkTraversal(`objects/${ref.digest}/snapshot.json`)) throw new Error("Import object symlink traversal")
    const snapshot = await object.read("snapshot.json")
    if (!snapshot) throw new Error("Missing immutable import snapshot")
    const { tool } = ImportedSnapshotSchema.parse(JSON.parse(snapshot))
    if (JSON.stringify(tool.manifest.ref) !== JSON.stringify(ref)) throw new Error("Import snapshot identity mismatch")
    if (snapshotDigest(tool) !== ref.digest) throw new Error("Import snapshot digest mismatch")
    manifests.push(tool.manifest)
  }
  return manifests
}

/** Stable JSON prevents caller property order from changing content identity. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => `${JSON.stringify(key)}:${canonicalJSON(v)}`).join(",")}}`
  return JSON.stringify(value)
}
export function snapshotDigest(tool: ImportPreview["tools"][number]): string {
  const content = { ...tool, manifest: { ...tool.manifest, ref: { ...tool.manifest.ref, digest: "" } } }
  return createHash("sha256").update(canonicalJSON(content)).digest("hex")
}

export async function recordImportedRefs(ctx: WorkflowContext, refs: ToolRef[], beforePublish?: () => Promise<void>): Promise<void> {
  const storage = await importStorage(ctx)
  await storage.exclusive("imports-catalog", async () => {
    const raw = await storage.read("imports/catalog.json")
    const catalog = raw ? ImportCatalogSchema.parse(JSON.parse(raw)) : { schemaVersion: 1 as const, tools: [] as ToolRef[] }
    const tools = new Map(catalog.tools.map((ref) => [JSON.stringify(ref), ref]))
    for (const ref of refs) tools.set(JSON.stringify(ToolRefSchema.parse(ref)), ref)
    // Check inside the catalog lock, after contention and persisted-state reads.
    await beforePublish?.()
    await storage.write("imports/catalog.json", JSON.stringify(ImportCatalogSchema.parse({ schemaVersion: 1, tools: [...tools.values()] })))
  })
}

/** Also used by Task 7: stale staged previews cannot bypass revoked consent. */
export async function requireDiscoveryGrant(ctx: WorkflowContext, id: string) {
  if (!UuidSchema.safeParse(id).success) throw new Error("Discovery permission required")
  const root = profileRuntimePath(ctx), storage = new NodeFsVaultStorage(root)
  const path = `discovery/grants/${id}.json`
  if (await new NodeFsVaultStorage(ctx.runtimeRoot).hasSymlinkTraversal(`profiles/${ctx.profileId}/${path}`)) throw new Error("Discovery permission denied")
  const raw = await storage.read(path)
  if (!raw) throw new Error("Discovery permission required")
  const grant = DiscoveryGrantSchema.parse(JSON.parse(raw).grant)
  if (grant.id !== id || grant.profileId !== ctx.profileId || grant.vaultId !== ctx.vaultId || grant.revoked || Date.now() >= grant.expiresAt) throw new Error("Discovery permission expired or revoked")
  return grant
}


type DiscoveryGuard = { key: string; active: boolean }
const discoveryGuard = new AsyncLocalStorage<DiscoveryGuard>()
/** Lock order: discovery-operations (if any) -> grant -> object/catalog or
 * profile-tools. Never acquire a grant while holding a profile-tools lock.
 * Scoped reentry lets discovery inspection/selection reuse the same grant lock;
 * the active bit prevents detached callbacks from reusing an ended scope.
 * Publication callers must invoke check() after validation/preparation and
 * immediately before starting their persisted publication transaction. */
export async function withDiscoveryGrant<T>(ctx: WorkflowContext, id: string | undefined, work: (check: () => Promise<void>) => Promise<T>): Promise<T> {
  if (!id) return work(async () => {})
  UuidSchema.parse(id)
  const key = `${profileRuntimePath(ctx)}:${ctx.vaultId}:${id}`
  const check = async () => { await requireDiscoveryGrant(ctx, id) }
  const current = discoveryGuard.getStore()
  if (current?.active && current.key === key) { await check(); return work(check) }
  if (current?.active) throw new Error("Cannot nest different discovery grants")
  const storage = await importStorage(ctx)
  return storage.exclusive(`discovery-${id}`, async () => {
    const scope = { key, active: true }
    return discoveryGuard.run(scope, async () => {
      try { await check(); return await work(check) }
      finally { scope.active = false }
    })
  })
}

/** Shared integrity-checked lookup; ownership comes from the profile catalog. */
export async function readImportedTool(ctx: WorkflowContext, ref: ToolRef) {
  ToolRefSchema.parse(ref)
  if (!(await readImportedManifests(ctx)).some(m => canonicalJSON(m.ref) === canonicalJSON(ref))) throw new Error("Tool is not imported by this profile")
  const object = new NodeFsVaultStorage(extensionObjectPath(ctx, ref.digest))
  const raw = await object.read("snapshot.json")
  if (!raw) throw new Error("Missing immutable import snapshot")
  const tool = ImportedSnapshotSchema.parse(JSON.parse(raw)).tool
  if (snapshotDigest(tool) !== ref.digest || canonicalJSON(tool.manifest.ref) !== canonicalJSON(ref)) throw new Error("Import snapshot identity mismatch")
  for (const file of tool.files) {
    const path = `files/${file.path}`
    if (await object.hasSymlinkTraversal(path)) throw new Error("Import object symlink traversal")
    const bytes = await object.readBinary(path)
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Immutable snapshot content corruption")
  }
  return tool
}

export class ManagementHistoryFullError extends Error {
  readonly code = "management-history-full"
  constructor() { super("Tool management history is full. Existing runs and saved versions remain available; contact support before making more tool changes.") }
}

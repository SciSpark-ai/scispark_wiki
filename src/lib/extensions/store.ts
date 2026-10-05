import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { z } from "zod"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { ImportToolSchema, type ImportPreview } from "./import-contract"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "../workflows/context"
import { DigestSchema, ProfileIdSchema, ProfileToolsSchema, ToolRefSchema, type ToolManifest, type ToolRef, type ProfileTools } from "./contracts"

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

export async function recordImportedRefs(ctx: WorkflowContext, refs: ToolRef[]): Promise<void> {
  const storage = await importStorage(ctx)
  await storage.exclusive("imports-catalog", async () => {
    const raw = await storage.read("imports/catalog.json")
    const catalog = raw ? ImportCatalogSchema.parse(JSON.parse(raw)) : { schemaVersion: 1 as const, tools: [] as ToolRef[] }
    const tools = new Map(catalog.tools.map((ref) => [JSON.stringify(ref), ref]))
    for (const ref of refs) tools.set(JSON.stringify(ToolRefSchema.parse(ref)), ref)
    await storage.write("imports/catalog.json", JSON.stringify(ImportCatalogSchema.parse({ schemaVersion: 1, tools: [...tools.values()] })))
  })
}

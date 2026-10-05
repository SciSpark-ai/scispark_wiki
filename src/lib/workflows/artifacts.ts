import { createHash } from "node:crypto"
import { UuidSchema } from "../extensions/contracts"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "./context"
import { ArtifactInputSchema, ArtifactSchema, MAX_ARTIFACT_BYTES, WorkflowJournalSchema, type Artifact, type ArtifactInput, type WorkflowLease } from "./contracts"
import { canonicalJson } from "./journal"
import { readRun } from "./store"

/** All artifact paths are host allocated and every existing component must be real. */
export async function assertWorkflowPath(ctx: WorkflowContext, path: string): Promise<void> {
  if (ctx.storage instanceof NodeFsVaultStorage && await ctx.storage.hasSymlinkTraversal(path)) throw new Error("Workflow symlink traversal is forbidden")
}
/** Called only while holding the existing workflow lock; lifecycle remains
 * authoritative in journal.ts. Output publication cannot outlive its owner. */
export async function assertOutputOwner(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<void> {
  const path = `.scispark/tool-runs/${UuidSchema.parse(id)}/journal.json`
  await assertWorkflowPath(ctx, path)
  const journal = WorkflowJournalSchema.parse(JSON.parse(await ctx.storage.read(path) ?? "null"))
  if (journal.runId !== id || journal.profileId !== ctx.profileId || journal.vaultId !== ctx.vaultId || journal.status !== "running" || journal.cancelRequested
    || journal.lease?.id !== lease.id || journal.lease.processId !== lease.processId || journal.lease.pid !== lease.pid) throw new Error("Workflow output no longer owned")
}
export const artifactRoot = (id: string) => `.scispark/tool-runs/${UuidSchema.parse(id)}/artifacts/`
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
async function owner(ctx: WorkflowContext, id: string) {
  await assertWorkflowPath(ctx, `.scispark/tool-runs/${UuidSchema.parse(id)}/run.json`)
  const run = await readRun(ctx, id)
  if (!run) throw new Error("Workflow run not found")
  return run
}
/** Content identity makes adapter replay recover the same publication, including
 * a crash after metadata commit but before the run-reference mirror. */
export async function publishArtifact(ctx: WorkflowContext, runId: string, input: ArtifactInput, lease?: WorkflowLease): Promise<Artifact> {
  const value = ArtifactInputSchema.parse(input)
  const bytes = new Uint8Array(value.bytes), sha256 = hash(bytes)
  const identity = createHash("sha256").update(canonicalJson({ runId, ...value, bytes: sha256 })).digest("hex")
  const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-8${identity.slice(17, 20)}-${identity.slice(20, 32)}`
  const path = `${artifactRoot(runId)}${id}.bin`, metadataPath = `${artifactRoot(runId)}${id}.json`
  await owner(ctx, runId)
  await assertWorkflowPath(ctx, `.scispark/locks/workflow-${runId}`)
  return withVaultExclusive(ctx.storage, `workflow-${runId}`, async () => {
    const run = await owner(ctx, runId)
    if (lease) await assertOutputOwner(ctx, runId, lease)
    await assertWorkflowPath(ctx, path); await assertWorkflowPath(ctx, metadataPath)
    const artifact = ArtifactSchema.parse({ id, kind: value.kind, title: value.title, path, sha256, mediaType: value.mediaType, sourceRefs: value.sourceRefs })
    if (await ctx.storage.read(metadataPath) !== null) {
      const existing = await readArtifact(ctx, runId, id)
      if (canonicalJson(existing.metadata) !== canonicalJson(artifact)) throw new Error("Artifact identity conflict")
    } else {
      await ctx.storage.writeBinary(path, bytes)
      await ctx.storage.write(metadataPath, JSON.stringify(artifact))
    }
    if (!run.artifacts.some(a => a.id === id)) await ctx.storage.write(`.scispark/tool-runs/${runId}/run.json`, JSON.stringify({ ...run, artifacts: [...run.artifacts, artifact] }, null, 2))
    return artifact
  })
}
export async function readArtifact(ctx: WorkflowContext, runId: string, artifactId: string): Promise<{ metadata: Artifact; bytes: Uint8Array }> {
  await owner(ctx, runId)
  const id = UuidSchema.parse(artifactId), metadataPath = `${artifactRoot(runId)}${id}.json`
  await assertWorkflowPath(ctx, metadataPath)
  const raw = await ctx.storage.read(metadataPath)
  if (raw === null) throw new Error("Artifact not found")
  const metadata = ArtifactSchema.parse(JSON.parse(raw)), path = `${artifactRoot(runId)}${id}.bin`
  if (metadata.id !== id || metadata.path !== path) throw new Error("Artifact identity mismatch")
  // Revalidate metadata using the input limits as well as the durable contract.
  ArtifactInputSchema.parse({ kind: metadata.kind, title: metadata.title, mediaType: metadata.mediaType, sourceRefs: metadata.sourceRefs, bytes: new Uint8Array() })
  await assertWorkflowPath(ctx, path)
  const bytes = await ctx.storage.readBinary(path)
  if (bytes === null || bytes.byteLength > MAX_ARTIFACT_BYTES || hash(bytes) !== metadata.sha256) throw new Error("Artifact hash mismatch")
  return { metadata, bytes }
}

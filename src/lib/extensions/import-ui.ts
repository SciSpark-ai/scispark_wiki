import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { mkdir, rm, writeFile } from "node:fs/promises"
import type { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { acquirePackage } from "./acquire"
import { readImportPreview, inspectPackage, reviewImport, reviseImportPreview, commitImport } from "./inspect"
import { DiscoveryStageDtoSchema, IMPORT_LIMITS, type ImportPreview } from "./import-contract"
import { ImportRequestSchema, ImportStateSchema, ImportActionSchema } from "./ui-contract"
import { stageOpenCiteCatalogEntry, openciteCatalogEntry } from "./catalog/opencite"
import { observeToolPreparation } from "./observation"
import { canonicalJSON, withDiscoveryGrant, importStorage, profileRuntimePath } from "./store"
import { StagedPackageSchema } from "./import-contract"
/** Project before returning anything: source paths, owners and runtime records stay private. */
export function projectImport(preview: ImportPreview) {
  return DiscoveryStageDtoSchema.parse({ schemaVersion: preview.schemaVersion, id: preview.id, stageId: preview.stageId, recognizedMetadata: preview.recognizedMetadata, warnings: preview.warnings,
    tools: preview.tools.map(tool => ({ ...tool, manifest: { ...tool.manifest, provenance: { ...tool.manifest.provenance, locator: tool.manifest.provenance.source === "local" ? "Selected local package" : tool.manifest.provenance.locator } } })) })
}
export async function previewImport(ctx: WorkflowContext, input: z.infer<typeof ImportRequestSchema>) {
  const request = ImportRequestSchema.parse(input)
  let preview
  if ("catalogId" in request) {
    preview = await inspectPackage(ctx, await stageOpenCiteCatalogEntry(ctx))
    preview = await reviseImportPreview(ctx, preview.id, [openciteCatalogEntry().proposal])
  } else preview = await inspectPackage(ctx, await acquirePackage(ctx, request.source))
  return projectImport(preview)
}
export async function previewZipUpload(ctx: WorkflowContext, request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error("Choose a ZIP file")
  const chunks: Uint8Array[] = []; let bytes = 0
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > IMPORT_LIMITS.compressedBytes) { await reader.cancel(); return Response.json({ error: "ZIP exceeds 50 MiB." }, { status: 413 }) }; chunks.push(chunk.value) } } finally { reader.releaseLock() }
  const directory = join(profileRuntimePath(ctx), "uploads", randomUUID()), path = join(directory, "upload.zip")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try { await writeFile(path, Buffer.concat(chunks), { mode: 0o600 }); return projectImport(await inspectPackage(ctx, await acquirePackage(ctx, { kind: "zip", path }))) }
  finally { await rm(directory, { recursive: true, force: true }) }
}
export async function inspectImportState(ctx: WorkflowContext, id: string) {
  const preview = await readImportPreview(ctx, id), storage = await importStorage(ctx)
  const stage = StagedPackageSchema.parse(JSON.parse((await storage.read(`imports/${preview.stageId}/stage.json`)) ?? "null"))
  return withDiscoveryGrant(ctx, stage.discoveryGrantId, async () => {
    const tools = await Promise.all(preview.tools.map(async t => {
      const observation = t.reviewed
        ? await observeToolPreparation(ctx, t.manifest.ref)
        : { readiness: t.compatibility, connectionRequirements: [] }
      return { tool: t.manifest.ref, ...observation }
    }))
    return ImportStateSchema.parse({ preview: projectImport(preview), tools })
  })
}
export async function actOnImport(ctx: WorkflowContext, id: string, input: z.infer<typeof ImportActionSchema>) {
  const action = ImportActionSchema.parse(input), preview = await readImportPreview(ctx, id)
  const storage = await importStorage(ctx)
  const stage = StagedPackageSchema.parse(JSON.parse((await storage.read(`imports/${preview.stageId}/stage.json`)) ?? "null"))
  return withDiscoveryGrant(ctx, stage.discoveryGrantId, async () => {
    if (action.selected.some(ref => !preview.tools.some(t => canonicalJSON(t.manifest.ref) === canonicalJSON(ref)))) throw new Error("Stale import selection")
    // Review may normalize the proposal/ref; select only the explicitly reviewed skills.
    const reviewed = await reviewImport(ctx, id, action.proposals)
    await commitImport(ctx, reviewed.id, action.selected.map(ref => { const t = reviewed.tools.find(t => t.manifest.ref.skillId === ref.skillId); if (!t) throw new Error("Missing reviewed tool"); return t.manifest.ref }))
    return inspectImportState(ctx, reviewed.id)
  })
}

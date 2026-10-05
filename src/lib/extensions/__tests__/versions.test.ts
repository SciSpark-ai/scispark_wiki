// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { acquirePackage } from "../acquire"
import { inspectPackage, reviewImport, commitImport } from "../inspect"
import { grantDiscovery, revokeDiscovery } from "../discovery"
import { toolKey } from "../contracts"
import { readProfileTools, extensionObjectPath } from "../store"
import { listEnabledTools } from "../profile-state"
import { checkToolUpdate, applyToolUpdate, rollbackTool, removeTool, applyToolAction, listToolVersions } from "../versions"
import { ToolMutationSchema } from "../import-contract"
import * as setup from "../setup"

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const skill = (body: string, extra = "") => `---\nname: Research\nscispark:\n  engines: [api, codex, claude-code]\n${extra}---\n${body}`
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "scispark-versions-"))); roots.push(root)
  const source = join(root, "source"), vaultPath = join(root, "vault"), runtimeRoot = join(root, "runtime")
  await Promise.all([source, vaultPath, runtimeRoot].map(p => mkdir(p)))
  await writeFile(join(source, "SKILL.md"), skill("Original content"))
  const ctx = { profileId: randomUUID(), vaultId: "a".repeat(64), vaultPath, runtimeRoot, storage: new NodeFsVaultStorage(vaultPath) }
  const inspected = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
  const reviewed = await reviewImport(ctx, inspected.id, inspected.tools.map(t => t.proposal))
  const [ref] = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
  return { root, source, ctx, ref, key: toolKey(ref) }
}
async function changed(f: Awaited<ReturnType<typeof fixture>>, extra = "") {
  await writeFile(join(f.source, "SKILL.md"), skill("Changed content", extra))
  const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.source }])
  const preview = await checkToolUpdate(f.ctx, f.key, { force: true, grantId: grant.id })
  return { preview: preview!, grant }
}

describe("profile tool version lifecycle", () => {
  it("requires renewed original-path consent and leaves checks inert", async () => {
    const f = await fixture()
    expect(await checkToolUpdate(f.ctx, f.key)).toBeNull()
    await expect(checkToolUpdate(f.ctx, f.key, { force: true })).rejects.toThrow(/consent|permission/)
    const { preview, grant } = await changed(f)
    expect(preview.changedResources).toContain("SKILL.md")
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
    await revokeDiscovery(f.ctx, grant.id)
    await expect(applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())).rejects.toThrow(/expired|revoked/)
  })
  it("prepares before switching, retains both successful versions, and never rewinds research", async () => {
    const f = await fixture(), { preview } = await changed(f)
    await f.ctx.storage.write("wiki/user.md", "New research")
    const operationId = randomUUID()
    const updated = await applyToolUpdate(f.ctx, f.key, preview.id, operationId)
    expect(updated.digest).not.toBe(f.ref.digest)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(updated)
    expect(await applyToolUpdate(f.ctx, f.key, preview.id, operationId)).toEqual(updated)
    expect((await listToolVersions(f.ctx, f.key)).map(v => v.ref.digest)).toEqual(expect.arrayContaining([f.ref.digest, updated.digest]))
    await rollbackTool(f.ctx, f.key, f.ref.digest, randomUUID())
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
    expect(await f.ctx.storage.read("wiki/user.md")).toBe("New research")
    expect(await new NodeFsVaultStorage(extensionObjectPath(f.ctx, updated.digest)).read("snapshot.json")).toBeTruthy()
  })
  it("keeps the old binding on unsupported setup and exposes added requirements", async () => {
    const f = await fixture(), { preview } = await changed(f, "  capabilities: [network-access]\n  connections: [unsupported-service]\n")
    expect(preview.addedCapabilities).toEqual(["network-access"])
    expect(preview.addedConnections).toEqual(["unsupported-service"])
    await expect(applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())).rejects.toThrow(/ready|setup|unsupported/)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
    expect(await rollbackTool(f.ctx, f.key, "f".repeat(64), randomUUID()).catch(() => null)).toBeNull()
  })
  it("keeps profiles separate and rejects mismatched operation replay", async () => {
    const f = await fixture()
    const otherPath = join(f.root, "other"); await mkdir(otherPath)
    const other = { ...f.ctx, profileId: randomUUID(), vaultId: "b".repeat(64), vaultPath: otherPath, storage: new NodeFsVaultStorage(otherPath) }
    const p = await inspectPackage(other, await acquirePackage(other, { kind: "local-folder", path: f.source }))
    const r = await reviewImport(other, p.id, p.tools.map(t => t.proposal)); await commitImport(other, r.id, [r.tools[0].manifest.ref])
    const { preview } = await changed(f), op = randomUUID()
    await expect(applyToolUpdate(other, f.key, preview.id, op)).rejects.toThrow()
    await applyToolUpdate(f.ctx, f.key, preview.id, op)
    expect((await listEnabledTools(other))[0].ref.digest).toBe(f.ref.digest)
    await expect(rollbackTool(f.ctx, f.key, f.ref.digest, op)).rejects.toThrow(/conflict/)
  })
  it("provides strict binding and explicit uncertain-setup discard actions", async () => {
    const f = await fixture(), operationId = randomUUID(), setupId = randomUUID()
    expect(ToolMutationSchema.safeParse({ action: "remove", operationId, activeRunDisposition: "ignore" }).success).toBe(false)
    expect(ToolMutationSchema.safeParse({ action: "enable", operationId, enabled: false, extra: true }).success).toBe(false)
    const discard = vi.spyOn(setup, "acknowledgeAndDiscardToolSetup").mockRejectedValue(new Error("fixture containment unavailable"))
    await expect(applyToolAction(f.ctx, f.key, { action: "acknowledge-and-discard-setup", operationId, tool: f.ref, setupId })).rejects.toThrow("fixture containment")
    expect(discard).toHaveBeenCalledWith(f.ctx, f.ref, setupId, operationId)
    await removeTool(f.ctx, f.key, randomUUID())
    expect((await readProfileTools(f.ctx))!.enabled).toEqual([])
    expect(await new NodeFsVaultStorage(extensionObjectPath(f.ctx, f.ref.digest)).read("snapshot.json")).toBeTruthy()
  })
})

import { workflowFixture } from "../../workflows/__tests__/fixtures"
import { writeRun, readRun } from "../../workflows/store"
import { publishArtifact, readArtifact } from "../../workflows/artifacts"
import { claimRunLease, readWorkflowJournal, acknowledgeRunCancellation, releaseRunLease } from "../../workflows/journal"
import { startRun, waitForWorkflowIdle } from "../../workflows/coordinator"
import { importStorage, writeProfileTools, canonicalJSON, snapshotDigest } from "../store"
import * as acquisition from "../acquire"
import { registerWorkflowAdapter } from "../../workflows/adapters"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import { NextRequest } from "next/server"
import * as route from "@/app/api/tools/[key]/route"
import * as profiles from "../../server/local-profiles"
import * as contexts from "../../workflows/context"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../../local-profile-contract"
async function retainedRun(f: Awaited<ReturnType<typeof fixture>>) {
  const run = { ...workflowFixture().run, id: randomUUID(), operationId: randomUUID(), profileId: f.ctx.profileId, vaultId: f.ctx.vaultId, tool: f.ref, status: "paused_limit" as const,
    preparedEnvironmentRefs: [{ id: randomUUID(), digest: "c".repeat(64), lockDigest: "d".repeat(64) }], connectionConfigurationRefs: [{ id: randomUUID(), revision: "e".repeat(64) }] }
  await writeRun(f.ctx, run)
  const storage = await importStorage(f.ctx)
  const paths = [ `environments/${run.preparedEnvironmentRefs[0].id}/record.json`, `connections/${run.connectionConfigurationRefs[0].id}/${run.connectionConfigurationRefs[0].revision}.json`, `commands/setup/${randomUUID()}/output/retained.txt` ]
  for (const path of paths) await storage.write(path, "retained fixture")
  return { run, paths }
}
describe("retention, acknowledged cancellation and strict API boundaries", () => {
  it("keeps captured run refs, settings, journals and completed artifacts across update, rollback and finish removal", async () => {
    const f = await fixture(), { run, paths } = await retainedRun(f)
    const finished = { ...run, id: randomUUID(), operationId: randomUUID(), status: "completed" as const }
    await writeRun(f.ctx, finished)
    const artifact = await publishArtifact(f.ctx, finished.id, { title: "Saved result", kind: "markdown", mediaType: "text/markdown", sourceRefs: [], bytes: new TextEncoder().encode("Preserved result") })
    const { preview } = await changed(f)
    await applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())
    expect(await readRun(f.ctx, run.id)).toEqual(run)
    expect(await removeTool(f.ctx, f.key, randomUUID())).toEqual({ status: "decision-required", runIds: [run.id] })
    expect((await readProfileTools(f.ctx))!.enabled[0].enabled).toBe(true)
    expect(await removeTool(f.ctx, f.key, randomUUID(), "finish")).toMatchObject({ status: "removed" })
    expect((await readRun(f.ctx, run.id))!.tool.digest).toBe(f.ref.digest)
    for (const path of paths) expect(await (await importStorage(f.ctx)).read(path)).toBe("retained fixture")
    expect(new TextDecoder().decode((await readArtifact(f.ctx, finished.id, artifact.id)).bytes)).toBe("Preserved result")
    await expect(startRun(f.ctx, { operationId: randomUUID(), tool: f.ref, input: {}, contextRefs: [], writeIntent: "outputs_only" })).rejects.toThrow("not enabled")
  })
  it("does not complete cancel removal until the actual owning lease acknowledges and releases", async () => {
    const f = await fixture(), fixtureRun = workflowFixture().run
    const run = { ...fixtureRun, id: randomUUID(), operationId: randomUUID(), profileId: f.ctx.profileId, vaultId: f.ctx.vaultId, tool: f.ref, status: "queued" as const }
    await writeRun(f.ctx, run)
    const lease = (await claimRunLease(f.ctx, run.id))!, operationId = randomUUID()
    expect(await removeTool(f.ctx, f.key, operationId, "cancel")).toEqual({ status: "cancellation-pending", runIds: [run.id] })
    expect((await readProfileTools(f.ctx))!.enabled[0].enabled).toBe(false)
    expect((await readWorkflowJournal(f.ctx, run.id)).cancelRequested).toBe(operationId)
    await expect(applyToolAction(f.ctx, f.key, { action: "enable", enabled: true, operationId: randomUUID() })).rejects.toThrow("cancellation is pending")
    await acknowledgeRunCancellation(f.ctx, run.id, lease)
    expect((await removeTool(f.ctx, f.key, operationId, "cancel")).status).toBe("cancellation-pending")
    await releaseRunLease(f.ctx, run.id, lease)
    expect((await removeTool(f.ctx, f.key, operationId, "cancel")).status).toBe("removed")
    await waitForWorkflowIdle()
    expect((await readProfileTools(f.ctx))!.enabled).toEqual([])
  })
  it("requires the same active-run decision for disable and preserves its pin", async () => {
    const f = await fixture(), { run } = await retainedRun(f)
    const operationId = randomUUID()
    expect(await applyToolAction(f.ctx, f.key, { action: "enable", operationId, enabled: false })).toEqual({ status: "decision-required", runIds: [run.id] })
    expect(await applyToolAction(f.ctx, f.key, { action: "enable", operationId, enabled: false, activeRunDisposition: "finish" })).toEqual({ status: "disabled", runIds: [run.id] })
    expect((await listEnabledTools(f.ctx))).toEqual([])
    expect((await readProfileTools(f.ctx))!.pins[0]).toEqual(f.ref)
  })
  it("executes an inert imported adapter under real coordinator ownership while an update keeps the run on old bytes", async () => {
    const f = await fixture()
    await saveSettings(f.ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "fixture-only-never-dispatched" } })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    let entered = false, observed = ""
    registerWorkflowAdapter("SKILL.md", { execute: async (ctx, run) => {
      entered = true; await waiting
      observed = (await new NodeFsVaultStorage(extensionObjectPath(ctx, run.tool.digest)).read("files/SKILL.md"))!
    } })
    const run = await startRun(f.ctx, { operationId: randomUUID(), tool: f.ref, input: {}, contextRefs: [], writeIntent: "outputs_only" })
    try {
      await vi.waitFor(() => expect(entered).toBe(true))
      const before = await readRun(f.ctx, run.id), { preview } = await changed(f)
      await applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())
      const after = await readRun(f.ctx, run.id)
      expect(after!.tool).toEqual(before!.tool)
      expect(after!.model).toEqual(before!.model)
      expect(after!.preparedEnvironmentRefs).toEqual(before!.preparedEnvironmentRefs)
    } finally { release(); await waitForWorkflowIdle() }
    expect(observed).toContain("Original content")
    expect((await readRun(f.ctx, run.id))!.status).toBe("completed")
  })
  it("rate-limits remote metadata checks, keeps version text irrelevant, and never acquires content automatically", async () => {
    const f = await fixture(), storage = await importStorage(f.ctx)
    await storage.write(`versions/sources/${f.ref.digest}.json`, JSON.stringify({ ...JSON.parse((await storage.read(`versions/sources/${f.ref.digest}.json`))!), source: { kind: "github", url: "https://github.com/fixture/research", ref: "main" }, locator: "https://github.com/fixture/research" }))
    const metadata = vi.spyOn(acquisition, "checkGithubRevision").mockResolvedValue("b".repeat(40))
    const download = vi.spyOn(acquisition, "acquirePackage")
    const first = await checkToolUpdate(f.ctx, f.key)
    expect(first).toMatchObject({ kind: "metadata", current: f.ref, revision: "b".repeat(40) })
    expect(await checkToolUpdate(f.ctx, f.key)).toEqual(first)
    expect(metadata).toHaveBeenCalledTimes(1); expect(download).not.toHaveBeenCalled()
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001)
    await checkToolUpdate(f.ctx, f.key)
    expect(metadata).toHaveBeenCalledTimes(2)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
  })
  it("switches by content digest when the displayed version text remains unchanged", async () => {
    const f = await fixture(), { preview } = await changed(f), storage = await importStorage(f.ctx)
    // A deterministic upstream producer retaining its version label.
    const recordPath = `versions/previews/${preview.id}.json`, record = JSON.parse((await storage.read(recordPath))!)
    const importPath = `imports/previews/${record.importPreviewId}.json`, imported = JSON.parse((await storage.read(importPath))!)
    const stagePath = `imports/${imported.stageId}/stage.json`, stage = JSON.parse((await storage.read(stagePath))!)
    stage.version = f.ref.version; await storage.write(stagePath, JSON.stringify(stage))
    imported.tools[0].manifest.ref.version = f.ref.version
    imported.tools[0].manifest.ref.digest = snapshotDigest(imported.tools[0]); record.preview.candidate = imported.tools[0].manifest.ref
    await storage.write(importPath, JSON.stringify(imported)); await storage.write(recordPath, JSON.stringify(record))
    const next = await applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())
    expect(next.version).toBe(f.ref.version); expect(next.digest).not.toBe(f.ref.digest)
  })
  it("persists switch and operation receipt together even when the response is lost", async () => {
    const f = await fixture(), { preview, grant } = await changed(f), operationId = randomUUID(), original = f.ctx.storage.write.bind(f.ctx.storage)
    const write = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, content) => {
      await original(path, content)
      if (path === ".scispark/tools/state.json" && content.includes(operationId)) throw new Error("fixture lost response after atomic write")
    })
    await expect(applyToolUpdate(f.ctx, f.key, preview.id, operationId)).rejects.toThrow("lost response")
    write.mockRestore()
    const current = (await listEnabledTools(f.ctx))[0].ref
    expect(await applyToolUpdate(f.ctx, f.key, preview.id, operationId)).toEqual(current)
    await expect(applyToolAction(f.ctx, f.key, { action: "binding", operationId, patch: {} })).rejects.toThrow("conflict")
    await revokeDiscovery(f.ctx, grant.id)
    await rollbackTool(f.ctx, f.key, f.ref.digest, randomUUID())
    expect(await rollbackTool(f.ctx, f.key, current.digest, randomUUID())).toEqual(current)
  })
  it("fails closed at the receipt cap without deleting old receipts or preventing reads", async () => {
    const f = await fixture(), state = (await readProfileTools(f.ctx))!
    state.managementOperations = Array.from({ length: 10000 }, () => ({ operationId: randomUUID(), toolKey: f.key, hash: "a".repeat(64), result: { updated: true as const } }))
    await writeProfileTools(f.ctx, state)
    await expect(applyToolAction(f.ctx, f.key, { action: "binding", operationId: randomUUID(), patch: {} })).rejects.toMatchObject({ code: "management-history-full" })
    expect((await listToolVersions(f.ctx, f.key))).toHaveLength(1)
    expect(canonicalJSON((await readProfileTools(f.ctx))!.managementOperations)).toBe(canonicalJSON(state.managementOperations))
  })
  it("uses authenticated strict routes without exposing source paths", async () => {
    const f = await fixture()
    vi.spyOn(profiles, "getProfileSession").mockResolvedValue({ id: f.ctx.profileId } as never)
    vi.spyOn(contexts, "resolveWorkflowContext").mockResolvedValue(f.ctx)
    const request = (body: unknown) => new NextRequest("http://localhost/api/tools/tool", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: `${PROFILE_COOKIE}=fixture`, [PROFILE_HEADER]: f.ctx.profileId, "content-type": "application/json" }, body: JSON.stringify(body) })
    const context = { params: Promise.resolve({ key: f.key }) }
    expect((await route.POST(request({ action: "enable", operationId: randomUUID(), enabled: false, unknown: true }), context)).status).toBe(400)
    const result = await route.POST(request({ action: "binding", operationId: randomUUID(), patch: {} }), context)
    expect(result.status).toBe(200); expect(JSON.stringify(await result.json())).not.toContain(f.source)
    vi.spyOn(profiles, "getProfileSession").mockResolvedValue(null)
    expect((await route.POST(request({ action: "remove", operationId: randomUUID() }), context)).status).toBe(401)
  })
})

import { discoverAgentSkills, stageDiscoveredSkill } from "../discovery"
import * as extensionStore from "../store"

describe("reviewed adapter continuity and consent publication", () => {
  it("preserves reviewed engines when plain SKILL source defaults are unchanged, but lets changed upstream fields win", async () => {
    const f = await fixture()
    await writeFile(join(f.source, "SKILL.md"), "Plain instructions")
    const initial = await inspectPackage(f.ctx, await acquirePackage(f.ctx, { kind: "local-folder", path: f.source }))
    await writeFile(join(f.source, "old.txt"), "old resource")
    // Reacquire so the reviewed resource is part of the bounded stage.
    const p = await inspectPackage(f.ctx, await acquirePackage(f.ctx, { kind: "local-folder", path: f.source }))
    expect(initial.tools[0].proposal.engines).toEqual([])
    const reviewed = await reviewImport(f.ctx, p.id, [{ ...p.tools[0].proposal, engines: ["api"], resources: ["old.txt"] }])
    const [ref] = await commitImport(f.ctx, reviewed.id, [reviewed.tools[0].manifest.ref]); f.ref = ref; f.key = toolKey(ref)
    await writeFile(join(f.source, "SKILL.md"), "Changed plain instructions")
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.source }])
    // Plain package discovery requires SKILL.md but never provider configuration.
    const preview = (await checkToolUpdate(f.ctx, f.key, { force: true, grantId: grant.id }))!
    expect(preview.proposal!.engines).toEqual(["api"]); expect(preview.proposal!.resources).toEqual(["old.txt"])
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(ref)
    const next = await applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())
    await writeFile(join(f.source, "new.txt"), "new resource")
    await writeFile(join(f.source, "SKILL.md"), "---\nscispark:\n  resources: [new.txt]\n  setup:\n    commands: []\n    runtimes: []\n    unsupported: [New reviewed host adapter required]\n---\nChanged setup")
    const changed = (await checkToolUpdate(f.ctx, f.key, { force: true, grantId: grant.id }))!
    expect(changed.proposal!.resources).toEqual(["new.txt"])
    expect(changed.proposal!.setup.unsupported).toEqual(["New reviewed host adapter required"])
    expect(changed.changedResources).toContain("new.txt")
    expect(changed.changedResources).toContain("old.txt")
    await expect(applyToolUpdate(f.ctx, f.key, changed.id, randomUUID())).rejects.toThrow(/ready|setup/)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(next)
  })
  it("updates discovered agent snapshots only after exact original-root renewal and excludes protected files", async () => {
    const f = await fixture(), grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.source }])
    const [candidate] = await discoverAgentSkills(f.ctx, grant.id), p = await stageDiscoveredSkill(f.ctx, grant.id, candidate.id)
    const r = await reviewImport(f.ctx, p.id, p.tools.map(t => t.proposal)), [ref] = await commitImport(f.ctx, r.id, [r.tools[0].manifest.ref])
    await revokeDiscovery(f.ctx, grant.id)
    await writeFile(join(f.source, "auth.json"), "fixture-secret-must-not-copy")
    await writeFile(join(f.source, "SKILL.md"), skill("Agent update"))
    const renewed = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.source }])
    const preview = (await checkToolUpdate(f.ctx, toolKey(ref), { force: true, grantId: renewed.id }))!
    const next = await applyToolUpdate(f.ctx, toolKey(ref), preview.id, randomUUID())
    expect(next.packageId).toBe(ref.packageId)
    expect(await new NodeFsVaultStorage(extensionObjectPath(f.ctx, next.digest)).read("files/auth.json")).toBeNull()
    const broader = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.root }])
    await expect(checkToolUpdate(f.ctx, toolKey(ref), { force: true, grantId: broader.id })).rejects.toThrow("original package path")
  })
  it("rechecks consent at the final binding publication after preparation and leaves the old binding on expiry", async () => {
    const f = await fixture(), { preview, grant } = await changed(f), original = extensionStore.updateProfileTools
    vi.spyOn(extensionStore, "updateProfileTools").mockImplementation(async (...args) => {
      vi.spyOn(Date, "now").mockReturnValue(grant.expiresAt)
      return original(...args)
    })
    await expect(applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())).rejects.toThrow(/expired|permission/)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
    vi.restoreAllMocks()
    const prepared = (await readToolUpdate(f.ctx, f.key))!.preparedTool!
    await revokeDiscovery(f.ctx, grant.id)
    await expect(rollbackTool(f.ctx, f.key, prepared.digest, randomUUID())).rejects.toThrow("Retained tool version is unavailable")
    expect((await listToolVersions(f.ctx, f.key)).some(entry => entry.ref.digest === prepared.digest)).toBe(false)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
  })
  it("requires explicit re-import when original inspected proposal provenance is unavailable", async () => {
    const f = await fixture(), storage = await importStorage(f.ctx)
    const path = `versions/sources/${f.ref.digest}.json`, source = JSON.parse((await storage.read(path))!)
    delete source.inspectedProposal; await storage.write(path, JSON.stringify(source))
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.source }])
    await expect(checkToolUpdate(f.ctx, f.key, { force: true, grantId: grant.id })).rejects.toThrow(/re-import/)
  })
})

describe("publication and setup recovery regressions", () => {
  it("updates an existing pin on explicit re-import while preserving captured runs", async () => {
    const f = await fixture(), { run } = await retainedRun(f), { preview } = await changed(f)
    const next = await applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())
    await writeFile(join(f.source, "SKILL.md"), skill("Explicit re-import version"))
    const p = await inspectPackage(f.ctx, await acquirePackage(f.ctx, { kind: "local-folder", path: f.source }))
    const r = await reviewImport(f.ctx, p.id, p.tools.map(t => t.proposal)), [imported] = await commitImport(f.ctx, r.id, [r.tools[0].manifest.ref])
    expect(imported.digest).not.toBe(next.digest)
    expect((await readProfileTools(f.ctx))!.pins[0]).toEqual(imported)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(imported)
    expect((await readRun(f.ctx, run.id))!.tool).toEqual(f.ref)
  })
  it("preserves the binding when managed environment installation fails", async () => {
    const f = await fixture(), lock = JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: {} })
    await writeFile(join(f.source, "package.json"), '{"name":"fixture"}')
    await writeFile(join(f.source, "package-lock.json"), lock)
    const { preview } = await changed(f, `  setup:\n    commands: []\n    runtimes: [node22]\n    unsupported: []\n    environment:\n      runtime: node22\n      lockFile: package-lock.json\n      lockDigest: ${acquisition.sha256(lock)}\n`)
    const install = vi.spyOn(setup, "ensureToolEnvironment").mockRejectedValue(new Error("fixture installation failed"))
    await expect(applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())).rejects.toThrow("installation failed")
    expect(install).toHaveBeenCalledTimes(1)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
  })
  it("includes an accepted start intent whose run.json publication was interrupted in the active-run decision", async () => {
    const f = await fixture(), template = workflowFixture(), operationId = randomUUID()
    const request = { ...template.request, operationId, tool: f.ref }
    const run = { ...template.run, id: randomUUID(), operationId, profileId: f.ctx.profileId, vaultId: f.ctx.vaultId, tool: f.ref }
    await f.ctx.storage.write(`.scispark/tool-runs/start-operations/${operationId}.json`, JSON.stringify({ schemaVersion: 1, request, run }))
    expect(await removeTool(f.ctx, f.key, randomUUID())).toEqual({ status: "decision-required", runIds: [run.id] })
    expect((await readProfileTools(f.ctx))!.enabled[0].enabled).toBe(true)
  })
})

import { readToolUpdate } from "../versions"
import type { EnvironmentRecord } from "../import-contract"
it("exposes the failed update's actual prepared ref/setup ID through a redacted recovery DTO and preserves discard association", async () => {
  const f = await fixture(), lock = JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: {} })
  await writeFile(join(f.source, "package.json"), '{"name":"fixture"}')
  await writeFile(join(f.source, "package-lock.json"), lock)
  const { preview } = await changed(f, `  setup:\n    commands: []\n    runtimes: [node22]\n    unsupported: []\n    environment:\n      runtime: node22\n      lockFile: package-lock.json\n      lockDigest: ${acquisition.sha256(lock)}\n`)
  const install = vi.spyOn(setup, "ensureToolEnvironment").mockRejectedValue(new Error("uncertain fixture setup"))
  await expect(applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())).rejects.toThrow("uncertain")
  const prepared = install.mock.calls[0][1]
  expect(prepared.digest).not.toBe(preview.candidate!.digest)
  const record: EnvironmentRecord = { schemaVersion: 1, id: randomUUID(), setupId: randomUUID(), profileId: f.ctx.profileId, vaultId: f.ctx.vaultId,
    tool: prepared, recipeDigest: "b".repeat(64), toolchainDigest: "c".repeat(64), lockDigest: acquisition.sha256(lock), digest: "d".repeat(64), state: "needs-reconciliation", executed: true, completedSteps: 0, reason: `/private/fixture/runtime/path must not leak` }
  vi.spyOn(setup, "readToolEnvironmentState").mockResolvedValue(record)
  vi.spyOn(setup, "checkToolReadiness").mockResolvedValue({ status: "needs-setup", reasons: [record.reason] })
  const pending = await readToolUpdate(f.ctx, f.key)
  expect(pending!.preparedTool).toEqual(prepared)
  expect(pending!.setup).toMatchObject({ tool: prepared, setupId: record.setupId, state: "needs-reconciliation" })
  expect(JSON.stringify(pending)).not.toContain("/private/fixture")
  expect(pending!.setup).not.toHaveProperty("recipeDigest")
  const discard = vi.spyOn(setup, "acknowledgeAndDiscardToolSetup").mockResolvedValue({ ...record, state: "needs-setup" })
  vi.spyOn(profiles, "getProfileSession").mockResolvedValue({ id: f.ctx.profileId } as never)
  vi.spyOn(contexts, "resolveWorkflowContext").mockResolvedValue(f.ctx)
  const operationId = randomUUID(), request = new NextRequest("http://localhost/api/tools/tool", { method: "POST", headers: { host: "localhost", cookie: `${PROFILE_COOKIE}=fixture`, [PROFILE_HEADER]: f.ctx.profileId }, body: JSON.stringify({ action: "acknowledge-and-discard-setup", operationId, tool: prepared, setupId: record.setupId }) })
  const response = await route.POST(request, { params: Promise.resolve({ key: f.key }) }), body = await response.json()
  expect(response.status).toBe(200)
  expect(body.result).toEqual({ tool: prepared, setupId: record.setupId, state: "needs-setup", reason: "Prepare this tool before starting a run" })
  expect(discard).toHaveBeenCalledWith(f.ctx, prepared, record.setupId, operationId)
  expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
})

import * as catalogRoute from "@/app/api/tools/route"
it("loads a disabled unpinned imported binding from the durable catalog without in-memory registration", async () => {
  const f = await fixture(), state = (await readProfileTools(f.ctx))!
  await writeProfileTools(f.ctx, { ...state, pins: [], enabled: [{ tool: f.ref, enabled: false }] })
  vi.spyOn(profiles, "getProfileSession").mockResolvedValue({ id: f.ctx.profileId } as never)
  vi.spyOn(contexts, "resolveWorkflowContext").mockResolvedValue(f.ctx)
  const request = new NextRequest("http://localhost/api/tools", { headers: { cookie: `${PROFILE_COOKIE}=fixture`, [PROFILE_HEADER]: f.ctx.profileId } })
  const response = await catalogRoute.GET(request), body = await response.json()
  expect(response.status).toBe(200)
  expect(body.result.find((tool: { ref: { digest: string } }) => tool.ref.digest === f.ref.digest)).toMatchObject({ ref: f.ref, enabled: false })
})


describe("review fixes: publication proof and shared cancellation fence", () => {
  it("rejects rollback to a prepared candidate when the atomic binding write fails before persistence", async () => {
    const f = await fixture(), { preview, grant } = await changed(f)
    const original = f.ctx.storage.write.bind(f.ctx.storage)
    const write = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, content) => {
      if (path === ".scispark/tools/state.json") throw new Error("fixture publication failed before atomic write")
      return original(path, content)
    })
    await expect(applyToolUpdate(f.ctx, f.key, preview.id, randomUUID())).rejects.toThrow("publication failed")
    write.mockRestore()
    const prepared = (await readToolUpdate(f.ctx, f.key))!.preparedTool!
    await revokeDiscovery(f.ctx, grant.id)
    await expect(rollbackTool(f.ctx, f.key, prepared.digest, randomUUID())).rejects.toThrow("Retained tool version is unavailable")
    expect((await listToolVersions(f.ctx, f.key)).some(entry => entry.ref.digest === prepared.digest)).toBe(false)
    expect((await listEnabledTools(f.ctx))[0].ref).toEqual(f.ref)
  })
  it("rejects ordinary re-import publication while a live owning lease is cancelling and admits no new root", async () => {
    const f = await fixture(), template = workflowFixture().run
    const run = { ...template, id: randomUUID(), operationId: randomUUID(), profileId: f.ctx.profileId, vaultId: f.ctx.vaultId, tool: f.ref, status: "queued" as const }
    await writeRun(f.ctx, run)
    const lease = (await claimRunLease(f.ctx, run.id))!, operationId = randomUUID()
    try {
      expect(await removeTool(f.ctx, f.key, operationId, "cancel")).toEqual({ status: "cancellation-pending", runIds: [run.id] })
      await writeFile(join(f.source, "SKILL.md"), skill("Ordinary re-import during cancellation"))
      const p = await inspectPackage(f.ctx, await acquirePackage(f.ctx, { kind: "local-folder", path: f.source }))
      const r = await reviewImport(f.ctx, p.id, p.tools.map(t => t.proposal)), next = r.tools[0].manifest.ref
      await expect(commitImport(f.ctx, r.id, [next])).rejects.toThrow("cancellation is pending")
      expect((await readProfileTools(f.ctx))!.enabled[0]).toEqual({ tool: f.ref, enabled: false })
      for (const tool of [f.ref, next]) await expect(startRun(f.ctx, { operationId: randomUUID(), tool, input: {}, contextRefs: [], writeIntent: "outputs_only" })).rejects.toThrow("not enabled")
      expect((await readWorkflowJournal(f.ctx, run.id)).cancelRequested).toBe(operationId)
    } finally {
      await acknowledgeRunCancellation(f.ctx, run.id, lease)
      await releaseRunLease(f.ctx, run.id, lease)
      await removeTool(f.ctx, f.key, operationId, "cancel")
      await waitForWorkflowIdle()
    }
  })
})

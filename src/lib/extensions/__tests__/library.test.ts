// @vitest-environment node
import { NextRequest } from "next/server"
import * as profileSessions from "../../server/local-profiles"
import * as contexts from "../../workflows/context"
import * as versions from "../versions"
import * as setup from "../setup"
import * as toolsRoute from "@/app/api/tools/route"
import * as importRoute from "@/app/api/tools/imports/route"
import * as importIdRoute from "@/app/api/tools/imports/[id]/route"
import * as importUi from "../import-ui"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../../local-profile-contract"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { listToolLibrary, applyToolsAction } from "../library"
import { inspectImportState, previewImport, actOnImport, previewZipUpload } from "../import-ui"
import { applyToolAction } from "../versions"
import { canonicalJSON, importStorage, readProfileTools, writeProfileTools } from "../store"
import { toolKey } from "../contracts"
import { NATIVE_TOOL_MANIFESTS } from "../native-catalog"
import { ToolsActionSchema, ImportRequestSchema, ImportActionSchema } from "../ui-contract"
import { connectionRefsForTools, readConnectionRevision } from "../connections"
import { zipSync, strToU8 } from "fflate"
import { grantDiscovery, discoverAgentSkills, stageDiscoveredSkill } from "../discovery"
import { reviewImport, commitImport } from "../inspect"
import { sha256 } from "../acquire"
import { saveS2Key } from "../../server/paper-source-settings"
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "scispark-library-"))); roots.push(root)
  const vaultPath = join(root, "vault"), runtimeRoot = join(root, "runtime"), source = join(root, "source")
  await Promise.all([vaultPath, runtimeRoot, source].map(p => mkdir(p)))
  const ctx = { profileId: randomUUID(), vaultId: "a".repeat(64), vaultPath, runtimeRoot, storage: new NodeFsVaultStorage(vaultPath) }
  await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true, sidebarPins: [] })
  await writeFile(join(source, "SKILL.md"), "---\nname: Research fixture\nscispark:\n  engines: [api, codex, claude-code]\n---\nAnalyze supplied research context.")
  return { ctx, source, root }
}
describe("Tools local library and explicit imports", () => {
  it("adds native tools with unrestricted engine declarations and independent idempotent sidebar preferences", async () => {
    const { ctx } = await fixture(), tool = NATIVE_TOOL_MANIFESTS[0], key = toolKey(tool.ref)
    expect((await listToolLibrary(ctx)).tools.every(t => !t.installed && !t.pinned)).toBe(true)
    await applyToolAction(ctx, key, { action: "enable", operationId: randomUUID(), enabled: true })
    expect((await listToolLibrary(ctx)).tools.find(t => toolKey(t.ref) === key)).toMatchObject({ installed: true, enabled: true, pinned: false })
    const action = { action: "pin" as const, operationId: randomUUID(), key, pinned: true }
    await applyToolsAction(ctx, action); await applyToolsAction(ctx, action)
    expect((await readProfileTools(ctx))!.preferenceOperations).toHaveLength(1)
    await expect(applyToolsAction(ctx, { ...action, pinned: false })).rejects.toThrow(/conflict/)
    await applyToolAction(ctx, key, { action: "remove", operationId: randomUUID() })
    expect((await readProfileTools(ctx))!.sidebarPins).toEqual([])
  })
  it("stages without enabling, redacts absolute source ownership, confirms selected refs and reopens dynamic state", async () => {
    const { ctx, source } = await fixture(), preview = await previewImport(ctx, { source: { kind: "local-folder", path: source } })
    expect(JSON.stringify(preview)).not.toContain(source); expect(preview).not.toHaveProperty("profileId"); expect((await readProfileTools(ctx))!.enabled).toHaveLength(0)
    const state = await actOnImport(ctx, preview.id, { action: "confirm", selected: [preview.tools[0].manifest.ref], proposals: preview.tools.map(t => t.proposal) })
    expect(state.tools[0].readiness.status).toBe("ready")
    expect((await inspectImportState(ctx, state.preview.id)).tools).toEqual(state.tools)
    expect((await listToolLibrary(ctx)).tools.find(t => t.name === "Research fixture")).toMatchObject({ installed: true, enabled: true, readiness: { status: "ready" } })
    await expect(inspectImportState({ ...ctx, profileId: randomUUID() }, preview.id)).rejects.toThrow()
  })
  it("uploads bounded ZIP bytes via normal acquisition without enabling or exposing temporary paths", async () => {
    const { ctx } = await fixture(), zip = zipSync({ "SKILL.md": strToU8("---\nname: Zip research\n---\nInert instructions") })
    const preview = await previewZipUpload(ctx, new Request("http://localhost", { method: "POST", body: Buffer.from(zip) }))
    expect(JSON.stringify(preview)).not.toContain("/uploads/"); expect((await readProfileTools(ctx))!.enabled).toEqual([])
    const bad = zipSync({ "../escape/SKILL.md": strToU8("bad") })
    await expect(previewZipUpload(ctx, new Request("http://localhost", { method: "POST", body: Buffer.from(bad) }))).rejects.toThrow()
  })
  it("keeps unavailable dependencies blocked and accepts no implicit home/agent source", async () => {
    const { ctx, source } = await fixture()
    expect(ImportRequestSchema.safeParse({ source: { kind: "local-folder", path: "~/skills" } }).success).toBe(false)
    expect(ImportRequestSchema.safeParse({ source: { kind: "agent", path: source } }).success).toBe(false)
    expect(ToolsActionSchema.safeParse({ action: "metadata", path: source }).success).toBe(false)
    const preview = await previewImport(ctx, { source: { kind: "local-folder", path: source } })
    const proposal = { ...preview.tools[0].proposal, dependencies: [{ packageId: "missing", skillId: "helper", version: "1", digest: "b".repeat(64) }] }
    await expect(actOnImport(ctx, preview.id, { action: "confirm", selected: [preview.tools[0].manifest.ref], proposals: [proposal] })).rejects.toThrow()
    expect((await readProfileTools(ctx))!.enabled).toHaveLength(0)
  })
  it("binds only declared supported connections with stable identity and durable operation replay", async () => {
    const { ctx } = await fixture(), preview = await previewImport(ctx, { catalogId: "opencite" })
    const imported = await actOnImport(ctx, preview.id, { action: "confirm", selected: [preview.tools[0].manifest.ref], proposals: preview.tools.map(t => t.proposal) })
    const ref = imported.preview.tools[0].manifest.ref, key = toolKey(ref), action = { action: "bind-connection" as const, target: ref, service: "semantic-scholar" as const, operationId: randomUUID() }
    await applyToolAction(ctx, key, action); const before = await connectionRefsForTools(ctx, [ref])
    await applyToolAction(ctx, key, action); await applyToolAction(ctx, key, { ...action, operationId: randomUUID() })
    expect(await connectionRefsForTools(ctx, [ref])).toEqual(before); expect(before).toHaveLength(1)
    expect(JSON.stringify(await listToolLibrary(ctx))).not.toContain("credentialHandle")
    await expect(applyToolAction(ctx, toolKey(NATIVE_TOOL_MANIFESTS[0].ref), action)).rejects.toThrow()
  })
})


describe("Tools HTTP boundary", () => {
  it("keeps local navigation independent of slow metadata and rejects foreign, stale and malformed import writes", async () => {
    const { ctx, source } = await fixture()
    vi.spyOn(profileSessions, "getProfileSession").mockResolvedValue({ id: ctx.profileId, name: "Fixture", vaultPath: ctx.vaultPath })
    vi.spyOn(contexts, "resolveWorkflowContext").mockResolvedValue(ctx)
    const request = (path: string, body?: unknown, headers?: Record<string, string>) => new NextRequest(`http://localhost:3000/api/tools${path}`, { method: body === undefined ? "GET" : "POST", headers: { host: "localhost:3000", cookie: `${PROFILE_COOKIE}=fixture`, [PROFILE_HEADER]: ctx.profileId, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    expect((await importRoute.POST(request("/imports", { source: { kind: "local-folder", path: source } }, { origin: "https://foreign.test" }))).status).toBe(403)
    expect((await importRoute.POST(request("/imports", {}, { [PROFILE_HEADER]: "stale" }))).status).toBe(409)
    expect((await importRoute.POST(request("/imports", { source: { kind: "local-folder", path: source }, command: "execute" }))).status).toBe(400)
    expect((await importRoute.POST(request("/imports", { source: { kind: "local-folder", path: "a".repeat(70000) } }))).status).toBe(413)
    const missingCatalogDependency = await importRoute.POST(request("/imports", { catalogId: "literature-review" }))
    expect(missingCatalogDependency.status).toBe(409)
    expect((await missingCatalogDependency.json()).error).toContain("pinned OpenCite")
    const response = await importRoute.POST(request("/imports", { source: { kind: "local-folder", path: source } }))
    expect(response.status).toBe(200)
    const preview = (await response.json()).result
    const confirmed = await importIdRoute.POST(request(`/imports/${preview.id}`, { action: "confirm", selected: [preview.tools[0].manifest.ref], proposals: preview.tools.map((t: { proposal: unknown }) => t.proposal) }), { params: Promise.resolve({ id: preview.id }) })
    expect(confirmed.status).toBe(200)
    const confirmBody = { action: "confirm", selected: [preview.tools[0].manifest.ref], proposals: preview.tools.map((t: { proposal: unknown }) => t.proposal) }
    const confirmFailure = vi.spyOn(importUi, "actOnImport").mockRejectedValueOnce(new importUi.ImportPrerequisiteError())
    const missingAtConfirm = await importIdRoute.POST(request(`/imports/${preview.id}`, confirmBody), { params: Promise.resolve({ id: preview.id }) })
    expect(missingAtConfirm.status).toBe(409)
    expect((await missingAtConfirm.json()).error).toContain("pinned OpenCite")
    confirmFailure.mockRejectedValueOnce(new Error("Private filesystem details"))
    const privateFailure = await importIdRoute.POST(request(`/imports/${preview.id}`, confirmBody), { params: Promise.resolve({ id: preview.id }) })
    expect(JSON.stringify(await privateFailure.json())).not.toContain("Private filesystem")
    confirmFailure.mockRestore()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const metadata = vi.spyOn(versions, "checkToolUpdate").mockImplementation(async () => { await wait; throw new Error("offline fixture") })
    const pending = toolsRoute.POST(request("", { action: "metadata" }))
    try {
      await vi.waitFor(() => expect(metadata).toHaveBeenCalledTimes(1))
      const local = await toolsRoute.GET(request("?view=library"))
      expect(local.status).toBe(200); expect((await local.json()).result.tools.some((t: { enabled: boolean }) => t.enabled)).toBe(true)
      expect(metadata).toHaveBeenCalledTimes(1)
      expect((await toolsRoute.GET(request("?view=library&view=library"))).status).toBe(400)
    } finally { release(); await pending }
  })
})


it("surfaces uncertain supporting setup from the declared closure and rejects unrelated acknowledgement", async () => {
  const { ctx, source } = await fixture()
  const helperPreview = await previewImport(ctx, { source: { kind: "local-folder", path: source, packageId: "fixture.helper" } })
  const helperState = await actOnImport(ctx, helperPreview.id, { action: "confirm", selected: [helperPreview.tools[0].manifest.ref], proposals: helperPreview.tools.map(t => t.proposal) })
  const helper = helperState.preview.tools[0].manifest.ref
  const rootPreview = await previewImport(ctx, { source: { kind: "local-folder", path: source, packageId: "fixture.root" } })
  const rootState = await actOnImport(ctx, rootPreview.id, { action: "confirm", selected: [rootPreview.tools[0].manifest.ref], proposals: [{ ...rootPreview.tools[0].proposal, dependencies: [helper] }] })
  const root = rootState.preview.tools[0].manifest.ref
  const record = { schemaVersion: 1 as const, id: randomUUID(), setupId: randomUUID(), profileId: ctx.profileId, vaultId: ctx.vaultId, tool: helper, recipeDigest: "a".repeat(64), toolchainDigest: "b".repeat(64), lockDigest: "c".repeat(64), digest: "d".repeat(64), state: "needs-reconciliation" as const, executed: true, completedSteps: 0, reason: "private runtime path must not escape" }
  vi.spyOn(setup, "checkToolReadiness").mockImplementation(async (_ctx, ref) => ref.digest === helper.digest ? { status: "needs-setup", reasons: ["private runtime path must not escape"] } : { status: "ready", reasons: [] })
  vi.spyOn(setup, "readToolEnvironmentState").mockImplementation(async (_ctx, ref) => ref.digest === helper.digest ? record : null)
  const acknowledge = vi.spyOn(setup, "acknowledgeAndDiscardToolSetup").mockResolvedValue(record)
  const library = await listToolLibrary(ctx), selected = library.tools.find(t => t.ref.digest === root.digest)!
  expect(selected.readiness.status).toBe("needs-setup"); expect(selected.setup?.tool).toEqual(helper)
  expect(JSON.stringify(library)).not.toContain(record.reason)
  await applyToolAction(ctx, toolKey(root), { action: "acknowledge-and-discard-setup", operationId: randomUUID(), tool: helper, setupId: record.setupId })
  expect(acknowledge).toHaveBeenCalledTimes(1)
  await expect(applyToolAction(ctx, toolKey(helper), { action: "acknowledge-and-discard-setup", operationId: randomUUID(), tool: root, setupId: record.setupId })).rejects.toThrow(/owned/)
  expect(acknowledge).toHaveBeenCalledTimes(1)
})


async function supportingFixture(kind: "connection" | "environment" | "model") {
  const f = await fixture()
  const preview = await previewImport(f.ctx, { source: { kind: "local-folder", path: f.source, packageId: "fixture.support" } })
  const base = preview.tools[0].proposal
  const proposal = { ...base, name: "Supporting literature helper", connections: kind === "connection" ? ["semantic-scholar"] : [], setup: { ...base.setup,
    ...(kind === "connection" ? { connectionAdapter: "scispark-http-v1" as const } : {}),
    ...(kind === "environment" ? { runtimes: ["node22"] } : {}),
    ...(kind === "model" ? { requiredModels: ["fixture-helper-model"] } : {}),
  } }
  const reviewed = await reviewImport(f.ctx, preview.id, [proposal])
  const [helper] = await commitImport(f.ctx, reviewed.id, [reviewed.tools[0].manifest.ref], { prepareCatalogOnly: true })
  const rootPreview = await previewImport(f.ctx, { source: { kind: "local-folder", path: f.source, packageId: "fixture.root" } })
  const imported = await actOnImport(f.ctx, rootPreview.id, { action: "confirm", selected: [rootPreview.tools[0].manifest.ref], proposals: [{ ...rootPreview.tools[0].proposal, dependencies: [helper] }] })
  return { ...f, helper, imported, rootRef: imported.preview.tools[0].manifest.ref }
}
it("labels an unbound supporting S2 requirement and binds only its exact current closure target", async () => {
  const { ctx, helper, rootRef, imported } = await supportingFixture("connection")
  await saveS2Key(ctx.storage, "disposable-fixture-only")
  expect((await readProfileTools(ctx))!.enabled.map(b => b.tool)).toEqual([rootRef])
  expect(await setup.checkToolReadiness(ctx, rootRef)).toMatchObject({ status: "ready" })
  const observed = (await inspectImportState(ctx, imported.preview.id)).tools[0]
  expect(observed).toMatchObject({ readiness: { status: "needs-setup" }, blockedTool: { tool: helper, name: "Supporting literature helper" }, connectionRequirements: [{ tool: helper, service: "semantic-scholar" }] })
  const selected = (await listToolLibrary(ctx)).tools.find(t => t.ref.digest === rootRef.digest)!
  expect(selected.connectionRequirements).toEqual(observed.connectionRequirements)
  const action = { action: "bind-connection" as const, operationId: randomUUID(), service: "semantic-scholar" as const, target: helper }
  await applyToolAction(ctx, toolKey(rootRef), action)
  const captured = await connectionRefsForTools(ctx, [helper]), revision = await readConnectionRevision(ctx, captured[0])
  await applyToolAction(ctx, toolKey(rootRef), action)
  expect(await connectionRefsForTools(ctx, [helper])).toEqual(captured)
  expect(await readConnectionRevision(ctx, captured[0])).toEqual(revision)
  expect((await inspectImportState(ctx, imported.preview.id)).tools[0].readiness.status).toBe("ready")
  for (const target of [{ ...helper, digest: "f".repeat(64) }, { ...helper, packageId: "unrelated" }, rootRef]) {
    await expect(applyToolAction(ctx, toolKey(rootRef), { ...action, operationId: randomUUID(), target })).rejects.toThrow()
  }
  const state = (await readProfileTools(ctx))!
  await writeProfileTools(ctx, { ...state, enabled: [], pins: [] })
  await expect(applyToolAction(ctx, toolKey(rootRef), action)).resolves.toEqual({ updated: true })
  expect(JSON.stringify(observed)).not.toMatch(/credentialHandle|vaultPath|disposable-fixture-only/)
})
it("shares real missing and uncertain supporting environment state without resetting setup identity or usage", async () => {
  const { ctx, helper, rootRef, imported } = await supportingFixture("environment")
  expect(await setup.checkToolReadiness(ctx, rootRef)).toMatchObject({ status: "ready" })
  expect(imported.tools[0]).toMatchObject({ readiness: { status: "needs-setup" }, blockedTool: { tool: helper } })
  const record = { schemaVersion: 1, id: randomUUID(), setupId: randomUUID(), profileId: ctx.profileId, vaultId: ctx.vaultId, tool: helper, recipeDigest: "a".repeat(64), toolchainDigest: "b".repeat(64), lockDigest: "c".repeat(64), digest: "d".repeat(64), state: "needs-reconciliation", executed: true, completedSteps: 2, reason: "private staging path" }
  const storage = await importStorage(ctx), path = `environments/by-tool/${sha256(canonicalJSON(helper))}.json`, journal = `setup-attempts/${record.setupId}.json`
  await storage.write(path, JSON.stringify(record)); await storage.write(journal, JSON.stringify({ id: record.setupId, profileId: ctx.profileId, vaultId: ctx.vaultId, attempts: [{ id: randomUUID(), hash: "e".repeat(64), seconds: 300, activeSeconds: 12, state: "unknown" }] }))
  const before = await storage.read(journal)
  const observed = (await inspectImportState(ctx, imported.preview.id)).tools[0]
  const installed = (await listToolLibrary(ctx)).tools.find(t => t.ref.digest === rootRef.digest)!
  expect(observed).toMatchObject({ readiness: { status: "needs-setup" }, blockedTool: { tool: helper }, setup: { tool: helper, setupId: record.setupId, state: "needs-reconciliation" } })
  expect(installed.setup).toEqual(observed.setup); expect(installed.readiness).toEqual(observed.readiness)
  const prepare = { action: "prepare" as const, operationId: randomUUID() }
  await applyToolAction(ctx, toolKey(rootRef), prepare); await applyToolAction(ctx, toolKey(rootRef), prepare)
  expect(await storage.read(path)).toBe(JSON.stringify(record)); expect(await storage.read(journal)).toBe(before)
  expect(JSON.stringify(observed)).not.toContain(record.reason)
})
it("observes supporting model compatibility using the root candidate override", async () => {
  const { ctx, helper, rootRef, imported } = await supportingFixture("model")
  const state = (await readProfileTools(ctx))!
  await writeProfileTools(ctx, { ...state, overrides: [{ toolKey: toolKey(helper), tierModels: { fast: { provider: "openai", model: "fixture-helper-model" } } }] })
  expect(await setup.checkToolReadiness(ctx, helper)).toMatchObject({ status: "ready" })
  expect((await inspectImportState(ctx, imported.preview.id)).tools[0]).toMatchObject({ readiness: { status: "needs-setup" }, blockedTool: { tool: helper } })
  await writeProfileTools(ctx, { ...state, overrides: [{ toolKey: toolKey(rootRef), tierModels: { fast: { provider: "openai", model: "fixture-helper-model" } } }] })
  expect((await inspectImportState(ctx, imported.preview.id)).tools[0].readiness.status).toBe("ready")
})

it("requires an unexpired discovery grant for import observation but manages owned dependencies after expiry", async () => {
  const { ctx, source, helper } = await supportingFixture("connection")
  const grant = await grantDiscovery(ctx, [{ agent: "custom", layout: "package", path: source }])
  const [candidate] = await discoverAgentSkills(ctx, grant.id)
  const preview = await stageDiscoveredSkill(ctx, grant.id, candidate.id)
  const imported = await actOnImport(ctx, preview.id, { action: "confirm", selected: [preview.tools[0].manifest.ref], proposals: [{ ...preview.tools[0].proposal, dependencies: [helper] }] })
  const rootRef = imported.preview.tools[0].manifest.ref
  expect(ImportActionSchema.safeParse({ action: "prepare", tool: rootRef }).success).toBe(false)
  expect(ImportActionSchema.safeParse({ action: "acknowledge-and-discard-setup", tool: rootRef, operationId: randomUUID(), setupId: randomUUID() }).success).toBe(false)
  vi.spyOn(Date, "now").mockReturnValue(grant.expiresAt)
  await expect(inspectImportState(ctx, imported.preview.id)).rejects.toThrow(/permission/)
  await rm(source, { recursive: true })
  const owned = (await listToolLibrary(ctx)).tools.find(t => t.ref.digest === rootRef.digest)!
  expect(owned.connectionRequirements).toContainEqual({ tool: helper, name: "Supporting literature helper", service: "semantic-scholar" })
  await expect(applyToolAction(ctx, toolKey(rootRef), { action: "bind-connection", target: helper, service: "semantic-scholar", operationId: randomUUID() })).resolves.toEqual({ updated: true })
})

it("discovers the literature catalog only explicitly, requires exact OpenCite, and enables only the root", async () => {
  const { ctx } = await fixture()
  expect(ImportRequestSchema.safeParse({ catalogId: "literature-review" }).success).toBe(true)
  await expect(previewImport(ctx, { catalogId: "literature-review" })).rejects.toThrow("pinned OpenCite")
  expect((await readProfileTools(ctx))!.enabled).toHaveLength(0)
  const op = await previewImport(ctx, { catalogId: "opencite" })
  // Same package/skill with a changed reviewed proposal is not the pinned dependency.
  await actOnImport(ctx, op.id, { action: "confirm", selected: [op.tools[0].manifest.ref], proposals: [{ ...op.tools[0].proposal, description: "Stale different reviewed recipe" }] })
  await expect(previewImport(ctx, { catalogId: "literature-review" })).rejects.toThrow("pinned OpenCite")
  await actOnImport(ctx, op.id, { action: "confirm", selected: [op.tools[0].manifest.ref], proposals: op.tools.map(t => t.proposal) })
  const preview = await previewImport(ctx, { catalogId: "literature-review" })
  expect(preview.tools).toHaveLength(5)
  expect(preview.tools.every(t => !t.reviewed)).toBe(true)
  const root = preview.tools.find(t => t.manifest.ref.skillId === "host/lit-review/SKILL.md")!
  await expect(actOnImport(ctx, preview.id, { action: "confirm", selected: preview.tools.map(t => t.manifest.ref), proposals: preview.tools.map(t => t.proposal) })).rejects.toThrow("only top-level")
  const imported = await actOnImport(ctx, preview.id, { action: "confirm", selected: [root.manifest.ref], proposals: preview.tools.map(t => t.proposal) })
  const enabled = (await readProfileTools(ctx))!.enabled.filter(b => b.tool.packageId === "neuromechanist.literature-review")
  expect(enabled).toHaveLength(1); expect(enabled[0].tool.skillId).toBe("host/lit-review/SKILL.md")
  const finalRoot = imported.preview.tools.find(t => t.manifest.ref.skillId === root.manifest.ref.skillId)!
  expect((await setup.resolveToolPreparationClosure(ctx, finalRoot.manifest.ref)).dependencies).toHaveLength(5)
  expect(imported.tools.find(t => t.tool.skillId === root.manifest.ref.skillId)?.readiness.status).not.toBe("ready")
}, 15000)

it("retains legacy favorites only when the sidebar preference is absent", async () => {
 const {ctx}=await fixture(), favorites=NATIVE_TOOL_MANIFESTS.filter(m=>["trending","idea-spark"].includes(m.ref.skillId))
 const state={schemaVersion:1 as const,enabled:favorites.map(m=>({tool:m.ref,enabled:true})),pins:[],overrides:[],migrated:true}
 await writeProfileTools(ctx,state)
 expect((await listToolLibrary(ctx)).tools.filter(t=>t.pinned).map(t=>t.ref.skillId).sort()).toEqual(["idea-spark","trending"])
 await writeProfileTools(ctx,{...state,sidebarPins:[]})
 expect((await listToolLibrary(ctx)).tools.some(t=>t.pinned)).toBe(false)
})

it("exposes specific safe setup guidance and never echoes arbitrary setup errors",async()=>{
 const {ctx,source}=await fixture(),preview=await previewImport(ctx,{source:{kind:"local-folder",path:source}})
 const saved=await actOnImport(ctx,preview.id,{action:"confirm",selected:[preview.tools[0].manifest.ref],proposals:preview.tools.map(t=>t.proposal)})
 const check=vi.spyOn(setup,"checkToolReadiness").mockResolvedValue({status:"needs-setup",reasons:["Bind Semantic Scholar and configure its credential"]})
 let observed=await inspectImportState(ctx,saved.preview.id)
 expect(observed.tools[0].readiness.reasons).toEqual(["Connect Semantic Scholar in Manage, then add its key in Settings."])
 check.mockResolvedValue({status:"needs-setup",reasons:["raw /home/person/private sk-fixture-secret-value"]})
 observed=await inspectImportState(ctx,saved.preview.id)
 expect(JSON.stringify(observed.tools)).not.toMatch(/raw|home\/person|sk-fixture/)
 expect(observed.tools[0].readiness.reasons).toEqual(["Prepare the required environment in Manage."])
})

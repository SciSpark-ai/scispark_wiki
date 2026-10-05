import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ToolRefSchema, ProfileToolsSchema, toolKey } from "../../extensions/contracts"
import { readProfileTools, writeProfileTools, extensionObjectPath, profileRuntimePath } from "../../extensions/store"
import { ArtifactSchema, RunEventInputSchema, ToolRunSchema, StartRunInputSchema } from "../contracts"
import { resolveWorkflowContext } from "../context"
import { appendEvent, listRunEvents, readRun, writeRun } from "../store"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { getProfileRegistryRoot } from "../../server/local-profiles"
import { workflowFixture } from "./fixtures"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function temporaryRoot() { const root = await mkdtemp(join(tmpdir(), "scispark-workflow-")); roots.push(root); return root }

describe("workflow contracts and private store", () => {
  it("rejects invalid keys, unknown fields, reasoning and model credentials", () => {
    const { tool, run, request } = workflowFixture()
    expect(() => ToolRefSchema.parse({ ...tool.ref, digest: "../escape" })).toThrow()
    expect(() => ToolRunSchema.parse({ ...run, id: "../escape" })).toThrow()
    expect(() => StartRunInputSchema.parse({ ...request, operationId: "../escape" })).toThrow()
    expect(() => ToolRunSchema.parse({ ...run, model: { ...run.model, keys: { anthropic: "secret" } } })).toThrow()
    expect(() => RunEventInputSchema.parse({ type: "text", text: "public", reasoning: "private" })).toThrow()
    expect(() => RunEventInputSchema.parse({ type: "text", text: "public", seq: 1 })).toThrow()
    const artifact = { id: run.id, kind: "file", title: "Fixture", path: "artifacts/out.md", sha256: tool.ref.digest, mediaType: "text/markdown", sourceRefs: [] }
    for (const path of ["../escape", "C:/outside", "/outside", "artifacts/./out.md", " artifacts/out.md"]) {
      expect(() => ArtifactSchema.parse({ ...artifact, path })).toThrow()
    }
    expect(toolKey({ packageId: "a/b", skillId: "c" })).not.toEqual(toolKey({ packageId: "a", skillId: "b/c" }))
  })

  it("round-trips only within its owning profile and rejects owner mismatch", async () => {
    const { ctx, other, run } = workflowFixture()
    await writeRun(ctx, run)
    expect(await readRun(ctx, run.id)).toEqual(run)
    expect(await readRun(other, run.id)).toBeNull()
    await expect(writeRun(other, run)).rejects.toThrow(/owner/)
    await other.storage.write(`.scispark/tool-runs/${run.id}/run.json`, JSON.stringify(run))
    await expect(readRun(other, run.id)).rejects.toThrow(/owner/)
    await expect(readRun(ctx, "../escape")).rejects.toThrow()
  })

  it("replaces a valid record atomically and preserves it on invalid writes", async () => {
    const { ctx, run } = workflowFixture()
    await writeRun(ctx, run)
    const updated = { ...run, status: "running" as const, usage: { ...run.usage, modelCalls: 1 } }
    await writeRun(ctx, updated)
    expect(await readRun(ctx, run.id)).toEqual(updated)
    await expect(writeRun(ctx, { ...updated, eventCursor: -1 })).rejects.toThrow()
    await expect(writeRun(ctx, run)).rejects.toThrow(/cumulative/)
    await expect(writeRun(ctx, { ...updated, model: { ...run.model, engine: "codex" } })).rejects.toThrow(/immutable/)
    expect(await readRun(ctx, run.id)).toEqual(updated)
  })

  it("serializes event appends and filters a monotonic cursor", async () => {
    const { ctx, run } = workflowFixture()
    await writeRun(ctx, run)
    const events = await Promise.all([
      appendEvent(ctx, run.id, { type: "status", status: "running" }),
      appendEvent(ctx, run.id, { type: "text", text: "Public answer snapshot" }),
      appendEvent(ctx, run.id, { type: "error", code: "fixture", message: "Try again" }),
    ])
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect((await listRunEvents(ctx, run.id, 1)).map((event) => event.seq)).toEqual([2, 3])
    expect((await readRun(ctx, run.id))?.eventCursor).toBe(3)
    await expect(listRunEvents(ctx, run.id, -1)).rejects.toThrow()
    await expect(appendEvent(ctx, "55555555-5555-4555-8555-555555555555", { type: "text", text: "missing" })).rejects.toThrow(/not found/)
  })

  it("reads only the tail payload for append and only new payloads for replay", async () => {
    const { ctx, run } = workflowFixture(); await writeRun(ctx, run)
    for (let i = 0; i < 100; i++) await appendEvent(ctx, run.id, { type: "text", text: String(i) })
    const read = vi.spyOn(ctx.storage, "read")
    await appendEvent(ctx, run.id, { type: "text", text: "tail" })
    expect(read.mock.calls.filter(([path]) => path.includes("/events/"))).toHaveLength(1)
    read.mockClear()
    expect(await listRunEvents(ctx, run.id, 100)).toHaveLength(1)
    expect(read.mock.calls.filter(([path]) => path.includes("/events/"))).toHaveLength(1)
  })

  it("recovers an event committed before its cursor update without overwriting it", async () => {
    const { ctx, run } = workflowFixture()
    await writeRun(ctx, run)
    const write = ctx.storage.write.bind(ctx.storage)
    let fail = true
    ctx.storage.write = async (path, content) => {
      if (path.endsWith("/run.json") && fail) { fail = false; throw new Error("cursor update failed") }
      await write(path, content)
    }
    await expect(appendEvent(ctx, run.id, { type: "text", text: "First" })).rejects.toThrow(/cursor update failed/)
    expect((await appendEvent(ctx, run.id, { type: "text", text: "Second" })).seq).toBe(2)
    expect((await listRunEvents(ctx, run.id, 0)).map((event) => event.seq)).toEqual([1, 2])
  })

  it("preserves prepared environments and connection revisions as immutable run snapshots", async () => {
    const { ctx, run } = workflowFixture()
    const captured = { ...run,
      preparedEnvironmentRefs: [{ id: run.id, digest: "d".repeat(64), lockDigest: "e".repeat(64) }],
      connectionConfigurationRefs: [{ id: run.operationId, revision: "f".repeat(64) }],
    }
    await writeRun(ctx, captured)
    await expect(writeRun(ctx, { ...captured, preparedEnvironmentRefs: [] })).rejects.toThrow(/immutable/)
    await expect(writeRun(ctx, { ...captured, connectionConfigurationRefs: [{ id: run.operationId, revision: "a".repeat(64) }] })).rejects.toThrow(/immutable/)
    expect(await readRun(ctx, run.id)).toEqual(captured)
  })

  it("fails closed on corrupt persisted schemas or event identity", async () => {
    const { ctx, run } = workflowFixture()
    await ctx.storage.write(".scispark/tools/state.json", '{"schemaVersion":999}')
    await expect(readProfileTools(ctx)).rejects.toThrow()
    await writeRun(ctx, run)
    await ctx.storage.write(`.scispark/tool-runs/${run.id}/events/0000000000000001.json`, JSON.stringify({ type: "text", text: "forged", seq: 2, runId: run.id }))
    await expect(listRunEvents(ctx, run.id, 0)).rejects.toThrow(/identity/)
    await expect(appendEvent(ctx, run.id, { type: "text", text: "retry" })).rejects.toThrow(/identity/)
  })

  it("uses atomic filesystem replacement and shared-directory event exclusion", async () => {
    const root = await temporaryRoot()
    const { ctx: memory, run } = workflowFixture()
    const ctx = { ...memory, storage: new NodeFsVaultStorage(root) }
    const reopened = { ...ctx, storage: new NodeFsVaultStorage(root) }
    await writeRun(ctx, run)
    const replacement = { ...run, status: "running" as const, input: run.input }
    const observations = await Promise.all([
      writeRun(ctx, replacement),
      ...Array.from({ length: 10 }, () => readRun(reopened, run.id)),
    ])
    for (const observation of observations.slice(1)) expect([run, replacement]).toContainEqual(observation)
    expect(await readRun(reopened, run.id)).toEqual(replacement)
    const events = await Promise.all([
      appendEvent(ctx, run.id, { type: "text", text: "First instance" }),
      appendEvent(reopened, run.id, { type: "text", text: "Second instance" }),
    ])
    expect(events.map((event) => event.seq).sort()).toEqual([1, 2])
    expect((await listRunEvents(reopened, run.id, 0)).map((event) => event.seq)).toEqual([1, 2])
  })

  it("stores explicit profile bindings separately and validates extension path keys", async () => {
    const { ctx, other, tool } = workflowFixture()
    expect(await readProfileTools(ctx)).toBeNull()
    const tools = ProfileToolsSchema.parse({ schemaVersion: 1, enabled: [{ tool: tool.ref, enabled: true }], pins: [tool.ref], overrides: [], migrated: false })
    await writeProfileTools(ctx, tools)
    expect(await readProfileTools(ctx)).toEqual(tools)
    expect(await readProfileTools(other)).toBeNull()
    expect(extensionObjectPath(ctx, tool.ref.digest)).toBe(join(ctx.runtimeRoot, "objects", tool.ref.digest))
    expect(profileRuntimePath({ ...ctx, profileId: "f".repeat(32) })).toContain("f".repeat(32))
    expect(() => profileRuntimePath({ ...ctx, profileId: "../escape" })).toThrow()
    expect(() => extensionObjectPath(ctx, "../escape")).toThrow()
  })

  it("resolves registry/vaults and registry/extensions to disjoint canonical roots", async () => {
    const root = await temporaryRoot()
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", SCISPARK_VAULT: join(root, "original"), SCISPARK_PROFILES_DIR: join(root, "registry") }
    const registry = await getProfileRegistryRoot(env)
    const vaultPath = join(registry, "vaults", "11111111-1111-4111-8111-111111111111")
    const ctx = await resolveWorkflowContext({ id: "f".repeat(32), name: "Fixture", vaultPath }, env)
    expect(ctx.vaultPath).toBe(await realpath(vaultPath))
    expect(ctx.runtimeRoot).toBe(join(registry, "extensions"))
    expect(ctx.vaultId).toMatch(/^[a-f0-9]{64}$/)
    await writeRun(ctx, { ...workflowFixture().run, profileId: ctx.profileId, vaultId: ctx.vaultId })
    const reopened = { ...ctx, storage: new NodeFsVaultStorage(ctx.vaultPath) }
    expect(await readRun(reopened, workflowFixture().run.id)).not.toBeNull()
    await mkdir(join(root, "alias-parent"))
    await symlink(vaultPath, join(root, "alias-parent", "alias"))
    const alias = await resolveWorkflowContext({ id: ctx.profileId, name: "Alias", vaultPath: join(root, "alias-parent", "alias") }, env)
    expect(alias.vaultId).toBe(ctx.vaultId)
    await expect(resolveWorkflowContext({ id: ctx.profileId, name: "Overlap", vaultPath: ctx.runtimeRoot }, env)).rejects.toThrow(/overlap/)
    await expect(resolveWorkflowContext({ id: ctx.profileId, name: "Overlap", vaultPath: registry }, env)).rejects.toThrow(/overlap/)
  })
})

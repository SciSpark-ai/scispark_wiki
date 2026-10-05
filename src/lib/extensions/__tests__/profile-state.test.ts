import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { WorkflowContext } from "../../workflows/context"
import { toolKey } from "../contracts"
import { NATIVE_TOOL_MANIFESTS } from "../native-catalog"
import { initializeProfileTools, listEnabledTools, setToolBinding, setToolEnabled } from "../profile-state"
import { hasToolAdapter, registerToolAdapter, registerToolManifest } from "../registry"
import { readProfileTools, writeProfileTools } from "../store"

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "scispark-tool-state-")) })
function context(): WorkflowContext {
  const profileId = randomUUID()
  return { profileId, vaultId: createHash("sha256").update(profileId).digest("hex"), vaultPath: join(root, profileId), runtimeRoot: join(root, "runtime"), storage: new MemoryVaultStorage() }
}
const review = () => NATIVE_TOOL_MANIFESTS.find((manifest) => manifest.ref.skillId === "deep-review")!
const disposers: (() => void)[] = []
afterEach(async () => { disposers.splice(0).forEach((dispose) => dispose()); await rm(root, { recursive: true, force: true }) })

describe("profile tool enablement", () => {
  it("starts a new profile empty and keeps its origin through a legacy retry", async () => {
    const ctx = context()
    expect((await initializeProfileTools(ctx, "new")).enabled).toEqual([])
    expect((await initializeProfileTools(ctx, "legacy")).enabled).toEqual([])
  })

  it("migrates the four exact native identities once without altering research bytes", async () => {
    const ctx = context()
    const bytes = new Uint8Array([0, 255, 65, 13, 10])
    await ctx.storage.writeBinary(".scispark/chats/old.json", bytes)
    await ctx.storage.write(".scispark/reviews/old.json", '{ "report": "original" }\n')
    const state = await initializeProfileTools(ctx, "legacy")
    expect(state.enabled.map(({ tool }) => tool.skillId)).toEqual(["trending", "find-papers", "deep-review", "idea-spark"])
    expect(NATIVE_TOOL_MANIFESTS.map((tool) => tool.capabilities)).toEqual([["field-trends"], ["paper-search"], ["literature-review"], ["research-ideas"]])
    expect(state.enabled.every(({ tool }) => tool.packageId === "scispark.builtin")).toBe(true)
    expect(await listEnabledTools(ctx)).toHaveLength(4)
    expect(await initializeProfileTools(ctx, "legacy")).toEqual(state)
    expect(await ctx.storage.readBinary(".scispark/chats/old.json")).toEqual(bytes)
    expect(await ctx.storage.read(".scispark/reviews/old.json")).toBe('{ "report": "original" }\n')
  })

  it("never re-enables disabled tools during migration and keeps artifacts readable", async () => {
    const ctx = context()
    await initializeProfileTools(ctx, "legacy")
    disposers.push(registerToolAdapter(review().ref, async () => ({})))
    await ctx.storage.write("wiki/notes/review.md", "A retained review")
    expect(await listEnabledTools(ctx)).toHaveLength(4)
    expect(hasToolAdapter(review().ref)).toBe(true)
    await setToolEnabled(ctx, toolKey(review().ref), false)
    expect((await initializeProfileTools(ctx, "legacy")).enabled.find(({ tool }) => toolKey(tool) === toolKey(review().ref))).toBeUndefined()
    expect((await listEnabledTools(ctx)).some((manifest) => toolKey(manifest.ref) === toolKey(review().ref))).toBe(false)
    expect(await ctx.storage.read("wiki/notes/review.md")).toBe("A retained review")
  })

  it("preserves an existing native pin and an explicit disabled binding on first adoption", async () => {
    const ctx = context()
    const pinned = { ...review().ref, version: "older", digest: "1".repeat(64) }
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [{ tool: pinned, enabled: false }], pins: [pinned], overrides: [], migrated: false })
    const state = await initializeProfileTools(ctx, "legacy")
    expect(state.pins.find((pin) => pin.skillId === "deep-review")).toEqual(pinned)
    expect(state.enabled.find(({ tool }) => tool.skillId === "deep-review")).toEqual({ tool: pinned, enabled: false })
    expect((await listEnabledTools(ctx)).map((tool) => tool.ref.skillId)).not.toContain("deep-review")
  })

  it("does not advertise native execution before an exact adapter is registered", async () => {
    const ctx = context()
    await initializeProfileTools(ctx, "legacy")
    expect(await listEnabledTools(ctx)).toHaveLength(4)
    expect(hasToolAdapter(review().ref)).toBe(false)
    disposers.push(registerToolAdapter({ ...review().ref, digest: "a".repeat(64) }, async () => ({})))
    expect(hasToolAdapter(review().ref)).toBe(false)
  })

  it("isolates settings and enablement between profiles and rejects invalid binding patches", async () => {
    const a = context(), b = context()
    await initializeProfileTools(a, "new")
    await initializeProfileTools(b, "new")
    const key = toolKey(review().ref)
    await setToolEnabled(a, key, true)
    const patch = { tierModels: { strong: { provider: "openai" as const, model: "test-model" } }, roleTiers: { synthesis: "strong" as const } }
    const state = await setToolBinding(a, key, patch)
    expect(state.overrides).toEqual([{ toolKey: key, ...patch }])
    expect((await readProfileTools(b))?.enabled).toEqual([])
    expect((await readProfileTools(b))?.overrides).toEqual([])
    await expect(setToolBinding(a, key, { tierModels: { strong: { provider: "openai", model: "test", apiKey: "secret" } } } as never)).rejects.toThrow()
    await expect(setToolEnabled(a, "../../path", true)).rejects.toThrow()
    await expect(setToolEnabled(a, JSON.stringify(["unknown", "skill"]), true)).rejects.toThrow()
  })

  it("uses the same profile bindings for imported and built-in candidates", async () => {
    const ctx = context()
    const imported = { ...review(), ref: { ...review().ref, packageId: "example.research", skillId: "review" }, kind: "instructions" as const, provenance: { source: "local" as const, locator: "fixture", revision: "v1" } }
    disposers.push(registerToolManifest(imported))
    await initializeProfileTools(ctx, "new")
    await setToolEnabled(ctx, toolKey(imported.ref), true)
    expect(await listEnabledTools(ctx)).toEqual([imported])
    expect(hasToolAdapter(imported.ref)).toBe(false)
    await setToolBinding(ctx, toolKey(imported.ref), { tool: imported.ref, roleTiers: { primary: "fast" } })
    await expect(setToolBinding(ctx, toolKey(imported.ref), { tool: review().ref })).rejects.toThrow("mismatched identity")
    await setToolEnabled(ctx, toolKey(imported.ref), false)
    expect(await listEnabledTools(ctx)).toEqual([])
  })

  it("rejects an origin marker belonging to a different canonical vault", async () => {
    const ctx = context()
    await initializeProfileTools(ctx, "new")
    await expect(initializeProfileTools({ ...ctx, vaultId: "f".repeat(64) }, "legacy")).rejects.toThrow("ownership mismatch")
    expect((await readProfileTools(ctx))?.enabled).toEqual([])
  })

  it("keeps new origin after state publication fails and retries as legacy", async () => {
    const ctx = context()
    const write = ctx.storage.write.bind(ctx.storage)
    let fail = true
    ctx.storage.write = async (path, content) => {
      if (path === ".scispark/tools/state.json" && fail) { fail = false; throw new Error("Simulated crash") }
      return write(path, content)
    }
    await expect(initializeProfileTools(ctx, "new")).rejects.toThrow("Simulated crash")
    expect((await initializeProfileTools(ctx, "legacy")).enabled).toEqual([])
  })

  it("serializes simultaneous updates without losing bindings or overrides", async () => {
    const ctx = context()
    await initializeProfileTools(ctx, "new")
    await Promise.all(NATIVE_TOOL_MANIFESTS.map((manifest) => setToolEnabled(ctx, toolKey(manifest.ref), true)))
    await Promise.all(NATIVE_TOOL_MANIFESTS.map((manifest) => setToolBinding(ctx, toolKey(manifest.ref), { roleTiers: { primary: "fast" } })))
    expect((await readProfileTools(ctx))?.enabled).toHaveLength(4)
    expect((await readProfileTools(ctx))?.overrides).toHaveLength(4)
  })
})

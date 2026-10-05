import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, readFile, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { createUserProfile } from "../../usermodel/profile"
import { createLocalProfile, createProfileSession, getProfileSession, listLocalProfiles, revokeProfileSession } from "../local-profiles"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"
import { getDefaultServerVault, openServerVault, setServerVaultForTests } from "../vault"
import { resolveWorkflowContext } from "../../workflows/context"
import { readProfileTools } from "../../extensions/store"
import { setToolEnabled } from "../../extensions/profile-state"
import { toolKey } from "../../extensions/contracts"
import { NATIVE_TOOL_MANIFESTS } from "../../extensions/native-catalog"

describe("local profiles", () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scispark-profiles-"))
    env = { NODE_ENV: "test", SCISPARK_VAULT: join(dir, "existing-vault"), SCISPARK_PROFILES_DIR: join(dir, "profiles") }
    vi.stubEnv("SCISPARK_VAULT", env.SCISPARK_VAULT)
    vi.stubEnv("SCISPARK_PROFILES_DIR", env.SCISPARK_PROFILES_DIR)
  })
  afterEach(async () => { vi.restoreAllMocks(); setServerVaultForTests(null); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) })

  it("adopts the existing vault once, preserving its profile and files", async () => {
    const storage = new NodeFsVaultStorage(env.SCISPARK_VAULT!)
    await createUserProfile(storage, { name: "Ada", role: "Researcher", fields: "EEG", topics: "Hearing", feedPrefs: "Methods" })
    await storage.write("wiki/notes/keep.md", "My research")
    const [a, b] = await Promise.all([listLocalProfiles(env), listLocalProfiles(env)])
    expect(a).toHaveLength(1)
    expect(a).toEqual(b)
    expect(a[0]).toMatchObject({ name: "Ada", vaultPath: await realpath(env.SCISPARK_VAULT!) })
    expect(await storage.read("wiki/notes/keep.md")).toBe("My research")
    const ctx = await resolveWorkflowContext(a[0], env)
    expect((await readProfileTools(ctx))?.enabled).toHaveLength(4)
    await setToolEnabled(ctx, toolKey(NATIVE_TOOL_MANIFESTS[2].ref), false)
    await listLocalProfiles(env)
    expect((await readProfileTools(ctx))?.enabled).toHaveLength(3)
  })

  it("creates one separate vault per profile without copying research or settings", async () => {
    const [original] = await listLocalProfiles(env)
    await new NodeFsVaultStorage(original.vaultPath).write(".scispark/settings.json", '{"dailyBudgetUsd":7}')
    const created = await createLocalProfile("Grace", env)
    expect(created.id).not.toBe(original.id)
    expect(created.vaultPath).not.toBe(original.vaultPath)
    const fresh = new NodeFsVaultStorage(created.vaultPath)
    expect(await fresh.read("schema.md")).toContain("Vault Schema")
    expect(await fresh.read(".scispark/settings.json")).toBeNull()
    expect((await readProfileTools(await resolveWorkflowContext(created, env)))?.enabled).toEqual([])
    await fresh.write("wiki/notes/new.md", "Grace only")
    expect(await new NodeFsVaultStorage(original.vaultPath).read("wiki/notes/new.md")).toBeNull()
    expect(await listLocalProfiles(env)).toHaveLength(2)
  })

  it("keeps a fresh configured default empty through the real startup scaffold ordering", async () => {
    const storage = await getDefaultServerVault()
    expect(await storage.read("schema.md")).toContain("Vault Schema")
    const [profile] = await listLocalProfiles(env)
    expect((await readProfileTools(await resolveWorkflowContext(profile, env)))?.enabled).toEqual([])
    expect(await readFile(join(env.SCISPARK_PROFILES_DIR!, "extensions", "profiles", profile.id, "origin.json"), "utf8")).toContain('"origin": "new"')
  })

  it("adopts already registered profiles without a marker as legacy and preserves record bytes", async () => {
    const storage = new NodeFsVaultStorage(env.SCISPARK_PROFILES_DIR!)
    const profile = { id: "a".repeat(32), name: "Existing", vaultPath: join(dir, "registered-vault") }
    await storage.write("profiles.json", JSON.stringify({ version: 1, profiles: [profile] }))
    const vault = new NodeFsVaultStorage(profile.vaultPath)
    const bytes = new Uint8Array([255, 0, 65, 10])
    await vault.writeBinary(".scispark/chats/old.json", bytes)
    await vault.write(".scispark/reviews/old.json", '{ "old": true }\n')
    await listLocalProfiles(env)
    expect((await readProfileTools(await resolveWorkflowContext(profile, env)))?.enabled).toHaveLength(4)
    expect(await vault.readBinary(".scispark/chats/old.json")).toEqual(bytes)
    expect(await vault.read(".scispark/reviews/old.json")).toBe('{ "old": true }\n')
  })

  it("persists origin and empty state before registry publication, including failed retries", async () => {
    const originalWrite = NodeFsVaultStorage.prototype.write
    let fail = true
    vi.spyOn(NodeFsVaultStorage.prototype, "write").mockImplementation(async function (this: NodeFsVaultStorage, path, content) {
      if (path === "profiles.json") {
        const profiles = JSON.parse(content).profiles as { vaultPath: string }[]
        const state = await new NodeFsVaultStorage(profiles[profiles.length - 1].vaultPath).read(".scispark/tools/state.json")
        expect(JSON.parse(state!).enabled).toEqual([])
        if (fail) { fail = false; throw new Error("Registry unavailable") }
      }
      return originalWrite.call(this, path, content)
    })
    await expect(listLocalProfiles(env)).rejects.toThrow("Registry unavailable")
    await openServerVault(env.SCISPARK_VAULT!)
    const [profile] = await listLocalProfiles(env)
    expect((await readProfileTools(await resolveWorkflowContext(profile, env)))?.enabled).toEqual([])
    const created = await createLocalProfile("Fresh", env)
    expect((await readProfileTools(await resolveWorkflowContext(created, env)))?.enabled).toEqual([])
  })

  it("registers a newly configured vault once and rejects nested ownership", async () => {
    const [first] = await listLocalProfiles(env)
    const nextEnv = { ...env, SCISPARK_VAULT: join(dir, "second-vault") }
    expect(await listLocalProfiles(nextEnv)).toHaveLength(2)
    expect(await listLocalProfiles(nextEnv)).toHaveLength(2)
    await expect(listLocalProfiles({ ...env, SCISPARK_VAULT: join(first.vaultPath, "nested") })).rejects.toThrow("must not contain")
    await expect(listLocalProfiles({ ...env, SCISPARK_PROFILES_DIR: join(first.vaultPath, "registry") })).rejects.toThrow("outside")
  })

  it("rejects invalid or duplicate names without registering another vault", async () => {
    await createLocalProfile("Grace", env)
    await expect(createLocalProfile("  ", env)).rejects.toThrow()
    await expect(createLocalProfile("gRaCe", env)).rejects.toThrow("already")
    expect(await listLocalProfiles(env)).toHaveLength(2)
  })

  it("binds concurrent sessions to their own vault and revokes only the signed-out session", async () => {
    const [a] = await listLocalProfiles(env)
    const b = await createLocalProfile("Grace", env)
    const sa = await createProfileSession(a.id, env)
    const sb = await createProfileSession(b.id, env)
    expect((await getProfileSession(sa.token, env))?.vaultPath).toBe(a.vaultPath)
    expect((await getProfileSession(sb.token, env))?.vaultPath).toBe(b.vaultPath)
    await revokeProfileSession(sa.token, env)
    expect(await getProfileSession(sa.token, env)).toBeNull()
    expect((await getProfileSession(sb.token, env))?.id).toBe(b.id)
    expect(await getProfileSession(undefined, env)).toBeNull()
    expect(await getProfileSession("../../outside", env)).toBeNull()
    await expect(createProfileSession("missing", env)).rejects.toThrow()
    expect(await readFile(join(env.SCISPARK_PROFILES_DIR!, "profiles.json"), "utf8")).not.toContain(sb.token)
  })

  it("blocks signed-out access and stale-tab reads and writes at the API boundary", async () => {
    const [a] = await listLocalProfiles(env)
    const b = await createLocalProfile("Grace", env)
    const session = await createProfileSession(b.id, env)
    const request = (method: string, profileId?: string, token = session.token) => new NextRequest("http://localhost:3000/api/vault/file?path=wiki/notes/private.md", {
      method, headers: { host: "localhost:3000", cookie: `scispark-session=${token}`, ...(profileId ? { "x-scispark-profile": profileId } : {}) },
    })
    expect((await proxy(request("GET", b.id))).status).toBe(200)
    expect((await proxy(request("PUT", b.id))).status).toBe(200)
    expect((await proxy(request("GET", a.id))).status).toBe(409)
    expect((await proxy(request("PUT", a.id))).status).toBe(409)
    expect((await proxy(request("PUT"))).status).toBe(409)
    expect((await proxy(request("GET"))).status).toBe(409)
    expect((await proxy(new NextRequest(`http://localhost:3000/api/reviews/example/export?scisparkProfile=${a.id}`, { headers: { cookie: `scispark-session=${session.token}` } }))).status).toBe(409)
    expect((await proxy(new NextRequest(`http://localhost:3000/api/reviews/example/export?scisparkProfile=${b.id}`, { headers: { cookie: `scispark-session=${session.token}` } }))).status).toBe(200)
    await revokeProfileSession(session.token, env)
    expect((await proxy(request("GET", b.id))).status).toBe(401)
    expect((await proxy(request("PUT", b.id))).status).toBe(401)
  })
})

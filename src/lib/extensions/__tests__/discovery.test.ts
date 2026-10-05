// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, realpath, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import childProcess from "node:child_process"
import { NextRequest } from "next/server"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import type { WorkflowContext } from "../../workflows/context"
import { grantDiscovery, discoverAgentSkills, stageDiscoveredSkill, revokeDiscovery, readDiscoveryResults } from "../discovery"
import { DiscoveryActionSchema } from "../import-contract"
import { commitImport, reviewImport, selectDiscoveredPreview } from "../inspect"
import { readImportedManifests, extensionObjectPath } from "../store"
import * as extensionStore from "../store"
import * as route from "@/app/api/tools/discovery/route"
import * as profiles from "../../server/local-profiles"
import * as contexts from "../../workflows/context"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../../local-profile-contract"

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const skill = (body = "Read papers.") => `---\nname: Research\ndescription: Literature research and citations\n---\n${body}`
async function fixture(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "scispark-discovery-")); roots.push(root)
  const source = join(root, "agent"), vault = join(root, "vault"), runtime = join(root, "runtime")
  await Promise.all([source, vault, runtime].map(p => mkdir(p)))
  for (const [path, text] of Object.entries(files)) { await mkdir(join(source, path, ".."), { recursive: true }); await writeFile(join(source, path), text) }
  const ctx: WorkflowContext = { profileId: randomUUID(), vaultId: "a".repeat(64), vaultPath: vault, runtimeRoot: runtime, storage: new NodeFsVaultStorage(vault) }
  return { root, source, ctx }
}

describe("consented agent discovery", () => {
  it("requires a grant, scans only allowed Codex/Claude layouts, ranks locally and never executes", async () => {
    const f = await fixture({ ".agents/skills/research/SKILL.md": skill(), ".codex/skills/other/SKILL.md": "---\nname: Design\ndescription: Draw icons\n---\nDraw.", "sessions/private/SKILL.md": "PRIVATE", "auth.json": "PRIVATE" })
    const exec = vi.spyOn(childProcess, "exec"), spawn = vi.spyOn(childProcess, "spawn")
    await expect(discoverAgentSkills(f.ctx, "missing-grant")).rejects.toThrow("permission")
    const grant = await grantDiscovery(f.ctx, [{ agent: "codex", layout: "config", path: f.source }])
    expect(grant.expiresAt - grant.createdAt).toBe(30 * 60 * 1000)
    expect(await readDiscoveryResults(f.ctx, grant.id)).toEqual([])
    const found = await discoverAgentSkills(f.ctx, grant.id)
    expect(found).toHaveLength(2); expect(found[0].researchScore).toBeGreaterThan(found[1].researchScore)
    expect(JSON.stringify(found)).not.toContain(f.source); expect(JSON.stringify(found)).not.toContain("PRIVATE")
    expect(exec).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled()
    await rm(f.source, { recursive: true })
    expect(await readDiscoveryResults(f.ctx, grant.id)).toEqual(found)
  })
  it("retains symlinked origins, includes sibling helpers in identity and keeps different same-named packages", async () => {
    const f = await fixture({ "one/SKILL.md": skill("Read [helper](../helper/guide.md)."), "helper/guide.md": "research helper", "different/SKILL.md": skill("Different content") })
    await symlink("one", join(f.source, "alias"))
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: f.source }])
    const found = await discoverAgentSkills(f.ctx, grant.id)
    expect(found).toHaveLength(2); expect(found.find(c => c.origins.length === 2)).toBeTruthy()
    const preview = await stageDiscoveredSkill(f.ctx, grant.id, found.find(c => c.origins.length === 2)!.id)
    expect(preview.tools).toHaveLength(1)
    expect(preview.tools[0].files.some(f => f.path.endsWith("helper/guide.md"))).toBe(true)
    await expect(stageDiscoveredSkill(f.ctx, grant.id, "../one/SKILL.md")).rejects.toThrow()
  })
  it("does not merge identical instructions backed by different resources or dependencies", async () => {
    const f = await fixture({ "a/SKILL.md": skill("Read [helper](guide.md)."), "a/guide.md": "one", "b/SKILL.md": skill("Read [helper](guide.md)."), "b/guide.md": "two" })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: f.source }])
    expect(await discoverAgentSkills(f.ctx, grant.id)).toHaveLength(2)
  })
  it("canonicalizes explicitly selected roots, rejects escapes and retargeted canonical roots", async () => {
    const f = await fixture({ "safe/SKILL.md": skill() }), alias = join(f.root, "alias")
    await symlink(f.source, alias)
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: alias }])
    expect(grant.roots[0].path).toBe(await realpath(f.source))
    await symlink(f.ctx.vaultPath, join(f.source, "escape"))
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow(/permission|consent/)
    await rm(join(f.source, "escape")); await rename(f.source, f.source + "-old"); await symlink(f.ctx.vaultPath, f.source)
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow(/permission|consent/)
  })
  it("fails closed on missing or external helper references and protected files", async () => {
    for (const body of ["Read [helper](missing.md).", "Read [helper](../../outside.md).", "Read [helper](auth.json).", "Read [helper](sessions/private.md)."] ) {
      const f = await fixture({ "one/SKILL.md": skill(body), "one/auth.json": "SECRET", "one/sessions/private.md": "SECRET" })
      const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: f.source }])
      await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow()
      expect(await readDiscoveryResults(f.ctx, grant.id)).toEqual([])
    }
  })
  it("expires grants and prevents cross-profile, cross-vault and revoked inspection; committed snapshots survive", async () => {
    const f = await fixture({ "one/SKILL.md": skill() })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: f.source }])
    const [candidate] = await discoverAgentSkills(f.ctx, grant.id)
    const preview = await stageDiscoveredSkill(f.ctx, grant.id, candidate.id)
    const reviewed = await reviewImport(f.ctx, preview.id, preview.tools.map(t => t.proposal))
    const refs = await commitImport(f.ctx, reviewed.id, reviewed.tools.map(t => t.manifest.ref))
    for (const ctx of [{ ...f.ctx, profileId: randomUUID() }, { ...f.ctx, vaultId: "b".repeat(64) }]) {
      await expect(readDiscoveryResults(ctx, grant.id)).rejects.toThrow("permission")
      await expect(stageDiscoveredSkill(ctx, grant.id, candidate.id)).rejects.toThrow("permission")
    }
    await revokeDiscovery(f.ctx, grant.id)
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow("permission")
    await expect(stageDiscoveredSkill(f.ctx, grant.id, candidate.id)).rejects.toThrow("permission")
    await expect(readDiscoveryResults(f.ctx, grant.id)).rejects.toThrow("permission")
    await rm(f.source, { recursive: true }); expect((await readImportedManifests(f.ctx)).map(m => m.ref)).toEqual(refs)
    expect(await readFile(join(extensionObjectPath(f.ctx, refs[0].digest), "files", reviewed.tools[0].manifest.entrypoint), "utf8")).toContain("Read papers")
    const other = await fixture({ "SKILL.md": skill() }), expired = await grantDiscovery(other.ctx, [{ agent: "custom", layout: "package", path: other.source }])
    vi.spyOn(Date, "now").mockReturnValue(expired.expiresAt)
    await expect(discoverAgentSkills(other.ctx, expired.id)).rejects.toThrow("permission")
  })
  it("recognizes installed Codex cache manifests and Claude selected installed-plugin records without reading agent settings", async () => {
    const f = await fixture({
      "codex/plugins/cache/market/pkg/1/.codex-plugin/plugin.json": JSON.stringify({ name: "pkg", skills: "./extras" }),
      "codex/plugins/cache/market/pkg/1/extras/one/SKILL.md": skill(),
      "claude/plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "pkg@market": [{ scope: "user", installPath: "./cache/market/pkg/1", version: "1" }] } }),
      "claude/plugins/cache/market/pkg/1/.claude-plugin/plugin.json": JSON.stringify({ name: "pkg", skills: ["./extras"] }),
      "claude/plugins/cache/market/pkg/1/extras/one/SKILL.md": skill("Claude research"),
      "claude/plugins/cache/market/pkg/old/skills/old/SKILL.md": "OLD UNSELECTED",
      "claude/settings.json": "NEVER READ THIS INVALID JSON", "codex/config.toml": "NEVER READ",
    })
    const grant = await grantDiscovery(f.ctx, [{ agent: "codex", layout: "config", path: join(f.source, "codex") }, { agent: "claude", layout: "config", path: join(f.source, "claude") }])
    const found = await discoverAgentSkills(f.ctx, grant.id)
    expect(found).toHaveLength(2); expect(JSON.stringify(found)).not.toContain("OLD UNSELECTED")
  })
  it("uses strict action IDs, native profile/origin guards and saved-only GET with operation replay", async () => {
    const f = await fixture({ "one/SKILL.md": skill() })
    vi.spyOn(profiles, "getProfileSession").mockResolvedValue({ id: f.ctx.profileId, name: "fixture", vaultPath: f.ctx.vaultPath })
    vi.spyOn(contexts, "resolveWorkflowContext").mockResolvedValue(f.ctx)
    const req = (body?: unknown, headers: Record<string, string> = {}, query = "") => new NextRequest(`http://localhost:3000/api/tools/discovery${query}`, { method: body ? "POST" : "GET", headers: { host: "localhost:3000", cookie: `${PROFILE_COOKIE}=fixture`, [PROFILE_HEADER]: f.ctx.profileId, "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const action = { action: "grant", operationId: randomUUID(), roots: [{ agent: "custom", layout: "skills", path: f.source }] }
    expect((await route.POST(req(action, { origin: "https://foreign.test" }))).status).toBe(403)
    expect((await route.POST(req(action, { [PROFILE_HEADER]: randomUUID() }))).status).toBe(409)
    expect(DiscoveryActionSchema.safeParse({ ...action, command: "run" }).success).toBe(false)
    const first = await route.POST(req(action)); expect(first.status).toBe(200)
    const grant = (await first.json()).result
    expect((await (await route.POST(req(action))).json()).result).toEqual(grant)
    expect((await route.POST(req({ ...action, roots: [] }))).status).toBe(400)
    expect((await route.POST(req({ ...action, roots: [{ agent: "custom", layout: "package", path: f.source }] }))).status).toBe(409)
    expect((await (await route.GET(req(undefined, {}, `?grantId=${grant.id}`))).json()).result).toEqual([])
    const scan = { action: "discover", operationId: randomUUID(), grantId: grant.id }
    const found = (await (await route.POST(req(scan))).json()).result
    expect(found).toHaveLength(1)
    const staged = (await (await route.POST(req({ action: "stage", operationId: randomUUID(), grantId: grant.id, candidateId: found[0].id }))).json()).result
    expect(staged).not.toHaveProperty("vaultId"); expect(staged).not.toHaveProperty("profileId"); expect(JSON.stringify(staged)).not.toContain(f.source)
    expect((await route.GET(req(undefined, {}, `?grantId=${grant.id}&path=/tmp`))).status).toBe(400)
    expect((await route.POST(req({ action: "revoke", operationId: randomUUID(), grantId: grant.id }))).status).toBe(200)
    expect((await route.POST(req(scan))).status).toBe(409)
    vi.mocked(profiles.getProfileSession).mockResolvedValue(null)
    expect((await route.GET(req(undefined, {}, `?grantId=${grant.id}`))).status).toBe(401)
  })
})

describe("discovery content and review boundaries", () => {
  it("separates same-named skills in different packages so import bindings cannot collide", async () => {
    const f = await fixture({ "a/one/SKILL.md": skill("Alpha"), "b/one/SKILL.md": skill("Beta") })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: join(f.source, "a") }, { agent: "custom", layout: "skills", path: join(f.source, "b") }])
    const candidates = await discoverAgentSkills(f.ctx, grant.id)
    const previews = await Promise.all(candidates.map(c => stageDiscoveredSkill(f.ctx, grant.id, c.id)))
    expect(new Set(previews.map(p => p.tools[0].manifest.ref.packageId)).size).toBe(2)
  })
  it("does not follow aliases from skill content into config siblings, even below the granted config root", async () => {
    const f = await fixture({ "skills/one/SKILL.md": skill("Read [helper](scripts/key.txt)."), "private/key.txt": "SECRET", "private/SKILL.md": skill() })
    await symlink("../../private", join(f.source, "skills/one/scripts"))
    const grant = await grantDiscovery(f.ctx, [{ agent: "codex", layout: "config", path: f.source }])
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow("permission")
    await rm(join(f.source, "skills"), { recursive: true }); await symlink("private", join(f.source, "skills"))
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow("permission")
  })
  it("rejects registry pointers into arbitrary config siblings without inspecting them", async () => {
    const f = await fixture({ "plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { bad: [{ installPath: "../private" }] } }), "private/.claude-plugin/plugin.json": "DO NOT PARSE", "private/skills/one/SKILL.md": skill() })
    const grant = await grantDiscovery(f.ctx, [{ agent: "claude", layout: "config", path: f.source }])
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow("permission")
  })
  it("expires and revokes Task 7 preview review/commit authority as well as discovery access", async () => {
    const f = await fixture({ "one/SKILL.md": skill() })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: f.source }])
    const [candidate] = await discoverAgentSkills(f.ctx, grant.id), preview = await stageDiscoveredSkill(f.ctx, grant.id, candidate.id)
    const reviewed = await reviewImport(f.ctx, preview.id, preview.tools.map(t => t.proposal))
    vi.spyOn(Date, "now").mockReturnValue(grant.expiresAt)
    await expect(reviewImport(f.ctx, preview.id, preview.tools.map(t => t.proposal))).rejects.toThrow("permission")
    await expect(commitImport(f.ctx, reviewed.id, reviewed.tools.map(t => t.manifest.ref))).rejects.toThrow("permission")
    vi.restoreAllMocks(); await revokeDiscovery(f.ctx, grant.id)
    await expect(reviewImport(f.ctx, preview.id, preview.tools.map(t => t.proposal))).rejects.toThrow()
    await expect(commitImport(f.ctx, reviewed.id, reviewed.tools.map(t => t.manifest.ref))).rejects.toThrow()
  })
  it("deduplicates exact closures across selected roots but distinguishes dependency identity", async () => {
    const ref = { packageId: "fixture", skillId: "helper", version: "1", digest: "a".repeat(64) }
    const body = (digest: string) => `---\nname: Research\ndescription: Literature research\nscispark:\n  dependencies: ${JSON.stringify([{ ...ref, digest }])}\n---\nResearch.`
    const f = await fixture({ "a/one/SKILL.md": skill(), "b/one/SKILL.md": skill(), "a/dependency/SKILL.md": body("a".repeat(64)), "b/dependency/SKILL.md": body("b".repeat(64)) })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: join(f.source, "a") }, { agent: "custom", layout: "skills", path: join(f.source, "b") }])
    const candidates = await discoverAgentSkills(f.ctx, grant.id)
    expect(candidates).toHaveLength(3); expect(candidates.filter(c => c.origins.length === 2)).toHaveLength(1)
  })
  it("requires explicit selection for plugin metadata paths outside the package and rejects directory cycles", async () => {
    const f = await fixture({ ".codex-plugin/plugin.json": JSON.stringify({ name: "bad", skills: "../outside" }), "skills/one/SKILL.md": skill() })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "package", path: f.source }])
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow()
    await rm(join(f.source, ".codex-plugin"), { recursive: true }); await symlink("..", join(f.source, "skills/cycle"))
    await expect(discoverAgentSkills(f.ctx, grant.id)).rejects.toThrow("cycle")
  })
})


describe("discovery publication consent races", () => {
  async function reviewedFixture() {
    const f = await fixture({ "one/SKILL.md": skill() })
    const grant = await grantDiscovery(f.ctx, [{ agent: "custom", layout: "skills", path: f.source }])
    const [candidate] = await discoverAgentSkills(f.ctx, grant.id), preview = await stageDiscoveredSkill(f.ctx, grant.id, candidate.id)
    const reviewed = await reviewImport(f.ctx, preview.id, preview.tools.map(t => t.proposal))
    return { ...f, grant, candidate, preview, reviewed, refs: reviewed.tools.map(t => t.manifest.ref) }
  }
  function barrier() {
    let arrive!: () => void, release!: () => void
    const reached = new Promise<void>(resolve => { arrive = resolve }), held = new Promise<void>(resolve => { release = resolve })
    return { arrive, reached, held, release }
  }
  it("finishes authorized publication before a competing revoke can complete", async () => {
    const f = await reviewedFixture(), gate = barrier(), events: string[] = []
    const original = extensionStore.recordImportedRefs
    vi.spyOn(extensionStore, "recordImportedRefs").mockImplementation(async (...args) => { gate.arrive(); await gate.held; return original(...args) })
    const committing = commitImport(f.ctx, f.reviewed.id, f.refs).then(result => { events.push("committed"); return result })
    await gate.reached
    const revoking = revokeDiscovery(f.ctx, f.grant.id).then(() => { events.push("revoked") })
    try {
      // A completed revoke is forbidden while a grant-authorized publication is
      // paused before catalog/binding writes. This fails the review's old race.
      expect(await Promise.race([revoking.then(() => "revoked"), new Promise(resolve => setTimeout(() => resolve("pending"), 40))])).toBe("pending")
    } finally { gate.release(); await Promise.all([committing, revoking]) }
    expect(events).toEqual(["committed", "revoked"])
    expect((await extensionStore.readProfileTools(f.ctx))?.enabled.map(b => b.tool)).toEqual(f.refs)
    expect((await readImportedManifests(f.ctx)).map(m => m.ref)).toEqual(f.refs)
  })
  it("publishes no catalog or binding when revocation wins the grant lock", async () => {
    const f = await reviewedFixture(), gate = barrier(), original = NodeFsVaultStorage.prototype.write
    vi.spyOn(NodeFsVaultStorage.prototype, "write").mockImplementation(async function (this: NodeFsVaultStorage, path, text) {
      await original.call(this, path, text)
      if (path === `discovery/grants/${f.grant.id}.json` && JSON.parse(text).grant.revoked) { gate.arrive(); await gate.held }
    })
    const revoking = revokeDiscovery(f.ctx, f.grant.id)
    await gate.reached
    const committing = commitImport(f.ctx, f.reviewed.id, f.refs)
    const rejected = expect(committing).rejects.toThrow()
    gate.release(); await Promise.all([revoking, rejected])
    expect((await extensionStore.readProfileTools(f.ctx))?.enabled ?? []).toEqual([])
    expect(await readImportedManifests(f.ctx)).toEqual([])
  })
  it("rechecks expiry after closure validation before any catalog/binding publication", async () => {
    const f = await reviewedFixture(), original = NodeFsVaultStorage.prototype.readBinary
    vi.spyOn(NodeFsVaultStorage.prototype, "readBinary").mockImplementation(async function (this: NodeFsVaultStorage, path) {
      const result = await original.call(this, path)
      if (path.startsWith(`imports/${f.preview.stageId}/files/`)) vi.spyOn(Date, "now").mockReturnValue(f.grant.expiresAt)
      return result
    })
    await expect(commitImport(f.ctx, f.reviewed.id, f.refs)).rejects.toThrow("permission")
    expect((await extensionStore.readProfileTools(f.ctx))?.enabled ?? []).toEqual([])
    expect(await readImportedManifests(f.ctx)).toEqual([])
  })
  it("rechecks expiry inside catalog publication after prepared objects and an awaited registration barrier", async () => {
    const f = await reviewedFixture(), gate = barrier(), original = extensionStore.recordImportedRefs
    vi.spyOn(extensionStore, "recordImportedRefs").mockImplementation(async (...args) => { gate.arrive(); await gate.held; return original(...args) })
    const committing = commitImport(f.ctx, f.reviewed.id, f.refs)
    const rejected = expect(committing).rejects.toThrow("permission")
    await gate.reached
    vi.spyOn(Date, "now").mockReturnValue(f.grant.expiresAt)
    gate.release(); await rejected
    expect((await extensionStore.readProfileTools(f.ctx))?.enabled ?? []).toEqual([])
    expect(await readImportedManifests(f.ctx)).toEqual([])
  })
  it("rechecks expiry after waiting to publish the enabled binding", async () => {
    const f = await reviewedFixture(), original = extensionStore.updateProfileTools
    vi.spyOn(extensionStore, "updateProfileTools").mockImplementation(async (...args) => {
      vi.spyOn(Date, "now").mockReturnValue(f.grant.expiresAt)
      return original(...args)
    })
    await expect(commitImport(f.ctx, f.reviewed.id, f.refs)).rejects.toThrow("permission")
    expect((await extensionStore.readProfileTools(f.ctx))?.enabled ?? []).toEqual([])
    // The catalog was written while authorized, before the injected expiry;
    // no enabled binding can be written afterward. This is safe to retry only
    // with a new discovery session, retaining the immutable prepared snapshot.
    expect((await readImportedManifests(f.ctx)).map(m => m.ref)).toEqual(f.refs)
  })
  it("does not persist a review preview when consent expires during resource validation", async () => {
    const f = await reviewedFixture(), original = NodeFsVaultStorage.prototype.readBinary
    const storage = await extensionStore.importStorage(f.ctx), before = await storage.list("imports/previews/")
    vi.spyOn(NodeFsVaultStorage.prototype, "readBinary").mockImplementation(async function (this: NodeFsVaultStorage, path) {
      const result = await original.call(this, path)
      if (path.startsWith(`imports/${f.preview.stageId}/files/`)) vi.spyOn(Date, "now").mockReturnValue(f.grant.expiresAt)
      return result
    })
    await expect(reviewImport(f.ctx, f.preview.id, f.preview.tools.map(t => t.proposal))).rejects.toThrow("permission")
    expect(await storage.list("imports/previews/")).toEqual(before)
  })
  it.each(["review", "stage", "selection"] as const)("serializes final %s preview persistence with revoke without nesting deadlocks", async action => {
    const f = await reviewedFixture(), gate = barrier(), events: string[] = [], original = NodeFsVaultStorage.prototype.write
    vi.spyOn(NodeFsVaultStorage.prototype, "write").mockImplementation(async function (this: NodeFsVaultStorage, path, text) {
      if (path.startsWith("imports/previews/")) { gate.arrive(); await gate.held }
      return original.call(this, path, text)
    })
    const saving = (action === "review" ? reviewImport(f.ctx, f.preview.id, f.preview.tools.map(t => t.proposal)) : action === "stage" ? stageDiscoveredSkill(f.ctx, f.grant.id, f.candidate.id) : selectDiscoveredPreview(f.ctx, f.preview.id, f.preview.tools[0].proposal.skillId)).then(result => { events.push("saved"); return result })
    await gate.reached
    const revoking = revokeDiscovery(f.ctx, f.grant.id).then(() => { events.push("revoked") })
    try { expect(await Promise.race([revoking.then(() => "revoked"), new Promise(resolve => setTimeout(() => resolve("pending"), 40))])).toBe("pending") }
    finally { gate.release(); await Promise.all([saving, revoking]) }
    expect(events).toEqual(["saved", "revoked"])
    await expect(stageDiscoveredSkill(f.ctx, f.grant.id, f.candidate.id)).rejects.toThrow("permission")
  })
})

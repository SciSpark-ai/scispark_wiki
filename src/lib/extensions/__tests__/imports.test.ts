// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import childProcess from "node:child_process"
import { zipSync, strToU8 } from "fflate"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import type { WorkflowContext } from "../../workflows/context"
import type { ToolManifest } from "../contracts"
import { acquirePackage } from "../acquire"
import { inspectPackage, reviewImport, commitImport, validateInputSchema } from "../inspect"
import { resolveDependencies } from "../dependencies"
import { readImportedManifests, extensionObjectPath } from "../store"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))) })
async function fixture(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "scispark-import-")); roots.push(root)
  const source = join(root, "source"), vault = join(root, "vault"), runtime = join(root, "runtime")
  await Promise.all([source, vault, runtime].map((p) => mkdir(p)))
  for (const [path, text] of Object.entries(files)) { await mkdir(join(source, path, ".."), { recursive: true }); await writeFile(join(source, path), text) }
  const ctx: WorkflowContext = { profileId: "11111111-1111-4111-8111-111111111111", vaultId: "a".repeat(64), vaultPath: vault, runtimeRoot: runtime, storage: new NodeFsVaultStorage(vault) }
  return { root, source, ctx }
}
const skills = { "skills/one/SKILL.md": "---\nname: Same name\ndescription: First tool\n---\nRead [shared](../../shared/guide.md).", "skills/two/SKILL.md": "---\nname: Same name\n---\nSecond tool", "shared/guide.md": "Read [detail](detail.txt)", "shared/detail.txt": "Required context", "LICENSE": "Fixture license", "unrelated.txt": "DO NOT SNAPSHOT" }
function manifest(skillId: string, dependencies: ToolManifest["dependencies"] = []): ToolManifest {
  return { ref: { packageId: "fixture", skillId, version: "1", digest: skillId.repeat(64).slice(0, 64) }, name: skillId, description: "", kind: "instructions", entrypoint: "SKILL.md", dependencies, capabilities: [], resources: [], connections: [], engines: [], inputSchema: { type: "object" }, outputKinds: ["markdown"], provenance: { source: "local", locator: "fixture", revision: "1" } }
}
async function zipFixture(names: Record<string, string>, ctx: WorkflowContext, root: string) {
  const path = join(root, "fixture.zip"); await writeFile(path, zipSync(Object.fromEntries(Object.entries(names).map(([k, v]) => [k, strToU8(v)]))))
  return acquirePackage(ctx, { kind: "zip", path })
}

describe("bounded package imports", () => {
  it("discovers two skills without executing commands and persists only reviewed selected closure across reload", async () => {
    const { ctx, source } = await fixture(skills)
    const exec = vi.spyOn(childProcess, "exec")
    const stage = await acquirePackage(ctx, { kind: "local-folder", path: source })
    const preview = await inspectPackage(ctx, stage)
    expect(preview.tools).toHaveLength(2)
    await expect(commitImport(ctx, preview.id, [preview.tools[0].manifest.ref])).rejects.toThrow("review")
    const reviewed = await reviewImport(ctx, preview.id, preview.tools.map((tool) => tool.proposal))
    const refs = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
    const loaded = await readImportedManifests({ ...ctx })
    expect(loaded.map((m) => m.ref)).toEqual(refs)
    const object = new NodeFsVaultStorage(extensionObjectPath(ctx, refs[0].digest))
    expect(await object.list("files/")).toEqual(["files/LICENSE", "files/shared/detail.txt", "files/shared/guide.md", "files/skills/one/SKILL.md"])
    expect(exec).not.toHaveBeenCalled(); exec.mockRestore()
  })
  it("isolates identities across origins, forbids builtin impersonation, and preserves safe symlink content", async () => {
    const a = await fixture({ "SKILL.md": "Hello", "resource.txt": "safe" }), b = await fixture({ "SKILL.md": "Hello" })
    await symlink("resource.txt", join(a.source, "copy.txt"))
    const first = await acquirePackage(a.ctx, { kind: "local-folder", path: a.source })
    expect(await readFile(join(a.ctx.runtimeRoot, "profiles", a.ctx.profileId, "imports", first.id, "files", "copy.txt"), "utf8")).toBe("safe")
    const p1 = await inspectPackage(a.ctx, first), p2 = await inspectPackage(b.ctx, await acquirePackage(b.ctx, { kind: "local-folder", path: b.source }))
    expect(p1.tools[0].manifest.ref.packageId).not.toBe(p2.tools[0].manifest.ref.packageId)
    await expect(acquirePackage(a.ctx, { kind: "local-folder", path: a.source, packageId: "scispark.builtin" })).rejects.toThrow()
    await symlink("../vault", join(a.source, "escape"))
    await expect(acquirePackage(a.ctx, { kind: "local-folder", path: a.source })).rejects.toThrow("source root")
  })
  it.each(["../evil", "/absolute", "C:/evil", "\\\\server\\share", "a/../../evil", "a\\evil", "a/./b", "file."])("rejects archive path %s", async (path) => {
    const { ctx, root } = await fixture()
    await expect(zipFixture({ [path]: "x" }, ctx, root)).rejects.toThrow("archive path")
  })
  it("rejects case aliases, nested archives and actual expansion overflow", async () => {
    const { ctx, root } = await fixture()
    await expect(zipFixture({ "A.txt": "x", "a.txt": "y" }, ctx, root)).rejects.toThrow("duplicate")
    await expect(zipFixture({ "nested.zip": "payload" }, ctx, root)).rejects.toThrow("nested archive")
    const path = join(root, "overflow.zip")
    await writeFile(path, zipSync({ "bomb.txt": strToU8("x".repeat(10000)) }))
    await expect(acquirePackage(ctx, { kind: "zip", path }, { limits: { fileBytes: 100 } })).rejects.toThrow("limit")
  })
  it("returns an editable inferred proposal and keeps command setup unsupported", async () => {
    const { ctx, source } = await fixture({ "README.md": "A useful analysis script", "analyze.py": "raise RuntimeError('must not execute')" })
    const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "agent", path: source }))
    expect(preview.tools[0].inferred).toBe(true)
    expect(preview.tools[0].compatibility.status).toBe("needs-review")
    const proposal = { ...preview.tools[0].proposal, kind: "command" as const, entrypoint: "analyze.py", setup: { commands: [{ executable: "python3", argv: ["analyze.py"], network: [] }], runtimes: ["python3"], unsupported: [] } }
    const reviewed = await reviewImport(ctx, preview.id, [proposal])
    expect(reviewed.tools[0].compatibility.status).toBe("unsupported")
    await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
  })
})

describe("pinned dependency graph", () => {
  it("detects cycles, missing pins and exact-version conflicts without guessing helpers", () => {
    const a = manifest("a"), b = manifest("b"); a.dependencies = [b.ref]; b.dependencies = [a.ref]
    expect(resolveDependencies([a, b], [a.ref])).toMatchObject({ status: "blocked", reason: "dependency-cycle" })
    expect(resolveDependencies([a], [a.ref])).toMatchObject({ status: "blocked", reason: "missing-dependency" })
    b.dependencies = []
    expect(resolveDependencies([a, b], [a.ref])).toMatchObject({ status: "resolved", nodes: [b.ref, a.ref], edges: [{ parent: a.ref, dependency: b.ref }] })
  })
})

describe("bounded JSON input contracts", () => {
  it("uses Zod conversion and rejects external refs, executable regexes, unsupported constructs and depth", () => {
    expect(validateInputSchema({ type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }).safeParse({ query: "yes" }).success).toBe(true)
    for (const schema of [{ $ref: "https://evil/schema" }, { type: "string", pattern: "(a+)+$" }, { if: {}, then: {} }]) expect(() => validateInputSchema(schema)).toThrow()
    let deep = {}; for (let i = 0; i < 40; i++) deep = { type: "array", items: deep }
    expect(() => validateInputSchema(deep)).toThrow("depth")
  })
})

describe("GitHub acquisition transport", () => {
  const resolveHost = async () => [{ address: "140.82.112.3", family: 4 }]
  it("pins a commit, follows validated redirects, and never forwards or persists API credentials", async () => {
    const { ctx } = await fixture()
    const sha = "c".repeat(40), requests: { url: string; auth?: string }[] = []
    const archive = zipSync({ "repo-sha/SKILL.md": strToU8("Hello") })
    const request = vi.fn(async (url: URL, _address: unknown, headers: Record<string, string>) => {
      requests.push({ url: url.href, auth: headers.Authorization })
      if (url.pathname.includes("/commits/")) return new Response(JSON.stringify({ sha }))
      if (url.hostname === "api.github.com") return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/owner/repo/legacy.zip/" + sha } })
      return new Response(archive)
    })
    const stage = await acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo", ref: "main" }, { resolveHost, request, githubToken: async () => "fixture-private-token" })
    expect(stage.version).toBe(sha)
    expect(requests.map((r) => r.auth)).toEqual(["Bearer fixture-private-token", "Bearer fixture-private-token", undefined])
    expect(requests[1].url).toContain("/zipball/" + sha)
    expect(JSON.stringify(stage)).not.toContain("fixture-private-token")
    const preview = await inspectPackage(ctx, stage)
    expect(JSON.stringify(preview)).not.toContain("fixture-private-token")
  })
  it.each(["https://127.0.0.1/private", "http://codeload.github.com/archive", "https://evil.test/archive", "https://user:secret@codeload.github.com/archive", "https://codeload.github.com/archive?token=secret"])("rejects redirect %s before a second request", async (location) => {
    const { ctx } = await fixture(), request = vi.fn(async () => new Response(null, { status: 302, headers: { location } }))
    await expect(acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost, request })).rejects.toThrow("redirect")
    expect(request).toHaveBeenCalledTimes(1)
  })
  it("rejects DNS-resolved private addresses and reports access setup honestly", async () => {
    const { ctx } = await fixture(), request = vi.fn(async () => new Response(null, { status: 401 }))
    await expect(acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost: async () => [{ address: "127.0.0.1", family: 4 }], request })).rejects.toThrow("Private")
    expect(request).not.toHaveBeenCalled()
    await expect(acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost, request })).rejects.toMatchObject({ status: "needs-setup" })
  })
  it("counts streamed bytes independently of Content-Length", async () => {
    const { ctx } = await fixture()
    const request = vi.fn(async (url: URL) => url.pathname.includes("commits") ? new Response(JSON.stringify({ sha: "d".repeat(40) })) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(80)); controller.enqueue(new Uint8Array(80)); controller.close() } }), { headers: { "content-length": "1" } }))
    await expect(acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost, request, limits: { compressedBytes: 100 } })).rejects.toThrow("size limit")
  })
})

describe("archive and snapshot adversarial fixtures", () => {
  it("copies internal ZIP symlinks as bytes and rejects escape or cyclic links", async () => {
    const { ctx, root } = await fixture(), path = join(root, "links.zip")
    await writeFile(path, zipSync({ "SKILL.md": strToU8("Read [copy](copy.txt)"), "resource.txt": strToU8("safe"), "copy.txt": [strToU8("resource.txt"), { os: 3, attrs: (0xa1ff << 16) >>> 0 }] }))
    const stage = await acquirePackage(ctx, { kind: "zip", path })
    expect(stage.files.find((f) => f.path === "copy.txt")?.sha256).toBe(stage.files.find((f) => f.path === "resource.txt")?.sha256)
    await writeFile(path, zipSync({ "copy.txt": [strToU8("../../private"), { os: 3, attrs: (0xa1ff << 16) >>> 0 }] }))
    await expect(acquirePackage(ctx, { kind: "zip", path })).rejects.toThrow("archive path")
    await writeFile(path, zipSync({ "a": [strToU8("b"), { os: 3, attrs: (0xa1ff << 16) >>> 0 }], "b": [strToU8("a"), { os: 3, attrs: (0xa1ff << 16) >>> 0 }] }))
    await expect(acquirePackage(ctx, { kind: "zip", path })).rejects.toThrow("cycle")
  })
  it("rejects exact duplicate names and forged expanded sizes during actual inflate", async () => {
    const { ctx, root } = await fixture(), path = join(root, "hostile.zip")
    const duplicate = Buffer.from(zipSync({ "aa.txt": strToU8("first"), "bb.txt": strToU8("second") }))
    let at = duplicate.indexOf("bb.txt"); while (at >= 0) { duplicate.write("aa.txt", at); at = duplicate.indexOf("bb.txt", at + 6) }
    await writeFile(path, duplicate)
    await expect(acquirePackage(ctx, { kind: "zip", path })).rejects.toThrow("duplicate")
    const bomb = Buffer.from(zipSync({ "bomb.txt": strToU8("X".repeat(10000)) }))
    bomb.writeUInt32LE(1, 22)
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bomb.writeUInt32LE(1, central + 24)
    await writeFile(path, bomb)
    await expect(acquirePackage(ctx, { kind: "zip", path }, { limits: { fileBytes: 100 } })).rejects.toThrow("size limit")
  })
  it("recognizes each plugin/marketplace metadata format without following external sources", async () => {
    for (const metadata of [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
      const { ctx, source } = await fixture({ "nested/SKILL.md": "Hello", [metadata]: JSON.stringify({ name: "Fixture", hooks: "run me", plugins: [{ source: "https://untrusted.test/repo" }] }) })
      const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
      expect(preview.recognizedMetadata).toContain(metadata)
      expect(preview.tools[0].requirements.unsupported).toContain("Plugin hooks require a reviewed adapter")
      expect(preview.tools[0].requirements.unsupported).toContain("External marketplace source requires a separate explicit import")
    }
  })
  it("rejects stale refs, cross-profile previews and altered staged content", async () => {
    const { ctx, source } = await fixture(skills)
    const stage = await acquirePackage(ctx, { kind: "local-folder", path: source }), preview = await inspectPackage(ctx, stage)
    const reviewed = await reviewImport(ctx, preview.id, preview.tools.map((t) => t.proposal))
    await expect(commitImport(ctx, reviewed.id, [preview.tools[0].manifest.ref])).rejects.toThrow("Selection")
    await expect(commitImport({ ...ctx, profileId: "22222222-2222-4222-8222-222222222222" }, reviewed.id, [reviewed.tools[0].manifest.ref])).rejects.toThrow("this profile")
    await writeFile(join(ctx.runtimeRoot, "profiles", ctx.profileId, "imports", stage.id, "files", "skills/one/SKILL.md"), "tampered")
    await expect(commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])).rejects.toThrow("integrity")
    expect(await readImportedManifests(ctx)).toEqual([])
  })
  it("keeps earlier versions intact and rejects immutable metadata corruption", async () => {
    const { ctx, source } = await fixture({ "SKILL.md": "Version one" })
    const install = async () => { const p = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source })); const r = await reviewImport(ctx, p.id, p.tools.map((t) => t.proposal)); return (await commitImport(ctx, r.id, [r.tools[0].manifest.ref]))[0] }
    const first = await install(); await writeFile(join(source, "SKILL.md"), "Version two"); const second = await install()
    expect(first.digest).not.toBe(second.digest)
    expect(await readFile(join(extensionObjectPath(ctx, first.digest), "files", "SKILL.md"), "utf8")).toBe("Version one")
    expect(await readImportedManifests(ctx)).toHaveLength(2)
    const path = join(extensionObjectPath(ctx, second.digest), "snapshot.json"), snapshot = JSON.parse(await readFile(path, "utf8")); snapshot.tool.manifest.capabilities = ["arbitrary"]
    await writeFile(path, JSON.stringify(snapshot))
    await expect(readImportedManifests(ctx)).rejects.toThrow("digest")
  })
})

describe("dependency authorization and persistence", () => {
  it("accepts only declared immutable helper candidates and rejects version conflicts", async () => {
    const { selectDeclaredHelper } = await import("../dependencies")
    const a = manifest("a"), b = manifest("b"), alternate = { ...b.ref, version: "2" }
    const slots = [{ id: "literature", capability: "paper-search", eligible: [a.ref, b.ref] }]
    expect(selectDeclaredHelper(slots, "literature", b.ref)).toEqual(b.ref)
    expect(() => selectDeclaredHelper(slots, "undeclared", b.ref)).toThrow("Undeclared")
    expect(() => selectDeclaredHelper(slots, "literature", alternate)).toThrow("immutable eligible")
    expect(resolveDependencies([b, { ...b, ref: alternate }], [b.ref, alternate])).toMatchObject({ status: "blocked", reason: "version-conflict" })
    expect(resolveDependencies([a, { ...a, name: "impersonated" }], [a.ref])).toMatchObject({ status: "blocked", reason: "ambiguous-manifest" })
  })
  it("locks builtin dependencies without storing them as imported objects, and preserves profile state", async () => {
    const { NATIVE_TOOL_MANIFESTS } = await import("../native-catalog")
    const { readProfileTools, writeProfileTools } = await import("../store")
    const { ctx, source } = await fixture({ "SKILL.md": "Use a declared search dependency" })
    const native = NATIVE_TOOL_MANIFESTS[1].ref
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [{ tool: native, enabled: false }], pins: [native], overrides: [], migrated: true })
    const p = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
    const reviewed = await reviewImport(ctx, p.id, [{ ...p.tools[0].proposal, dependencies: [native] }])
    const refs = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
    expect((await readImportedManifests(ctx)).map((m) => m.ref)).toEqual(refs)
    expect(await readProfileTools(ctx)).toMatchObject({ enabled: [{ tool: native, enabled: false }, { tool: refs[0], enabled: true }], pins: [native], migrated: true })
    await expect(commitImport(ctx, reviewed.id, refs)).resolves.toEqual(refs)
  })
  it("rejects component aliases, excessive entry count, missing resources and external schema refs", async () => {
    const { ctx, root, source } = await fixture({ "SKILL.md": "Read [required](missing.md)" })
    await expect(zipFixture({ "A/one.txt": "a", "a/two.txt": "b" }, ctx, root)).rejects.toThrow("duplicate")
    const path = join(root, "count.zip"); await writeFile(path, zipSync({ a: strToU8("a"), b: strToU8("b") }))
    await expect(acquirePackage(ctx, { kind: "zip", path }, { limits: { entries: 1 } })).rejects.toThrow("entry limit")
    await expect(inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))).rejects.toThrow("Required resource")
    await writeFile(join(source, "SKILL.md"), "---\nscispark:\n  inputSchema:\n    $ref: https://evil.test/validator\n---\nHello")
    await expect(inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))).rejects.toThrow("Unsupported schema")
  })
})

describe("safe internal directory aliases", () => {
  it("copies local internal directories into regular content with root confinement and cycle/byte limits", async () => {
    const { ctx, source } = await fixture({ "SKILL.md": "Read [guide](alias/guide.md)", "shared/guide.md": "Safe resource" })
    await symlink("shared", join(source, "alias"))
    const stage = await acquirePackage(ctx, { kind: "local-folder", path: source })
    expect(stage.files.map((f) => f.path)).toContain("alias/guide.md")
    const preview = await inspectPackage(ctx, stage)
    expect(preview.tools[0].files.map((f) => f.path)).toContain("alias/guide.md")
    await expect(acquirePackage(ctx, { kind: "local-folder", path: source }, { limits: { expandedBytes: 20 } })).rejects.toThrow("limit")
    await symlink("..", join(source, "shared", "cycle"))
    await expect(acquirePackage(ctx, { kind: "local-folder", path: source })).rejects.toThrow("cycle")
  })
  it("copies ZIP internal directory targets, rejects their cycles and counts aliased expanded content", async () => {
    const { ctx, root } = await fixture(), path = join(root, "directory-links.zip")
    const link = (target: string) => [strToU8(target), { os: 3, attrs: (0xa1ff << 16) >>> 0 }] as [Uint8Array, { os: number; attrs: number }]
    await writeFile(path, zipSync({ "SKILL.md": strToU8("Read [guide](alias/guide.md)"), "shared/guide.md": strToU8("Safe resource"), alias: link("shared"), copy: link("alias/guide.md") }))
    const stage = await acquirePackage(ctx, { kind: "zip", path })
    expect(stage.files.map((f) => f.path)).toContain("alias/guide.md")
    expect(stage.files.find((f) => f.path === "copy")?.sha256).toBe(stage.files.find((f) => f.path === "shared/guide.md")?.sha256)
    await expect(acquirePackage(ctx, { kind: "zip", path }, { limits: { expandedBytes: 45 } })).rejects.toThrow("limit")
    await writeFile(path, zipSync({ "shared/guide.md": strToU8("safe"), "shared/back": link("../shared"), alias: link("shared") }))
    await expect(acquirePackage(ctx, { kind: "zip", path })).rejects.toThrow("cycle")
  })
})

describe("review regression fixes", () => {
  it("retains host-detected requirements when package setup and reviewed setup try to clear them", async () => {
    const { ctx, source } = await fixture({ "SKILL.md": "---\nscispark:\n  setup:\n    commands: []\n    runtimes: []\n    unsupported: []\n---\nHello", ".claude-plugin/plugin.json": JSON.stringify({ hooks: "run.sh", plugins: [{ source: "https://untrusted.test/external" }] }) })
    const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
    const detected = ["Plugin hooks require a reviewed adapter", "External marketplace source requires a separate explicit import"]
    expect(preview.tools[0].requirements.unsupported).toEqual(expect.arrayContaining(detected))
    const reviewed = await reviewImport(ctx, preview.id, [{ ...preview.tools[0].proposal, setup: { commands: [], runtimes: [], unsupported: [] } }])
    expect(reviewed.tools[0].requirements.unsupported).toEqual(expect.arrayContaining(detected))
    expect(reviewed.tools[0].compatibility).toMatchObject({ status: "unsupported", reasons: expect.arrayContaining(detected) })
    const rereview = await reviewImport(ctx, reviewed.id, [{ ...reviewed.tools[0].proposal, setup: { commands: [], runtimes: [], unsupported: [] } }])
    expect(rereview.tools[0].compatibility.status).toBe("unsupported")
  })
  it("snapshots full, collapsed, shortcut and image references with transitive Markdown resources", async () => {
    const { ctx, source } = await fixture({
      "skills/main/SKILL.md": "Read [guide][ Shared Guide ], [collapsed][], [shortcut] and ![image][picture].\n\n[shared guide]: ../../outside/guide.md\n[collapsed]: ../../outside/collapsed.txt\n[shortcut]: ../../outside/shortcut.txt\n[picture]: <../../outside/image.svg>\n[unused]: ../../outside/unused.txt\n",
      "outside/guide.md": "Read [next].\n\n[next]: ../elsewhere/deep.md\n",
      "elsewhere/deep.md": "![nested][]\n\n[nested]: <image with spaces.svg>\n",
      "elsewhere/image with spaces.svg": "<svg/>", "outside/collapsed.txt": "A", "outside/shortcut.txt": "B", "outside/image.svg": "<svg/>", "outside/unused.txt": "not linked",
    })
    const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
    const reviewed = await reviewImport(ctx, preview.id, preview.tools.map((tool) => tool.proposal))
    const [ref] = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
    expect(await new NodeFsVaultStorage(extensionObjectPath(ctx, ref.digest)).list("files/")).toEqual(["files/elsewhere/deep.md", "files/elsewhere/image with spaces.svg", "files/outside/collapsed.txt", "files/outside/guide.md", "files/outside/image.svg", "files/outside/shortcut.txt", "files/skills/main/SKILL.md"])
  })
  it.each(["local FIFO", "internal symlink to FIFO", "direct ZIP FIFO"])("rejects %s promptly and closes any pending descriptor", async (mode) => {
    const { constants, openSync, closeSync } = await import("node:fs")
    const { ctx, source } = await fixture({ "SKILL.md": "Hello" })
    const fifo = join(source, mode === "internal symlink to FIFO" ? "z-pipe" : "pipe")
    childProcess.execFileSync("mkfifo", [fifo])
    if (mode === "internal symlink to FIFO") await symlink("z-pipe", join(source, "a-link"))
    const pending = acquirePackage(ctx, mode === "direct ZIP FIFO" ? { kind: "zip", path: fifo } : { kind: "local-folder", path: source }).then(() => "unexpected success", (error: Error) => error.message)
    let timer: ReturnType<typeof setTimeout> | undefined
    let outcome: string
    try { outcome = await Promise.race([pending, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("blocked special-file open"), 500) })]) }
    finally {
      clearTimeout(timer)
      // RED cleanup: release the old blocking reader, then await its fstat error.
      // GREEN has no reader; nonblocking writer open returns ENXIO immediately.
      try { const fd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK); closeSync(fd) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENXIO") throw error }
      await pending
    }
    expect(outcome).toBe("Unsupported source file type")
  })
  it("accepts bounded transient signed archive queries without persisting or forwarding credentials", async () => {
    const { ctx } = await fixture(), sha = "e".repeat(40), querySecret = "fixture-signed-secret", apiSecret = "fixture-api-secret"
    const request = vi.fn(async (url: URL, _address: unknown, headers: Record<string, string>) => {
      if (url.pathname.includes("/commits/")) return new Response(JSON.stringify({ sha }))
      if (url.hostname === "api.github.com") return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/owner/repo/legacy.zip/${sha}?token=${querySecret}&expires=123456` } })
      expect(url.searchParams.get("token")).toBe(querySecret)
      expect(headers.Authorization).toBeUndefined()
      return new Response(zipSync({ "repo-sha/SKILL.md": strToU8("Hello") }))
    })
    const stage = await acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost: async () => [{ address: "140.82.112.3", family: 4 }], request, githubToken: async () => apiSecret })
    const preview = await inspectPackage(ctx, stage), reviewed = await reviewImport(ctx, preview.id, preview.tools.map((tool) => tool.proposal))
    await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
    const storage = new NodeFsVaultStorage(ctx.runtimeRoot)
    for (const path of await storage.list()) {
      const content = await storage.read(path)
      expect(content).not.toContain(querySecret); expect(content).not.toContain(apiSecret)
    }
    expect(JSON.stringify({ stage, preview, reviewed })).not.toContain(querySecret)
  })
})

describe("review fix boundary checks", () => {
  it.each(["[guide]:\n  shared.md", "> [guide]: shared.md", "[guide]: shared.md\n\n[nested [guide]][guide]", "[guide]: &amp;.md", "[`guide`]: shared.md\nRead [`guide`]."])("blocks unsupported reference syntax instead of producing an incomplete ready snapshot", async (markdown) => {
    const { ctx, source } = await fixture({ "SKILL.md": "Read [guide].\n\n" + markdown, "shared.md": "required" })
    await expect(inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))).rejects.toThrow("Unsupported Markdown reference")
  })
  it("does not treat code examples or unused reference definitions as required files", async () => {
    const { ctx, source } = await fixture({ "SKILL.md": "Read [actual]. Example: `[missing]: missing.md`.\n\n```md\n[fake]: missing.md\nRead [fake].\n```\n\n[actual]: good.md\n[unused]: absent.md", "good.md": "needed" })
    const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
    expect(preview.tools[0].files.map((file) => file.path)).toEqual(["good.md", "SKILL.md"])
  })
  it.each(["https://evil.test/download?token=secret", "https://api.github.com/archive?token=secret", "http://codeload.github.com/archive?token=secret", "https://codeload.github.com/archive?token=" + "x".repeat(8200)])("rejects invalid signed archive redirects without reflecting query credentials", async (location) => {
    const { ctx } = await fixture(), sha = "f".repeat(40)
    const request = vi.fn(async (url: URL) => url.pathname.includes("commits") ? new Response(JSON.stringify({ sha })) : new Response(null, { status: 302, headers: { location } }))
    const error = await acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost: async () => [{ address: "140.82.112.3", family: 4 }], request }).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Unsafe GitHub redirect/)
    expect((error as Error).message).not.toContain("secret")
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each(["request", "body", "redirect"])("redacts transient credentials from %s errors after signed redirects", async (failure) => {
    const { ctx } = await fixture(), secret = "signed-fixture-secret", sha = "f".repeat(40)
    const request = vi.fn(async (url: URL) => {
      if (url.pathname.includes("commits")) return new Response(JSON.stringify({ sha }))
      if (url.hostname === "api.github.com") return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/owner/repo/legacy.zip/${sha}?token=${secret}` } })
      if (failure === "body") return new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)) } }))
      if (failure === "redirect") return new Response(null, { status: 302, headers: { location: `https://[${secret}` } })
      throw new Error(`Failed request ${url.href}`)
    })
    const error = await acquirePackage(ctx, { kind: "github", url: "https://github.com/owner/repo" }, { resolveHost: async () => [{ address: "140.82.112.3", family: 4 }], request }).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain(secret)
  })
})

it("normalizes reference labels and retains shortcut fallback plus .markdown transitive resources", async () => {
  const { ctx, source } = await fixture({ "SKILL.md": "Read [Straße][MISSING] and [STRASSE].\n\n[straße]: shared.markdown", "shared.markdown": "Read [next].\n\n[next]: final.txt", "final.txt": "done" })
  const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
  expect(preview.tools[0].files.map((file) => file.path)).toEqual(["final.txt", "shared.markdown", "SKILL.md"])
})

describe("reference label adjacency", () => {
  it.each([
    ["separate paragraphs", "[first]\n\n[second]", ["first", "second"]],
    ["same-line space", "[first] [second]", ["first", "second"]],
    ["same-line tab", "[first]\t[second]", ["first", "second"]],
    ["line boundary", "[first]\n[second]", ["first", "second"]],
    ["blank CRLF paragraph", "[first]\r\n \t\r\n[second]", ["first", "second"]],
    ["adjacent full reference", "[first][second]", ["second"]],
    ["collapsed then independent shortcut", "[first][]\n\n[second]", ["first", "second"]],
  ])("snapshots the correct resources for %s", async (_name, body, resources) => {
    const { ctx, source } = await fixture({
      "skills/main/SKILL.md": `${body}\n\n[first]: ../../outside/first.txt\n[second]: ../../outside/second.txt`,
      "outside/first.txt": "First required resource", "outside/second.txt": "Second required resource",
    })
    const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
    const reviewed = await reviewImport(ctx, preview.id, preview.tools.map((tool) => tool.proposal))
    const [ref] = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
    expect(await new NodeFsVaultStorage(extensionObjectPath(ctx, ref.digest)).list("files/")).toEqual([
      ...(resources as string[]).map((name) => `files/outside/${name}.txt`), "files/skills/main/SKILL.md",
    ])
  })
})

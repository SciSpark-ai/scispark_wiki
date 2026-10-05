import { describe, expect, it } from "vitest"
import { buildSandboxPolicy, commandEnvironment, quoteCommand, validateCommandScope } from "../sandbox-policy"
import { CommandInvocationSchema } from "../import-contract"

const roots = { packageRoot: "/private/tmp/fixture/package", outputRoot: "/private/tmp/fixture/run/output", tempRoot: "/private/tmp/fixture/run/tmp", runtimeReadRoots: ["/usr/lib", "/bin", "/usr/bin"], executablePaths: { node: "/usr/bin/node" } }
const scope = { kind: "run" as const, id: "2133227a-bba4-4e94-8d13-6ecc2c95c6ee", profileId: "b".repeat(32), vaultId: "a".repeat(64), ...roots, researchRoot: "/private/tmp/fixture/research", resourceIds: ["paper-1"], connectionIds: [] }

describe("command isolation contract", () => {
  it("denies host reads and default runtime temp writes; grants only invocation roots", () => {
    const policy = buildSandboxPolicy(scope)
    expect(policy.filesystem.denyRead).toEqual(["/"])
    expect(policy.filesystem.allowRead).toContain(scope.researchRoot)
    expect(policy.filesystem.allowWrite).toEqual([scope.outputRoot, scope.tempRoot])
    expect(policy.filesystem.denyWrite).toContain("/tmp/claude")
    expect(policy.network).toMatchObject({ allowedDomains: [], allowLocalBinding: false, allowAllUnixSockets: false, allowUnixSockets: [] })
    expect(policy.enableWeakerNestedSandbox).toBe(false)
  })
  it("setup never accepts research roots or run connections", () => {
    expect(() => validateCommandScope({ ...scope, kind: "setup", registryDomains: ["registry.npmjs.org"] })).toThrow()
    const base = { ...roots, id: scope.id, profileId: scope.profileId, vaultId: scope.vaultId }
    const setup = validateCommandScope({ ...base, kind: "setup", registryDomains: ["registry.npmjs.org"] })
    expect(buildSandboxPolicy(setup).network.allowedDomains).toEqual(["registry.npmjs.org"])
    expect(buildSandboxPolicy(setup).filesystem.allowRead).not.toContain(scope.researchRoot)
  })
  it("does not inherit secrets, proxy settings, or user config", () => {
    const env = commandEnvironment(scope)
    expect(Object.keys(env).sort()).toEqual(["NODE_ENV", "HOME", "LANG", "PATH", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"].sort())
    expect(env.HOME).toBe(scope.tempRoot + "/home")
    expect(env.PATH).not.toContain(process.env.HOME)
  })
  it("quotes every argument once without shell expansion", () => {
    expect(quoteCommand("/usr/bin/node", ["a'b", "$(touch sentinel)", "a\nb", ""]))
      .toBe("exec '/usr/bin/node' 'a'\\''b' '$(touch sentinel)' 'a\nb' ''")
  })
  it("rejects raw executable/cwd paths, traversal and NUL arguments", () => {
    const invocation = { id: scope.id, executableId: "node", argv: ["ok"], cwd: ".", resourceIds: [], connectionIds: [] }
    expect(CommandInvocationSchema.safeParse(invocation).success).toBe(true)
    for (const bad of [{ executableId: "/bin/sh" }, { cwd: "../other" }, { cwd: "/tmp" }, { argv: ["a\0b"] }, { hostPath: "/tmp" }]) {
      expect(CommandInvocationSchema.safeParse({ ...invocation, ...bad }).success).toBe(false)
    }
  })
})

// Unit fake deliberately reports a missing backend; the platform file never
// imports/injects this fake and always executes the real worker.
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { fork } from "node:child_process"
import { mkdtemp, mkdir, realpath, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, vi } from "vitest"
import { createCommandContext, probeSandbox, runIsolatedCommand, withSetupCommandAccounting } from "../sandbox"
import { acquirePackage } from "../acquire"
import { inspectPackage, reviewImport, commitImport } from "../inspect"
import { recordImportedRefs, readImportedManifests } from "../store"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), fork: vi.fn() }))
const fixtures: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
function absentBackend() {
  vi.mocked(fork).mockImplementation(() => {
    const child = new EventEmitter() as ReturnType<typeof fork>
    Object.defineProperty(child, "connected", { value: true })
    child.send = (() => { queueMicrotask(() => child.emit("message", { type: "result", result: { exitCode: null, stdout: "", stderr: "", termination: "unavailable" } })); return true }) as typeof child.send
    child.kill = () => true
    return child
  })
}
async function fixtureContext() {
  const root = await realpath(await mkdtemp(join(tmpdir(),"scispark-sandbox-unit-"))); fixtures.push(root)
  const vaultPath = join(root,"vault"), runtimeRoot = join(root,"runtime"), source = join(root,"source")
  await Promise.all([vaultPath,runtimeRoot,source].map(p => mkdir(p)))
  await writeFile(join(source,"SKILL.md"), "A disposable test package")
  const ctx = { profileId: "b".repeat(32), vaultId: "a".repeat(64), vaultPath, runtimeRoot, storage: new NodeFsVaultStorage(vaultPath) }
  const preview = await inspectPackage(ctx, await acquirePackage(ctx, { kind: "local-folder", path: source }))
  const reviewed = await reviewImport(ctx, preview.id, preview.tools.map(t => t.proposal))
  const [ref] = await commitImport(ctx, reviewed.id, [reviewed.tools[0].manifest.ref])
  const input = { kind: "setup" as const, id: scope.id, packageDigest: ref.digest, executablePaths: { echo: "/bin/echo" }, runtimeReadRoots: ["/bin", "/usr/bin"] }
  return { ctx, input }
}
describe("host-created scopes and fail-closed dispatch", () => {
  it("reports a missing actual worker backend without any readiness grant", async () => {
    absentBackend()
    expect(await probeSandbox()).toMatchObject({ status: "needs-setup", evidence: [{ check: "actual-worker", status: "failed" }] })
    expect(fork).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fork).mock.calls[0][2]?.execArgv).toEqual([])
    expect(vi.mocked(fork).mock.calls[0][2]?.env).not.toHaveProperty("OPENAI_API_KEY")
  })
  it("rejects caller-forged contexts without spawning", async () => {
    const { ctx } = await fixtureContext()
    await expect(runIsolatedCommand({ ...ctx, commandScope: scope }, scope.id, { id: scope.id, executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] }, new AbortController().signal)).rejects.toThrow("Untrusted")
    expect(fork).not.toHaveBeenCalled()
  })
  it("keeps setup roots and profiles distinct and refuses execution on failed probes", async () => {
    absentBackend()
    const { ctx, input } = await fixtureContext()
    const a = await createCommandContext(ctx,input)
    const ctxB = { ...ctx, profileId: "c".repeat(32) }
    await expect(createCommandContext(ctxB,input)).rejects.toThrow("not imported")
    await recordImportedRefs(ctxB, (await readImportedManifests(ctx)).map(m => m.ref))
    const b = await createCommandContext(ctxB,input)
    expect(a.commandScope.outputRoot).not.toBe(b.commandScope.outputRoot)
    expect(a.commandScope).not.toHaveProperty("researchRoot")
    expect(Object.isFrozen(a.commandScope)).toBe(true)
    await expect(runIsolatedCommand(a, input.id, { id: scope.id, executableId: "echo", argv: ["MUST_NOT_EXECUTE"], cwd: ".", resourceIds: [], connectionIds: [] }, new AbortController().signal)).rejects.toThrow("isolation unavailable")
    await expect(runIsolatedCommand(a, "11111111-1111-4111-8111-111111111111", { id: scope.id, executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] }, new AbortController().signal)).rejects.toThrow("Untrusted")
  })
  it("rejects setup research grants and overbroad toolchain reads", async () => {
    const { ctx, input } = await fixtureContext()
    // @ts-expect-error Deliberately malformed host scope must also fail runtime validation.
    await expect(createCommandContext(ctx,{ ...input, resourceIds: ["paper"] })).rejects.toThrow()
    await expect(createCommandContext(ctx,{ ...input, runtimeReadRoots: ["/"] })).rejects.toThrow("Overbroad")
  })
  it("rechecks immutable package bytes before granting read access", async () => {
    const { ctx, input } = await fixtureContext()
    await writeFile(join(ctx.runtimeRoot,"objects",input.packageDigest,"files/SKILL.md"), "tampered")
    await expect(createCommandContext(ctx,input)).rejects.toThrow("integrity")
  })
})


describe("separate cumulative setup accounting", () => {
  it("settles actual elapsed time so many fast steps do not exhaust timeout reservations", async () => {
    const { ctx, input } = await fixtureContext()
    const commandCtx = await createCommandContext(ctx, input)
    let now = Date.now()
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
    try {
      for (let index = 0; index < 60; index++) {
        const invocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] })
        await withSetupCommandAccounting(commandCtx, invocation, "a".repeat(64), async () => {
          now += 10
          return { invocationId: invocation.id, exitCode: 0, stdout: "", stderr: "", termination: "exited", reconciliationRef: "fixture", uncertain: false }
        })
      }
      const journal = JSON.parse(await readFile(join(ctx.runtimeRoot,"profiles",ctx.profileId,"setup-attempts",input.id+".json"),"utf8"))
      expect(journal.attempts).toHaveLength(60)
      expect(journal.attempts.every((row: { activeSeconds: number; state: string }) => row.activeSeconds === 0.01 && row.state === "known")).toBe(true)
      const extra = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] })
      await expect(withSetupCommandAccounting(commandCtx,extra,"a".repeat(64),async () => { throw new Error("must not dispatch") })).rejects.toThrow("allowance")
    } finally { clock.mockRestore() }
  })
  it("retains consumed active seconds and refuses a new reservation at the time cap", async () => {
    const { ctx, input } = await fixtureContext()
    const commandCtx = await createCommandContext(ctx, input)
    let now = Date.now()
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
    try {
      for (let index = 0; index < 6; index++) {
        const invocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] })
        await withSetupCommandAccounting(commandCtx,invocation,"a".repeat(64),async () => {
          now += 300000
          return { invocationId: invocation.id, exitCode: null, stdout: "", stderr: "", termination: "timeout", reconciliationRef: "fixture", uncertain: false }
        })
      }
      const extra = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] })
      await expect(withSetupCommandAccounting(commandCtx,extra,"b".repeat(64),async () => { throw new Error("must not dispatch") })).rejects.toThrow("allowance")
    } finally { clock.mockRestore() }
  })
  it("keeps an uncertain reservation held and refuses retry without resetting counters", async () => {
    const { ctx, input } = await fixtureContext()
    const commandCtx = await createCommandContext(ctx, input)
    let now = Date.now()
    const clock = vi.spyOn(Date,"now").mockImplementation(() => now)
    try {
      const invocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] })
      const work = vi.fn(async () => { now += 500; return { invocationId: invocation.id, exitCode: null, stdout: "", stderr: "", termination: "worker-lost" as const, reconciliationRef: "fixture", uncertain: true } })
      await withSetupCommandAccounting(commandCtx,invocation,"b".repeat(64),work)
      await expect(withSetupCommandAccounting(commandCtx,{ ...invocation, id: randomUUID() },"c".repeat(64),work)).rejects.toThrow("reconciliation")
      const journal = JSON.parse(await readFile(join(ctx.runtimeRoot,"profiles",ctx.profileId,"setup-attempts",input.id+".json"),"utf8"))
      expect(journal.attempts).toHaveLength(1)
      expect(journal.attempts[0]).toMatchObject({ seconds: 300, activeSeconds: 0.5, state: "unknown" })
      expect(work).toHaveBeenCalledTimes(1)
    } finally { clock.mockRestore() }
  })
})

// Exercise the exact pinned runtime's real address guard, not a local imitation.
import { createResolvedAddressGuard } from "@anthropic-ai/sandbox-runtime/dist/sandbox/resolved-address-guard.js"
import { SetupRecipeSchema } from "../import-contract"
describe("private destinations behind allowlisted registry names", () => {
  const registry = "registry.npmjs.org"
  const privateAddresses = ["10.1.2.3", "172.16.2.3", "172.31.255.254", "192.168.2.3", "100.64.0.1", "100.127.255.254", "fc00::123", "fdff::123", "::ffff:10.1.2.3", "64:ff9b::a01:203", "2002:a01:203::1"]
  const setup = { ...roots, kind: "setup" as const, id: scope.id, profileId: scope.profileId, vaultId: scope.vaultId, registryDomains: [registry] }
  it.each([scope, setup])("denies private resolved IPs for $kind without weakening mandatory runtime denials", commandScope => {
    const guard = createResolvedAddressGuard({ ...buildSandboxPolicy(commandScope).network, localAddresses: () => [] })
    for (const address of privateAddresses) expect(guard.permits(registry,address,443), address).toBe(false)
    for (const address of ["127.0.0.1", "::1", "169.254.169.254", "fe80::123", "100.100.100.200", "168.63.129.16", "fd00:ec2::254"]) expect(guard.permits(registry,address,443), address).toBe(false)
    for (const address of ["1.1.1.1", "2606:4700:4700::1111", "172.15.255.254", "172.32.0.1", "100.63.255.254", "100.128.0.1"]) expect(guard.permits(registry,address,443), address).toBe(true)
  })
  it("refuses private-only DNS answers before a direct dial and preserves the checked public answer", async () => {
    const answers = privateAddresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 }))
    const resolve = vi.fn((_hostname, _options, callback) => callback(null,answers))
    const guard = createResolvedAddressGuard({ ...buildSandboxPolicy(setup).network, localAddresses: () => [], resolve })
    const lookup = () => new Promise<{ code?: string; address: unknown }>(done => guard.lookupFor(443)(registry,{},(error,address) => done({ code: error?.code, address })))
    expect(await lookup()).toMatchObject({ code: "ERR_SRT_RESOLVED_ADDRESS_DENIED" })
    answers.push({ address: "1.1.1.1", family: 4 })
    expect(await lookup()).toEqual({ code: undefined, address: "1.1.1.1" })
    expect(resolve).toHaveBeenCalledTimes(2)
  })
  it("does not accept worker probe controls in command invocations or setup recipes", () => {
    const invocation = { id: scope.id, executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [] }
    const recipe = { commands: [{ executable: "echo", argv: [], network: [registry] }], runtimes: [], unsupported: [] }
    expect(SetupRecipeSchema.safeParse(recipe).success).toBe(true)
    for (const controls of [{ mode: "probe" }, { probeDns: true }]) {
      expect(CommandInvocationSchema.safeParse({ ...invocation, ...controls }).success).toBe(false)
      expect(SetupRecipeSchema.safeParse({ ...recipe, commands: [{ ...recipe.commands[0], ...controls }] }).success).toBe(false)
    }
  })
  it("rejects probe controls before normal setup dispatch can launch a worker", async () => {
    const { ctx, input } = await fixtureContext()
    const commandCtx = await createCommandContext(ctx, input)
    const invocation = { id: randomUUID(), executableId: "echo", argv: [], cwd: ".", resourceIds: [], connectionIds: [], mode: "probe", probeDns: true }
    await expect(runIsolatedCommand(commandCtx, input.id, invocation, new AbortController().signal)).rejects.toThrow()
    expect(fork).not.toHaveBeenCalled()
  })
})

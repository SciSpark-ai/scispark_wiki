import { fork } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, sep } from "node:path"
import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { readRun } from "../workflows/store"
import { claimAttemptDispatch, reserveAttempt, settleAttempt } from "../workflows/usage"
import { currentRunAttemptScope } from "../workflows/attempt-scope"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { withVaultExclusive } from "../vault/exclusive"
import { ImportedSnapshotSchema, readImportedManifests, snapshotDigest } from "./store"
import { DigestSchema, ProfileIdSchema, UuidSchema } from "./contracts"
import { CommandInvocationSchema, CommandResultSchema, type CommandInvocation, type CommandResult, type SandboxReadiness } from "./import-contract"
import { buildSandboxPolicy, commandEnvironment, quoteCommand, validateCommandScope, type CommandScope } from "./sandbox-policy"

const workerPath = join(process.cwd(), "scripts/tool-command-worker.mjs")
const contexts = new WeakMap<CommandContext, CommandScope>()
export interface CommandContext extends WorkflowContext { readonly commandScope: CommandScope }
const scopeInputFields = {
  id: UuidSchema, packageDigest: DigestSchema,
  // Trusted Task9 toolchain resolution, never invocation/model fields.
  executablePaths: z.record(z.string(), z.string()), runtimeReadRoots: z.array(z.string()).min(1).max(50),
}
const CommandScopeInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), ...scopeInputFields, resourceIds: z.array(z.string()).optional(), connectionIds: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal("setup"), ...scopeInputFields, registryDomains: z.array(z.string()).optional() }).strict(),
])
export type CommandScopeInput = z.input<typeof CommandScopeInputSchema>
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep)
const canonical = (path: string) => realpath(/* turbopackIgnore: true */ path)
/** Host-only factory: Task9 supplies exact runtime roots; Task10 prepares the
 * research projection at the returned profile-owned projections/<run-id> path. */
export async function createCommandContext(ctx: WorkflowContext, input: CommandScopeInput): Promise<CommandContext> {
  input = CommandScopeInputSchema.parse(input)
  ProfileIdSchema.parse(ctx.profileId); DigestSchema.parse(ctx.vaultId)
  const id = UuidSchema.parse(input.id), digest = DigestSchema.parse(input.packageDigest)
  if (input.kind === "run") {
    const run = await readRun(ctx, id)
    if (!run || ![run.tool, ...run.dependencies].some(ref => ref.digest === digest)) throw new Error("Command package is not captured by this run")
  } else if (!(await readImportedManifests(ctx)).some(ref => ref.ref.digest === digest)) throw new Error("Setup package is not imported by this profile")
  const base = join(ctx.runtimeRoot, "profiles", ctx.profileId)
  const root = join(base, "commands", input.kind, id)
  const objectRoot = join(ctx.runtimeRoot, "objects", digest)
  const object = new NodeFsVaultStorage(objectRoot)
  if (await canonical(objectRoot) !== objectRoot || await object.hasSymlinkTraversal("snapshot.json")) throw new Error("Package root alias")
  const snapshot = await object.read("snapshot.json")
  if (!snapshot) throw new Error("Missing immutable package snapshot")
  const { tool } = ImportedSnapshotSchema.parse(JSON.parse(snapshot))
  if (tool.manifest.ref.digest !== digest || snapshotDigest(tool) !== digest) throw new Error("Package snapshot integrity mismatch")
  if (!tool.reviewed || tool.hostUnsupported.length || tool.requirements.unsupported.length) throw new Error("Package requirements remain unsupported")
  for (const file of tool.files) {
    const path = "files/" + file.path
    if (await object.hasSymlinkTraversal(path)) throw new Error("Package file alias")
    const bytes = await object.readBinary(path)
    if (!bytes || bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Package content integrity mismatch")
  }
  const packageRoot = await canonical(join(objectRoot,"files"))
  if (packageRoot !== join(objectRoot,"files")) throw new Error("Package root alias")
  for (const path of [root, join(root, "output"), join(root, "tmp")]) await mkdir(path, { recursive: true, mode: 0o700 })
  const outputRoot = await canonical(join(root, "output")), tempRoot = await canonical(join(root, "tmp"))
  if (outputRoot !== join(root, "output") || tempRoot !== join(root, "tmp")) throw new Error("Command root alias")
  const runtimeReadRoots = await Promise.all(input.runtimeReadRoots.map(canonical))
  if (runtimeReadRoots.some(path => path === "/" || inside(path, ctx.runtimeRoot) || inside(path, ctx.vaultPath))) throw new Error("Overbroad runtime read grant")
  const executablePaths: Record<string, string> = Object.fromEntries(await Promise.all(Object.entries(input.executablePaths).map(async ([key, path]) => [key, await canonical(path)])))
  if (Object.values(executablePaths).some(path => ![packageRoot, ...runtimeReadRoots].some(root => inside(root, path)))) throw new Error("Executable outside trusted runtime roots")
  let researchRoot: string | undefined
  if (input.kind === "run" && input.resourceIds?.length) {
    const expected = join(base, "projections", id)
    researchRoot = await canonical(expected)
    if (researchRoot !== expected) throw new Error("Research projection alias")
  }
  const shared = { id, profileId: ctx.profileId, vaultId: ctx.vaultId, packageRoot, outputRoot, tempRoot, runtimeReadRoots, executablePaths }
  const commandScope = validateCommandScope(input.kind === "run"
    ? { kind: "run", ...shared, researchRoot, resourceIds: input.resourceIds ?? [], connectionIds: input.connectionIds ?? [] }
    : { kind: "setup", ...shared, registryDomains: input.registryDomains ?? [] })
  Object.freeze(commandScope.runtimeReadRoots); Object.freeze(commandScope.executablePaths)
  if (commandScope.kind === "run") { Object.freeze(commandScope.resourceIds); Object.freeze(commandScope.connectionIds) } else Object.freeze(commandScope.registryDomains)
  Object.freeze(commandScope)
  const result = { ...ctx, commandScope }
  contexts.set(result, commandScope)
  return Object.freeze(result)
}

type WorkerRequest = { id: string; command: string; cwd: string; env: NodeJS.ProcessEnv; policy: ReturnType<typeof buildSandboxPolicy>; timeoutMs: number; outputBytes: number } & ({ mode: "command"; probeDns?: never } | { mode: "probe"; probeDns?: true })
type WorkerResult = Pick<CommandResult, "exitCode" | "stdout" | "stderr" | "termination">
/** IPC does not reach the command: its descriptors are only stdin/out/err. */
function launch(request: WorkerRequest, signal?: AbortSignal, control?: { armedPath: string; action: "cancel" | "disconnect" | "kill-worker" }): Promise<WorkerResult> {
  return new Promise(resolve => {
    const worker = fork(workerPath, [], { env: request.env, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] })
    let finished = false, disconnected = false
    let armPoll: ReturnType<typeof setInterval> | undefined
    const complete = (result: WorkerResult) => { if (finished) return; finished = true; clearTimeout(watchdog); clearInterval(armPoll); signal?.removeEventListener("abort", cancel); resolve(result) }
    const cancel = () => { if (worker.connected) worker.send({ type: "cancel" }) }
    // If supervisor hangs/crashes, its Linux bwrap parent-death binding owns the
    // namespace. On other systems ownership must pass the actual probe first.
    const watchdog = setTimeout(() => { worker.kill("SIGKILL"); complete({ exitCode: null, stdout: "", stderr: "", termination: "worker-lost" }) }, request.timeoutMs + 15_000)
    worker.on("message", message => {
      const msg = message as { type?: string; result?: WorkerResult }
      if (msg.type === "started" && control) armPoll = setInterval(() => {
        void readFile(control.armedPath, "utf8").then(value => {
          if (value !== "armed" || !worker.connected) return
          clearInterval(armPoll)
          if (control.action === "disconnect") { disconnected = true; worker.disconnect() } else if (control.action === "kill-worker") worker.kill("SIGKILL"); else cancel()
        }).catch(() => {})
      }, 20)
      if (msg.type === "result" && msg.result) complete(msg.result)
    })
    worker.once("error", () => complete({ exitCode: null, stdout: "", stderr: "", termination: "unavailable" }))
    worker.once("exit", () => complete({ exitCode: null, stdout: "", stderr: "", termination: disconnected ? "parent-disconnect" : "worker-lost" }))
    signal?.addEventListener("abort", cancel, { once: true })
    worker.send({ type: "start", request })
    if (signal?.aborted) cancel()
  })
}
async function requestFor(scope: CommandScope, invocation: ReturnType<typeof CommandInvocationSchema.parse>): Promise<WorkerRequest> {
  const executable = Object.hasOwn(scope.executablePaths, invocation.executableId) ? scope.executablePaths[invocation.executableId] : undefined
  if (!executable) throw new Error("Unapproved executable")
  if (invocation.connectionIds.length) throw new Error("Authenticated connection broker is not prepared")
  if (invocation.resourceIds.some(id => scope.kind !== "run" || !scope.resourceIds.includes(id))) throw new Error("Unapproved research resource")
  const cwd = await canonical(join(scope.outputRoot, invocation.cwd))
  if (!inside(scope.outputRoot, cwd)) throw new Error("Command cwd escapes output")
  const env = commandEnvironment(scope)
  for (const path of [env.HOME!, env.XDG_CACHE_HOME!, env.XDG_CONFIG_HOME!]) await mkdir(path, { recursive: true, mode: 0o700 })
  // Runtime installs its own proxy env. Override only its shared TMPDIR choice.
  const command = quoteCommand("/usr/bin/env", [`TMPDIR=${scope.tempRoot}`, executable, ...invocation.argv])
  return { mode: "command", id: invocation.id, command, cwd, env, policy: buildSandboxPolicy(scope), timeoutMs: invocation.timeoutMs, outputBytes: invocation.outputBytes }
}
function redact(value: string, scope: CommandScope): string {
  let text = value.replace(/\/(?:Users|home|private|tmp|opt)\/[^\s'"<>]+/g, "[host path]").replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]").replace(/\b(sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|password)\s*[:=]\s*[^\s]+)/gi, "[redacted]")
  for (const root of [scope.packageRoot, scope.outputRoot, scope.tempRoot, ...(scope.kind === "run" && scope.researchRoot ? [scope.researchRoot] : [])].sort((a,b) => b.length-a.length)) text = text.replaceAll(root, "[sandbox]")
  return text
}
const SetupJournal = z.object({ id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema, attempts: z.array(z.object({ id: UuidSchema, hash: DigestSchema, seconds: z.number().positive().max(300), activeSeconds: z.number().nonnegative().max(300).optional(), state: z.enum(["dispatched", "known", "unknown"]) }).strict().refine(row => row.state !== "known" || row.activeSeconds !== undefined, "Known setup attempts require elapsed usage")).max(60) }).strict()
/** Accounting only, NOT execution authorization. Exported for focused journal tests.
 * Task9 owns setup lifecycle/ready markers and must not reserve commands twice. */
export async function withSetupCommandAccounting(ctx: CommandContext, invocation: ReturnType<typeof CommandInvocationSchema.parse>, hash: string, work: () => Promise<CommandResult>) {
  invocation = CommandInvocationSchema.parse(invocation); DigestSchema.parse(hash)
  if (!contexts.has(ctx) || ctx.commandScope.kind !== "setup") throw new Error("Untrusted setup accounting scope")
  const storage = new NodeFsVaultStorage(join(ctx.runtimeRoot, "profiles", ctx.profileId))
  const scope = ctx.commandScope, path = `setup-attempts/${scope.id}.json`
  return withVaultExclusive(storage, "setup-command-" + scope.id, async () => {
    const raw = await storage.read(path)
    const journal = raw ? SetupJournal.parse(JSON.parse(raw)) : { id: scope.id, profileId: ctx.profileId, vaultId: ctx.vaultId, attempts: [] as z.infer<typeof SetupJournal>["attempts"] }
    if (journal.id !== scope.id || journal.profileId !== ctx.profileId || journal.vaultId !== ctx.vaultId) throw new Error("Setup journal owner mismatch")
    if (journal.attempts.some(a => a.state !== "known")) throw new Error("Setup requires reconciliation or discarded staging")
    if (journal.attempts.some(a => a.id === invocation.id)) throw new Error("Setup attempt already dispatched")
    const seconds = invocation.timeoutMs / 1000
    if (journal.attempts.length >= 60 || journal.attempts.reduce((sum, a) => sum + (a.state === "known" ? a.activeSeconds! : a.seconds), 0) + seconds > 1800) throw new Error("Setup allowance reached")
    const row: z.infer<typeof SetupJournal>["attempts"][number] = { id: invocation.id, hash, seconds, state: "dispatched" }
    journal.attempts.push(row)
    await storage.write(path, JSON.stringify(journal))
    const started = Date.now()
    const elapsed = () => Math.max(0, Math.min(seconds, (Date.now() - started) / 1000))
    try {
      const result = await work(); row.state = result.uncertain ? "unknown" : "known"; row.activeSeconds = elapsed()
      await storage.write(path, JSON.stringify(journal)); return result
    } catch (error) { row.state = "unknown"; row.activeSeconds = elapsed(); await storage.write(path, JSON.stringify(journal)); throw error }
  })
}
/** Task8 is the single reservation owner. Task10 must NOT wrap this in another
 * withWorkflowAttempt. Scope id is the run id, or a separately durable setup id. */
export async function runIsolatedCommand(ctx: CommandContext, runId: string, input: CommandInvocation, signal: AbortSignal): Promise<CommandResult> {
  if (!contexts.has(ctx)) throw new Error("Untrusted command scope")
  const storage = new NodeFsVaultStorage(join(ctx.runtimeRoot, "profiles", ctx.profileId))
  return withVaultExclusive(storage, "command-dispatch", () => dispatchCommand(ctx, runId, input, signal))
}
async function dispatchCommand(ctx: CommandContext, runId: string, input: CommandInvocation, signal: AbortSignal): Promise<CommandResult> {
  const scope = contexts.get(ctx)
  if (!scope || scope !== ctx.commandScope || scope.id !== runId || scope.profileId !== ctx.profileId || scope.vaultId !== ctx.vaultId) throw new Error("Untrusted command scope")
  const parent = currentRunAttemptScope()
  if (parent && (scope.kind !== "run" || parent.runId !== runId || parent.ctx.profileId !== ctx.profileId || parent.ctx.vaultId !== ctx.vaultId)) throw new Error("Command root scope mismatch")
  if (parent?.signal) signal = AbortSignal.any([signal, parent.signal])
  signal.throwIfAborted()
  const invocation = CommandInvocationSchema.parse(input)
  const readiness = await probeSandbox()
  if (readiness.status !== "ready") throw new Error("Command isolation unavailable: " + readiness.evidence.filter(e => e.status !== "passed").map(e => e.check).join(", "))
  signal.throwIfAborted()
  // Run invocations own fresh output/temp roots; setup commands share only their staged environment. Prior invocations stay denied.
  const childScope = { ...scope, outputRoot: scope.kind === "run" ? join(scope.outputRoot, invocation.id) : scope.outputRoot, tempRoot: join(scope.tempRoot, invocation.id) }
  if (scope.kind === "run") await mkdir(childScope.outputRoot, { recursive: false, mode: 0o700 })
  await mkdir(childScope.tempRoot, { recursive: false, mode: 0o700 })
  const request = await requestFor(childScope, invocation)
  const hash = createHash("sha256").update(JSON.stringify(invocation)).digest("hex")
  const execute = async (reconciliationRef: string) => {
    const raw = await launch(request, signal)
    const bound = (text: string, limit: number) => new TextDecoder().decode(Buffer.from(text).subarray(0, limit), { stream: true })
    const stdout = bound(redact(raw.stdout, childScope), invocation.outputBytes)
    const stderr = bound(redact(raw.stderr, childScope), invocation.outputBytes - Buffer.byteLength(stdout))
    return CommandResultSchema.parse({ ...raw, stdout, stderr, invocationId: invocation.id, reconciliationRef,
      uncertain: raw.termination === "worker-lost" || raw.termination === "parent-disconnect" })
  }
  if (scope.kind === "setup") return withSetupCommandAccounting(ctx, invocation, hash, () => execute(`setup-attempts/${scope.id}.json#${invocation.id}`))
  const run = await readRun(ctx, runId)
  if (!run) throw new Error("Run missing")
  const ticket = await reserveAttempt(ctx, runId, { id: invocation.id, kind: "command", replay: "reconcile", inputHash: hash }, { modelCalls: 0, commandCalls: 1, activeSeconds: invocation.timeoutMs / 1000, costUsd: run.model.engine === "api" ? 0 : null, accountingOwner: "workflow" })
  await claimAttemptDispatch(ctx, ticket)
  const started = Date.now()
  let result: CommandResult
  try { result = await execute(`.scispark/tool-runs/${runId}/usage.json#${ticket.id}`) }
  catch (error) {
    await settleAttempt(ctx, ticket, { modelCalls: 0, commandCalls: 1, activeSeconds: Math.min(invocation.timeoutMs / 1000, (Date.now()-started)/1000), costUsd: run.model.engine === "api" ? 0 : null, outcome: "unknown" })
    throw error
  }
  await settleAttempt(ctx, ticket, { modelCalls: 0, commandCalls: 1, activeSeconds: Math.min(invocation.timeoutMs / 1000, (Date.now()-started)/1000), costUsd: run.model.engine === "api" ? 0 : null, outcome: result.uncertain ? "unknown" : "known" })
  return result
}

/** Actual worker probes; no injected backend can grant readiness. Every fixture
 * is disposable. No real home/config/research content is opened. */
export async function probeSandbox(): Promise<SandboxReadiness> {
  if (!["linux", "darwin"].includes(process.platform)) return { status: "unsupported", platform: process.platform, runtimeVersion: "0.0.78", evidence: [{ check: "platform", status: "unavailable", detail: "This OS has no verified command isolation backend" }] }
  const evidence: SandboxReadiness["evidence"] = []
  const record = (check: string, ok: boolean, detail: string) => evidence.push({ check, status: ok ? "passed" : "failed", detail })
  const base = await canonical(await mkdtemp("/tmp/scispark-probe-"))
  let madeSharedTemp = false, sharedProbeSafe = false
  const sharedProbe = "/tmp/claude/scispark-probe-" + randomUUID()
  let targetConnections = 0
  const server = createServer(socket => { targetConnections++; socket.end("sentinel") })
  const unix = createServer(socket => socket.end("sentinel"))
  try {
    for (const p of ["package", "output", "temp", "research", "other-profile", "host-config", "sibling-run", "sibling-invocation"]) await mkdir(join(base,p))
    for (const p of ["research", "other-profile", "host-config", "sibling-run", "sibling-invocation"]) await writeFile(join(base,p,"sentinel"), "fixture-only")
    for (const p of ["host-config/.npm/_logs", "host-config/.claude/debug"]) await mkdir(join(base,p), { recursive: true })
    const runtimeReadRoots = ["/usr/bin", "/bin", "/usr/lib", "/lib", "/lib64", "/System/Library", "/dev/null", "/dev/urandom", "/etc/ld.so.cache", "/private/var/select", "/usr/share/perl", "/usr/share/perl5"]
    const resolved: string[] = []
    for (const root of runtimeReadRoots) { try { resolved.push(await canonical(root)) } catch { /* OS-specific system root absent */ } }
    const scope: CommandScope = { kind: "run", id: randomUUID(), profileId: "b".repeat(32), vaultId: "a".repeat(64), packageRoot: join(base,"package"), outputRoot: join(base,"output"), tempRoot: join(base,"temp"), researchRoot: join(base,"research"), runtimeReadRoots: resolved, executablePaths: { perl: await canonical("/usr/bin/perl") }, resourceIds: [], connectionIds: [] }
    const execute = async (code: string, options: { timeoutMs?: number; outputBytes?: number; argv?: string[]; control?: { armedPath: string; action: "cancel" | "disconnect" | "kill-worker" } } = {}) => {
      const invocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "perl", argv: ["-e",code, ...(options.argv ?? [])], cwd: ".", resourceIds: [], connectionIds: [], timeoutMs: options.timeoutMs ?? 5000, outputBytes: options.outputBytes ?? 10000 })
      return launch(await requestFor(scope,invocation), undefined, options.control)
    }
    const basic = await execute('print "worker-ok\\n"')
    record("actual-worker", basic.exitCode === 0 && basic.stdout.includes("worker-ok"), `worker termination=${basic.termination}; exit=${basic.exitCode}; ${basic.stderr}`)
    if (evidence[0].status !== "passed") return { status: "needs-setup", platform: process.platform, runtimeVersion: "0.0.78", evidence }
    const pq = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
    const literalArgs = ["quote'", "$(touch SHOULD_NOT_EXIST)", "line\nbreak", ""]
    const quoted = await execute(`print join("|",@ARGV)`, { argv: literalArgs })
    record("literal-argv", quoted.stdout === literalArgs.join("|"), quoted.exitCode === 0 ? "argv preserved without expansion" : "argv probe failed")
    const fsCode = `sub check { my($name,$fn)=@_; eval {$fn->()}; print $name.($@?":denied\\n":":allowed\\n") };`
    const fsResult = await execute(fsCode + ["other-profile","host-config","sibling-run"].map(p => `check('${p}',sub {open(my $f,'<',${pq(join(base,p,"sentinel"))}) or die;});`).join("") + `check('research-read',sub{open(my $f,'<',${pq(join(base,"research/sentinel"))}) or die;});check('research-write',sub{open(my $f,'>',${pq(join(base,"research/sentinel"))}) or die;});check('output-write',sub{open(my $f,'>',${pq(join(base,"output/result"))}) or die;});check('temp-write',sub{open(my $f,'>',$ENV{TMPDIR}.'/result') or die;});`)
    try { await mkdir("/tmp/claude", { mode: 0o700 }); madeSharedTemp = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
    const sharedStat = await lstat("/tmp/claude")
    if (!sharedStat.isDirectory() || sharedStat.isSymbolicLink()) throw new Error("Shared runtime temp alias; probe unavailable")
    sharedProbeSafe = true
    const writeTargets = ["other-profile", "host-config/.npm/_logs", "host-config/.claude/debug", "sibling-run", "sibling-invocation", "package"]
    const writeResult = await execute(fsCode + writeTargets.map(p => `check('${p}-write',sub{open(my $f,'>',${pq(join(base,p,"new-sentinel"))}) or die;});`).join("") + `check('shared-runtime-temp-write',sub{open(my $f,'>',${pq(sharedProbe)}) or die;});`)
    record("write-boundary", [...writeTargets.map(p => p + "-write:denied"), "shared-runtime-temp-write:denied"].every(v => writeResult.stdout.includes(v)), writeResult.stdout.trim())
    record("filesystem", ["other-profile:denied","host-config:denied","sibling-run:denied","research-read:allowed","research-write:denied","output-write:allowed","temp-write:allowed"].every(s => fsResult.stdout.includes(s)), fsResult.stdout.trim())
    const setupScope: CommandScope = { kind: "setup", id: scope.id, profileId: scope.profileId, vaultId: scope.vaultId, packageRoot: scope.packageRoot, outputRoot: scope.outputRoot, tempRoot: scope.tempRoot, runtimeReadRoots: scope.runtimeReadRoots, executablePaths: scope.executablePaths, registryDomains: ["registry.npmjs.org"] }
    const setupInvocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "perl", argv: ["-e", fsCode + `check('setup-research',sub{open(my $f,'<',${pq(join(base,"research/sentinel"))}) or die;});check('setup-write',sub{open(my $f,'>',${pq(join(base,"output/setup-result"))}) or die;});`], cwd: ".", resourceIds: [], connectionIds: [], timeoutMs: 5000 })
    const setupResult = await launch(await requestFor(setupScope,setupInvocation))
    record("setup-without-research", setupResult.stdout.includes("setup-research:denied") && setupResult.stdout.includes("setup-write:allowed"), setupResult.stdout.trim())
    await new Promise<void>((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve) })
    const socketPath = join(scope.outputRoot,"host-control.sock")
    await new Promise<void>((resolve,reject) => { unix.once("error",reject); unix.listen(socketPath,resolve) })
    const port = (server.address() as { port: number }).port
    const network = await execute(`use IO::Socket::INET;use IO::Socket::UNIX;for my $host ('127.0.0.1','169.254.169.254','10.0.0.1'){my $s=IO::Socket::INET->new(PeerAddr=>$host,PeerPort=>($host eq '127.0.0.1'?${port}:80),Timeout=>0.3);print($s?'allowed,':'denied,')}my $u=IO::Socket::UNIX->new(Peer=>${pq(socketPath)});print($u?'allowed':'denied');`)
    record("network", network.stdout.trim() === 'denied,denied,denied,denied', network.stdout.trim())
    // Real sandbox + authenticated runtime proxy; only DNS answers are fixtures.
    // HTTP and CONNECT must reach the resolved-address guard and return 403,
    // not an authentication/allowlist error. No private address is allowlisted.
    const fixtureDomains = ["rfc1918", "ula", "cgnat", "loopback"].map(name => name + ".scispark.invalid")
    const proxyCode = [
      `use IO::Socket::INET;use MIME::Base64 qw(encode_base64);`,
      `my $proxy=$ENV{HTTP_PROXY}||die 'missing proxy';$proxy=~m{^http://([^:]+):([^@]+)@([^:]+):(\\d+)$} or die 'proxy format';`,
      `my($user,$pass,$host,$port)=($1,$2,$3,$4);for($user,$pass){s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg}`,
      `my $auth=encode_base64("$user:$pass",'');$host='127.0.0.1' if $host eq 'localhost';`,
      `for my $target (@ARGV){for my $method ('GET','CONNECT'){my $s=IO::Socket::INET->new(PeerAddr=>$host,PeerPort=>$port,Timeout=>2) or die 'proxy connect';`,
      `my $url=$method eq 'GET'?"http://$target:${port}/":"$target:${port}";`,
      `print $s "$method $url HTTP/1.1\\r\\nHost: $target:${port}\\r\\nProxy-Authorization: Basic $auth\\r\\nConnection: close\\r\\n\\r\\n";`,
      `my $reply=do{local $/;<$s>};close($s);`,
      `print "$target:$method:".($reply=~/^HTTP\\/1\\.[01] 403 / && $reply=~/resolved to a (?:listed|loopback) address/?'guard-denied':'unexpected')."\\n";}}`,
    ].join("\n")
    const proxyInvocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "perl", argv: ["-e", proxyCode, ...fixtureDomains], cwd: ".", resourceIds: [], connectionIds: [], timeoutMs: 10000 })
    const proxyRequest = await requestFor({ ...setupScope, registryDomains: fixtureDomains }, proxyInvocation)
    const proxyResult = await launch({ ...proxyRequest, mode: "probe", probeDns: true })
    const expectedProxyRows = fixtureDomains.flatMap(domain => ["GET", "CONNECT"].map(method => `${domain}:${method}:guard-denied`))
    record("setup-proxy-private-resolution", proxyResult.exitCode === 0 && expectedProxyRows.every(row => proxyResult.stdout.includes(row)) && targetConnections === 0,
      `deterministic DNS fixture; target connections=${targetConnections}; ${proxyResult.stdout.trim()}; ${proxyResult.stderr}`)
    const overflow = await execute(`$|=1;print 'x'x100000;sleep 30`, { outputBytes: 128 })
    record("output-limit", overflow.termination === "output-limit" && Buffer.byteLength(overflow.stdout + overflow.stderr) <= 128, overflow.termination)
    const timeout = await execute("sleep 30", { timeoutMs: 200 })
    record("timeout", timeout.termination === "timeout", timeout.termination)
    for (const mode of ["cancel", "disconnect", "detached", "normal-exit", ...(process.platform === "linux" ? ["kill-worker"] : [])]) {
      const marker = join(scope.outputRoot, mode), armed = marker + "-armed"
      const code = `use POSIX ();my $pid=fork();if($pid==0){${(mode === "detached" || mode === "kill-worker") ? "POSIX::setsid();" : ""}close(STDOUT);close(STDERR);open(my $a,'>',${pq(armed)});print $a 'armed';close($a);select(undef,undef,undef,1.5);open(my $f,'>',${pq(marker)});print $f 'survived';exit;}${mode === "normal-exit" ? "while(!-e " + pq(armed) + "){select(undef,undef,undef,0.01)}exit;" : "sleep 30;"}`
      const result = await execute(code, mode === "normal-exit" ? {} : { control: { armedPath: armed, action: mode === "disconnect" ? "disconnect" : mode === "kill-worker" ? "kill-worker" : "cancel" } })
      await new Promise(resolve => setTimeout(resolve,1700))
      let wasArmed = false; try { wasArmed = (await readFile(armed,"utf8")) === "armed" } catch {}
      let survived = false; try { survived = (await readFile(marker,"utf8")) === "survived" } catch { /* marker denied/absent */ }
      record(mode === "detached" ? "detached-child-ownership" : mode === "cancel" ? "child-tree-cancellation" : mode === "normal-exit" ? "normal-exit-descendants" : mode === "kill-worker" ? "supervisor-death" : "parent-ipc-loss", wasArmed && !survived && (result.termination === "cancelled" || result.termination === "parent-disconnect" || (mode === "normal-exit" && result.termination === "exited") || (mode === "kill-worker" && result.termination === "worker-lost")), !wasArmed ? "descendant never armed; ownership unproven" : survived ? "descendant survived supervisor termination" : result.termination)
    }
    // A Linux PID namespace owns detached descendants even after supervisor loss.
    // Seatbelt alone does not supply this lifetime boundary on macOS.
    if (process.platform !== "linux") evidence.push({ check: "kernel-process-ownership", status: "unavailable", detail: "Pinned runtime has no proven OS lifetime container on this platform" })
    return { status: evidence.every(e => e.status === "passed") ? "ready" : "unsupported", platform: process.platform, runtimeVersion: "0.0.78", evidence }
  } catch {
    evidence.push({ check: "platform-probe", status: "unavailable", detail: "Host could not complete disposable filesystem/network/process probes" })
    return { status: "needs-setup", platform: process.platform, runtimeVersion: "0.0.78", evidence }
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    if (unix.listening) await new Promise<void>(resolve => unix.close(() => resolve()))
    if (sharedProbeSafe) await rm(sharedProbe, { force: true }).catch(() => {})
    if (madeSharedTemp) await rmdir("/tmp/claude").catch(() => {}) // Never remove another process's entries.
    await rm(base, { recursive: true, force: true })
  }
}

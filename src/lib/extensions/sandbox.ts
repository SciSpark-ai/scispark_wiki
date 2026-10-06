import { probeSandbox } from "./sandbox-probe"
export { probeSandbox } from "./sandbox-probe"
import { launch, requestFor } from "./sandbox-transport"
import { createHash } from "node:crypto"
import { mkdir, realpath } from "node:fs/promises"
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
import { CommandInvocationSchema, CommandResultSchema, type CommandInvocation, type CommandResult } from "./import-contract"
import { validateCommandScope, type CommandScope } from "./sandbox-policy"

import { connectionBrokerCapability, type ConnectionBroker } from "./network-broker"

const brokers = new WeakMap<CommandContext, ConnectionBroker>()
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
export async function createCommandContext(ctx: WorkflowContext, input: CommandScopeInput, broker?: ConnectionBroker): Promise<CommandContext> {
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
  if (broker) {
    if (input.kind !== "run") throw new Error("Setup cannot attach service connections")
    connectionBrokerCapability(ctx, id, input.connectionIds ?? [], broker)
  }
  const result = { ...ctx, commandScope }
  if (broker) brokers.set(result, broker)
  contexts.set(result, commandScope)
  return Object.freeze(result)
}

function redact(value: string, scope: CommandScope): string {
  let text = value.replace(/\/(?:Users|home|private|tmp|opt)\/[^\s'"<>]+/g, "[host path]").replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]").replace(/\b(sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|password)\s*[:=]\s*[^\s]+)/gi, "[redacted]")
  for (const root of [scope.packageRoot, scope.outputRoot, scope.tempRoot, ...(scope.kind === "run" && scope.researchRoot ? [scope.researchRoot] : [])].sort((a,b) => b.length-a.length)) text = text.replaceAll(root, "[sandbox]")
  return text
}
const SetupJournal = z.object({ id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema, attempts: z.array(z.object({ id: UuidSchema, hash: DigestSchema, seconds: z.number().positive().max(300), activeSeconds: z.number().nonnegative().max(300).optional(), state: z.enum(["dispatched", "known", "unknown"]), discardedBy: UuidSchema.optional() }).strict().refine(row => row.state !== "known" || row.activeSeconds !== undefined, "Known setup attempts require elapsed usage")).max(60) }).strict()
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
/** Host-only explicit reconciliation. The lifecycle owner discards its staging;
 * accounting retains every invocation and pessimistically charges unknown holds.
 * Repeated operation IDs do not discard a subsequently retried environment. */
export async function reconcileSetupAfterDiscard(ctx: WorkflowContext, setupId: string, operationId: string, discard: () => Promise<void>): Promise<void> {
  UuidSchema.parse(setupId); UuidSchema.parse(operationId)
  const storage = new NodeFsVaultStorage(join(ctx.runtimeRoot, "profiles", ProfileIdSchema.parse(ctx.profileId)))
  await withVaultExclusive(storage, "command-dispatch", () => withVaultExclusive(storage, "setup-command-" + setupId, async () => {
    const path = `setup-attempts/${setupId}.json`, receipt = `setup-discards/${setupId}/${operationId}.json`
    const raw = await storage.read(path)
    const journal = raw ? SetupJournal.parse(JSON.parse(raw)) : { id: setupId, profileId: ctx.profileId, vaultId: ctx.vaultId, attempts: [] }
    if (journal.id !== setupId || journal.profileId !== ctx.profileId || journal.vaultId !== ctx.vaultId) throw new Error("Setup journal owner mismatch")
    if (await storage.read(receipt)) return
    await discard()
    for (const row of journal.attempts) if (row.state !== "known") { row.state = "known"; row.activeSeconds = row.seconds; row.discardedBy = operationId }
    await storage.write(path, JSON.stringify(journal))
    await storage.write(receipt, JSON.stringify({ setupId, operationId, profileId: ctx.profileId, vaultId: ctx.vaultId }))
  }))
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
  const { workflowRetryIdentity } = await import("../workflows/journal")
  const invocation = CommandInvocationSchema.parse({ ...input, id: scope.kind === "run" ? workflowRetryIdentity(input.id) : input.id })
  const readiness = await probeSandbox()
  if (readiness.status !== "ready") throw new Error("Command isolation unavailable: " + readiness.evidence.filter(e => e.status !== "passed").map(e => e.check).join(", "))
  signal.throwIfAborted()
  const hash = createHash("sha256").update(JSON.stringify(invocation)).digest("hex")
  const run = scope.kind === "run" ? await readRun(ctx, runId) : null
  if (scope.kind === "run" && !run) throw new Error("Run missing")
  // A limit rejection leaves no directories and no dispatch. Existing directories
  // still fail closed: they may contain outputs from an uncertain earlier attempt.
  const ticket = run ? await reserveAttempt(ctx, runId, { id: invocation.id, kind: "command", replay: "reconcile", inputHash: hash }, { modelCalls: 0, commandCalls: 1, activeSeconds: invocation.timeoutMs / 1000, costUsd: run.model.engine === "api" ? 0 : null, accountingOwner: "workflow" }) : null
  // Run invocations own fresh output/temp roots; setup commands share only their staged environment. Prior invocations stay denied.
  const childScope = { ...scope, outputRoot: scope.kind === "run" ? join(scope.outputRoot, invocation.id) : scope.outputRoot, tempRoot: join(scope.tempRoot, invocation.id) }
  if (scope.kind === "run") await mkdir(childScope.outputRoot, { recursive: false, mode: 0o700 })
  await mkdir(childScope.tempRoot, { recursive: false, mode: 0o700 })
  if (invocation.connectionIds.some(id => scope.kind !== "run" || !scope.connectionIds.includes(id))) throw new Error("Unapproved connection")
  const broker = brokers.get(ctx)
  const connection = invocation.connectionIds.length && broker ? connectionBrokerCapability(ctx, scope.id, invocation.connectionIds, broker) : undefined
  const request = await requestFor(childScope, invocation, connection)
  const execute = async (reconciliationRef: string) => {
    const raw = await launch(request, signal)
    const bound = (text: string, limit: number) => new TextDecoder().decode(Buffer.from(text).subarray(0, limit), { stream: true })
    const stdout = bound(redact(raw.stdout, childScope), invocation.outputBytes)
    const stderr = bound(redact(raw.stderr, childScope), invocation.outputBytes - Buffer.byteLength(stdout))
    return CommandResultSchema.parse({ ...raw, stdout, stderr, invocationId: invocation.id, reconciliationRef,
      uncertain: raw.termination === "worker-lost" || raw.termination === "parent-disconnect" })
  }
  if (scope.kind === "setup") return withSetupCommandAccounting(ctx, invocation, hash, () => execute(`setup-attempts/${scope.id}.json#${invocation.id}`))
  if (!run || !ticket) throw new Error("Run missing")
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

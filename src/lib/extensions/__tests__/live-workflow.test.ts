// @vitest-environment node
/** Explicit, retained disposable acceptance gates. No ordinary verification makes
 * source/provider requests, prepares an environment or opens the user's vault. */
import { expect, it, vi } from "vitest"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import type { WorkflowContext } from "../../workflows/context"
import { probeSandbox } from "../sandbox"
import * as sandbox from "../sandbox"
import { stageOpenCiteCatalogEntry, openciteCatalogEntry } from "../catalog/opencite"
import { literatureReviewCatalogGraph, stageLiteratureReviewCatalogEntry } from "../catalog/literature-review"
import { inspectPackage, reviewImport, commitImport } from "../inspect"
import { ensureToolEnvironment, resolvePreparedEnvironmentRefs, resolveToolConnectionRefs } from "../setup"
import { bindToolConnection } from "../connections"
import { toolKey } from "../contracts"
import { loadSettings } from "../../llm/settings"
import { getServerS2Key } from "../../server/paper-source-settings"
import { acceptanceConfiguration, acceptanceAllowance, acceptanceLocation, acceptanceSettings, acceptanceSecrets, AcceptanceStorage, verifyRetainedRun, validateAcceptanceAudit, type Configuration } from "./live-workflow-harness"
import { startRun, observeRun, waitForWorkflowIdle } from "../../workflows/coordinator"
import { readRun, writeRun } from "../../workflows/store"
import { claimRunLease, journalStep, releaseRunLease, transitionRun } from "../../workflows/journal"
import { publishArtifact } from "../../workflows/artifacts"
import { openCiteWorkflowAdapter } from "../catalog/opencite-adapter"
import { withRunAttemptScope } from "../../workflows/attempt-scope"
import { ToolRunSchema } from "../../workflows/contracts"
import { workflowFixture } from "../../workflows/__tests__/fixtures"

const sourceGate = process.env.SCISPARK_TOOL_SOURCE_SMOKE === "1"
const providerGate = process.env.SCISPARK_TOOL_LIVE_APPROVED === "1"
const workerGate = process.env.SCISPARK_TOOL_REAL_WORKER === "1"
async function acceptanceContext(mode: Configuration["mode"], env: Record<string, string | undefined> = process.env) {
  const config = acceptanceConfiguration(env, mode)
  const secrets = acceptanceSecrets(env, config)
  if (env.SCISPARK_TOOL_REAL_WORKER !== "1") throw new Error("Separate real-worker authorization is required")
  const { ctx, marker } = await acceptanceLocation(config) // Reject mismatched retained contract before probe/setup/network.
  const retainedRuns = []
  for (const path of await ctx.storage.list(".scispark/tool-runs/")) if (path.endsWith("/run.json")) retainedRuns.push(ToolRunSchema.parse(JSON.parse((await ctx.storage.read(path))!)))
  const startRecord = await ctx.storage.read(`.scispark/tool-runs/start-operations/${marker.operationId}.json`)
  if (startRecord) retainedRuns.push(ToolRunSchema.parse(JSON.parse(startRecord).run))
  for (const retained of retainedRuns) {
    if (retained.operationId !== marker.operationId || config.mode === "source" && retained.id !== marker.sourceRunId) throw new Error("Retained acceptance root mismatch")
    verifyRetainedRun(retained, config)
    if (await readRun(ctx, retained.id)) verifyRetainedRun(await observeRun(ctx, retained.id), config)
  }
  expect(await probeSandbox()).toMatchObject({ status: "ready" })
  ctx.storage = new AcceptanceStorage(ctx.vaultPath, config.provider, secrets)
  await ctx.storage.write(".scispark/settings.json", JSON.stringify({ llm: acceptanceSettings(config) }))
  return { ctx, marker, config }
}
async function prepare(ctx: WorkflowContext, connectionId: string) {
  const graph = literatureReviewCatalogGraph()
  const preview = await inspectPackage(ctx, await stageOpenCiteCatalogEntry(ctx))
  const reviewed = await reviewImport(ctx, preview.id, [openciteCatalogEntry().proposal])
  await commitImport(ctx, reviewed.id, [graph.opencite.manifest.ref])
  const stage = await stageLiteratureReviewCatalogEntry(ctx)
  const p = await inspectPackage(ctx, stage, graph.nodes.map(n => n.proposal.skillId))
  const r = await reviewImport(ctx, p.id, graph.nodes.map(n => n.proposal))
  await commitImport(ctx, r.id, [graph.root.manifest.ref])
  expect((await ensureToolEnvironment(ctx, graph.opencite.manifest.ref, openciteCatalogEntry().proposal.setup)).state).toBe("ready")
  await bindToolConnection(ctx, toolKey(graph.opencite.manifest.ref), { id: connectionId, service: "semantic-scholar", adapter: "scispark-http-v1", credentialHandle: "settings:paperSources.s2" })
  return graph
}

it.runIf(workerGate)("requires actual supported-host isolation independently of fixture orchestration", async () => {
  expect(await probeSandbox()).toMatchObject({ status: "ready" })
}, 120000)

it.runIf(sourceGate)("checks public acquisition only, with zero model attempts and a retained root ledger", async () => {
  const { ctx, marker, config } = await acceptanceContext("source"), graph = await prepare(ctx, marker.connectionId)
  let run = await readRun(ctx, marker.sourceRunId)
  if (!run) {
    const fixture = workflowFixture()
    run = { ...fixture.run, id: marker.sourceRunId, operationId: marker.operationId, profileId: ctx.profileId, vaultId: ctx.vaultId, tool: graph.opencite.manifest.ref, dependencies: [], input: { query: "Attention Is All You Need", limit: 2, fullText: true }, model: { engine: "codex", tierModels: { fast: { provider: config.provider, model: config.model }, strong: { provider: config.provider, model: config.model } }, roleTiers: { root: "strong", helper: "fast" } }, allowance: acceptanceAllowance(config), usage: { ...fixture.run.usage, costUsd: null }, preparedEnvironmentRefs: await resolvePreparedEnvironmentRefs(ctx, [graph.opencite.manifest.ref]), connectionConfigurationRefs: await resolveToolConnectionRefs(ctx, [graph.opencite.manifest.ref]) }
    await writeRun(ctx, run)
  }
  verifyRetainedRun(run, config)
  if ((await observeRun(ctx, run.id)).status === "completed") {
    const retained = await observeRun(ctx, run.id)
    expect(retained.usage.modelCalls).toBe(0)
    expect(retained.artifacts.some(a => a.kind === "papers")).toBe(true)
    return
  }
  // Stable sourceRunId and command checkpoints; unknown prior work must reconcile.
  const lease = await claimRunLease(ctx, run.id)
  if (!lease) throw new Error("Existing acceptance owner must finish or reconcile")
  try {
    const signal = new AbortController().signal
    await withRunAttemptScope(ctx, run.id, () => openCiteWorkflowAdapter.execute(ctx, run!, {
      signal, step: (intent, work) => journalStep(ctx, run!.id, lease, intent, work), emit: async () => {}, submitWikiProposal: async () => { throw new Error("No wiki intent") }, publishArtifact: input => publishArtifact(ctx, run!.id, input, lease),
    }), signal)
    const result = await observeRun(ctx, run.id)
    expect(result.usage.modelCalls).toBe(0)
    expect(result.artifacts.some(a => a.kind === "papers")).toBe(true)
    expect(result.artifacts.some(a => a.kind === "bibtex")).toBe(true)
    await transitionRun(ctx, run.id, "completed", lease)
  } finally { await releaseRunLease(ctx, run.id, lease) }
}, 600000)

it.runIf(providerGate)("runs the imported review under one retained allowance and requires passage-by-passage human acceptance", async () => {
  const { ctx, marker, config } = await acceptanceContext("provider"), graph = await prepare(ctx, marker.connectionId)
  const run = await startRun(ctx, { operationId: marker.operationId, tool: graph.root.manifest.ref, allowance: acceptanceAllowance(config), input: { question: "Compare accuracy and computational cost of Transformers and recurrent sequence models using at most six papers in two strands. Explicitly assess whether the corpus supports a comparison of clinical performance." }, contextRefs: [], writeIntent: "outputs_only" })
  verifyRetainedRun(run, config)
  await waitForWorkflowIdle()
  const result = await observeRun(ctx, run.id)
  await ctx.storage.write("acceptance/provider-run.json", JSON.stringify(result, null, 2))
  expect(result.status, "Do not create another root: retain and resolve this run through its existing recovery actions.").toBe("completed")
  expect(result.usage.modelCalls).toBeLessThanOrEqual(config.maxCalls)
  if (config.engine === "api") { expect(result.usage.costUsd).not.toBeNull(); expect(result.usage.costUsd!).toBeLessThanOrEqual(config.maxUsd!) }
  else expect(result.usage.costUsd).toBeNull()
  // A real run cannot pass because it produced JSON or a reviewer approved it.
  // A human must enumerate every scientific claim and assess its exact passage.
  await validateAcceptanceAudit(ctx, result, JSON.parse(await readFile(join(marker.base, "claim-audit.json"), "utf8")))
  expect((await ctx.storage.list("wiki/")).length).toBe(0)
}, 600000)

const offlineEnv = (root = "/private/tmp/scispark-tool-eval-unit") => ({ SCISPARK_TOOL_LIVE_APPROVED: "1", SCISPARK_TOOL_LIVE_ENGINE: "api", SCISPARK_TOOL_LIVE_PROVIDER: "openai", SCISPARK_TOOL_LIVE_MODEL: "gpt-5.4-mini", SCISPARK_TOOL_LIVE_MAX_CALLS: "7", SCISPARK_TOOL_LIVE_MAX_USD: "0.5", SCISPARK_TOOL_EVAL_ROOT: root })
it("requires exact live gates, explicit paid selection/caps and rejects normal vault overrides before any probe", async () => {
  const probe = vi.spyOn(sandbox, "probeSandbox").mockRejectedValue(new Error("Offline test must not reach worker probe"))
  try {
    for (const key of ["SCISPARK_TOOL_LIVE_APPROVED", "SCISPARK_TOOL_LIVE_ENGINE", "SCISPARK_TOOL_LIVE_PROVIDER", "SCISPARK_TOOL_LIVE_MODEL", "SCISPARK_TOOL_LIVE_MAX_CALLS", "SCISPARK_TOOL_LIVE_MAX_USD", "SCISPARK_TOOL_EVAL_ROOT"]) {
      const env: Record<string, string | undefined> = offlineEnv(); delete env[key]
      await expect(acceptanceContext("provider", env)).rejects.toThrow()
    }
    for (const key of ["SCISPARK_VAULT", "SCISPARK_PROFILE_REGISTRY_ROOT", "SCISPARK_PROFILES_DIR", "SCISPARK_VAULT_PATH"]) await expect(acceptanceContext("provider", { ...offlineEnv(), [key]: "/human/vault" })).rejects.toThrow("reject normal")
    for (const value of ["0", "-1", "1.5", "Infinity", "99999999999999999"]) expect(() => acceptanceConfiguration({ ...offlineEnv(), SCISPARK_TOOL_LIVE_MAX_CALLS: value }, "provider")).toThrow()
    for (const value of ["0", "-1", "NaN", "Infinity"]) expect(() => acceptanceConfiguration({ ...offlineEnv(), SCISPARK_TOOL_LIVE_MAX_USD: value }, "provider")).toThrow()
    expect(() => acceptanceConfiguration({ ...offlineEnv(), SCISPARK_TOOL_LIVE_MODEL: "unpriced-model" }, "provider")).toThrow("scoped price")
    await expect(acceptanceContext("provider", { ...offlineEnv(), SCISPARK_TOOL_REAL_WORKER: "1" })).rejects.toThrow("credentials")
    expect(probe).not.toHaveBeenCalled()
  } finally { probe.mockRestore() }
})
it("separates zero-model source smoke and explicitly selected subscription allowances", () => {
  expect(acceptanceAllowance(acceptanceConfiguration({ SCISPARK_TOOL_SOURCE_SMOKE: "1", SCISPARK_TOOL_EVAL_ROOT: "/private/tmp/scispark-tool-eval-unit" }, "source"))).toMatchObject({ modelCalls: 0, costUsd: null })
  expect(() => acceptanceConfiguration(offlineEnv(), "source")).toThrow("authorization")
  const config = acceptanceConfiguration({ ...offlineEnv(), SCISPARK_TOOL_LIVE_ENGINE: "claude-code", SCISPARK_TOOL_LIVE_MODEL: "sonnet", SCISPARK_TOOL_LIVE_MAX_USD: undefined }, "provider")
  expect(config).toMatchObject({ engine: "claude-code", provider: "anthropic", model: "sonnet", maxCalls: 7, maxUsd: null })
  expect(acceptanceSettings(config).engines?.models["claude-code"]).toEqual({ fast: "sonnet", strong: "sonnet" })
})
it("retains exact evaluation root/model/caps/operation and cumulative ledger on rerun, rejecting drift", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "scispark-tool-eval-")))
  try {
    const sourceConfig = acceptanceConfiguration({ SCISPARK_TOOL_SOURCE_SMOKE: "1", SCISPARK_TOOL_EVAL_ROOT: root }, "source")
    const originalSource = await acceptanceLocation(sourceConfig)
    await originalSource.ctx.storage.write("acceptance/source-receipt.json", JSON.stringify({ runId: originalSource.marker.sourceRunId, modelCalls: 0, commandCalls: 2 }))
    const config = acceptanceConfiguration(offlineEnv(root), "provider")
    const first = await acceptanceLocation(config), fixture = workflowFixture()
    const selected = { provider: config.provider, model: config.model }
    const run = { ...fixture.run, profileId: first.ctx.profileId, vaultId: first.ctx.vaultId, operationId: first.marker.operationId, model: { ...fixture.run.model, engine: config.engine, tierModels: { fast: selected, strong: selected } }, allowance: acceptanceAllowance(config) }
    await writeRun(first.ctx, run)
    const { reserveAttempt, settleAttempt } = await import("../../workflows/usage")
    const intent = { id: "11111111-1111-4111-8111-111111111111", kind: "model" as const, replay: "reconcile" as const, inputHash: "a".repeat(64) }
    const estimate = { modelCalls: 1, commandCalls: 0, activeSeconds: 1, costUsd: 0.1, accountingOwner: "workflow" as const }
    const ticket = await reserveAttempt(first.ctx, run.id, intent, estimate)
    await settleAttempt(first.ctx, ticket, { modelCalls: 1, commandCalls: 0, activeSeconds: 1, costUsd: 0.1, outcome: "known" })
    const repeated = await acceptanceLocation(config)
    expect(repeated.marker).toEqual(first.marker)
    const retained = await observeRun(repeated.ctx, run.id)
    verifyRetainedRun(retained, config)
    expect(retained.usage).toMatchObject({ modelCalls: 1, costUsd: 0.1 })
    expect(await reserveAttempt(repeated.ctx, run.id, intent, estimate)).toEqual(ticket)
    for (const altered of [{ ...config, maxCalls: 8 }, { ...config, maxUsd: 1 }, { ...config, model: "gpt-5.6-sol" }]) await expect(acceptanceLocation(altered)).rejects.toThrow("configuration mismatch")
    const probe = vi.spyOn(sandbox, "probeSandbox").mockRejectedValue(new Error("Offline test must not reach worker probe"))
    try {
      await expect(acceptanceContext("provider", { ...offlineEnv(root), SCISPARK_TOOL_LIVE_MAX_CALLS: "8", SCISPARK_TOOL_REAL_WORKER: "1", SCISPARK_TOOL_SOURCE_KEY: "offline-source-sentinel", SCISPARK_TOOL_LIVE_API_KEY: "offline-api-sentinel" })).rejects.toThrow("configuration mismatch")
      expect(probe).not.toHaveBeenCalled()
    } finally { probe.mockRestore() }
    expect(() => verifyRetainedRun({ ...retained, allowance: { ...retained.allowance, modelCalls: 8 } }, config)).toThrow("mismatch")
    const source = acceptanceConfiguration({ SCISPARK_TOOL_SOURCE_SMOKE: "1", SCISPARK_TOOL_EVAL_ROOT: root }, "source")
    const sourceLocation = await acceptanceLocation(source)
    expect(sourceLocation.marker).toEqual(originalSource.marker)
    expect(JSON.parse((await sourceLocation.ctx.storage.read("acceptance/source-receipt.json"))!)).toEqual({ runId: originalSource.marker.sourceRunId, modelCalls: 0, commandCalls: 2 })
    const sourceRun = { ...run, id: sourceLocation.marker.sourceRunId, profileId: sourceLocation.ctx.profileId, vaultId: sourceLocation.ctx.vaultId, model: { ...run.model, engine: "codex" as const }, allowance: acceptanceAllowance(source), usage: { ...run.usage, costUsd: null } }
    await writeRun(sourceLocation.ctx, sourceRun)
    await expect(reserveAttempt(sourceLocation.ctx, sourceRun.id, intent, { ...estimate, costUsd: null })).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it("binds sentinel credentials only in memory and refuses secret config/artifact/log/binary writes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "scispark-tool-eval-")))
  try {
    const config = acceptanceConfiguration(offlineEnv(root), "provider"), { ctx } = await acceptanceLocation(config)
    const secrets = { source: "sentinel-source-key-do-not-persist", api: "sentinel-provider-key-do-not-persist" }
    const storage = new AcceptanceStorage(ctx.vaultPath, config.provider, secrets), disk = new NodeFsVaultStorage(ctx.vaultPath)
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: acceptanceSettings(config) }))
    expect((await loadSettings(storage)).keys.openai).toBe(secrets.api)
    expect(await getServerS2Key(storage)).toBe(secrets.source)
    for (const path of [".scispark/settings.json", "artifact.md", "test.log"]) for (const secret of Object.values(secrets)) await expect(storage.write(path, secret)).rejects.toThrow("secret persistence refused")
    await expect(storage.writeBinary("artifact.bin", Buffer.from(secrets.api))).rejects.toThrow("secret persistence refused")
    for (const path of await disk.list("")) {
      const bytes = await disk.read(path)
      for (const secret of Object.values(secrets)) expect(bytes).not.toContain(secret)
    }
    expect((await disk.read(".scispark/settings.json"))!).toContain('"keys":{}')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it("rejects non-disposable paths, unmarked nonempty roots and malformed retained markers", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "scispark-tool-eval-")))
  try {
    await expect(acceptanceLocation(acceptanceConfiguration(offlineEnv("/human/vault"), "provider"))).rejects.toThrow("temporary child")
    const disk = new NodeFsVaultStorage(root)
    await disk.write("unrelated.md", "Preserve")
    await expect(acceptanceLocation(acceptanceConfiguration(offlineEnv(root), "provider"))).rejects.toThrow("must be empty")
    expect(await disk.read("unrelated.md")).toBe("Preserve")
    await disk.delete("unrelated.md")
    const location = await acceptanceLocation(acceptanceConfiguration(offlineEnv(root), "provider"))
    await new NodeFsVaultStorage(location.marker.base).write("acceptance-marker.json", "{}")
    await expect(acceptanceLocation(acceptanceConfiguration(offlineEnv(root), "provider"))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it("rejects retained audits after report or source bytes change, without provider work", async () => {
  const { ctx, run } = workflowFixture()
  await writeRun(ctx, run)
  const reportText = "Audited result. Clinical performance remains unsupported."
  const sourceText = "Exact observed source passage."
  const report = await publishArtifact(ctx, run.id, { kind: "markdown", title: "Review", mediaType: "text/markdown", sourceRefs: [], bytes: Buffer.from(reportText) })
  const source = await publishArtifact(ctx, run.id, { kind: "markdown", title: "Source", mediaType: "text/markdown", sourceRefs: ["fixture-source"], bytes: Buffer.from(sourceText) })
  const published = (await readRun(ctx, run.id))!
  const audit = { runId: run.id, reviewedBy: "Offline fixture", method: "human-passage-review", everyClaimSampled: true, reportArtifactId: report.id, reportSha256: report.sha256, claims: [{ claim: "Audited result.", sourceArtifactId: source.id, passage: sourceText, supported: true }], comparisonCoverage: { accuracy: "supported", "computational cost": "partial", "clinical performance": "unsupported" } }
  await expect(validateAcceptanceAudit(ctx, published, audit)).resolves.toBeUndefined()
  await ctx.storage.writeBinary(report.path, Buffer.from(reportText + " Additional unaudited claim."))
  await expect(validateAcceptanceAudit(ctx, published, audit)).rejects.toThrow("hash mismatch")
  await ctx.storage.writeBinary(report.path, Buffer.from(reportText))
  await ctx.storage.writeBinary(source.path, Buffer.from(sourceText + " Changed evidence."))
  await expect(validateAcceptanceAudit(ctx, published, audit)).rejects.toThrow("hash mismatch")
  expect((await readRun(ctx, run.id))!.usage.modelCalls).toBe(0)
})

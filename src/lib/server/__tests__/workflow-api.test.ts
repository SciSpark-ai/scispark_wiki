import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { randomUUID, createHash } from "node:crypto"
import { mkdtemp, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ChangesetRecoveryConflictError } from "../../vault/changesets"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import * as toolsRoute from "@/app/api/tools/route"
import * as runsRoute from "@/app/api/tools/runs/route"
import * as runRoute from "@/app/api/tools/runs/[id]/route"
import * as eventsRoute from "@/app/api/tools/runs/[id]/events/route"
import * as actionsRoute from "@/app/api/tools/runs/[id]/actions/route"
import * as profiles from "../local-profiles"
import * as contexts from "../../workflows/context"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../../local-profile-contract"
import { workflowFixture } from "../../workflows/__tests__/fixtures"
import { registerToolManifest } from "../../extensions/registry"
import { writeProfileTools } from "../../extensions/store"
import { registerWorkflowAdapter } from "../../workflows/adapters"
import { recoverWorkflowRuns, waitForWorkflowIdle } from "../../workflows/coordinator"
import { readRun, writeRun, appendEvent, listRunEvents } from "../../workflows/store"
import { extendAllowance } from "../../workflows/usage"
import { acknowledgeRunCancellation, claimRunLease, releaseRunLease, readWorkflowJournal } from "../../workflows/journal"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { startToolRemote, watchToolRunRemote } from "../../workflows/client"

let f: ReturnType<typeof workflowFixture>, unregister: () => void, release: () => void
function request(path: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost:3000/api/tools${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { host: "localhost:3000", cookie: `${PROFILE_COOKIE}=fixture`, [PROFILE_HEADER]: f.ctx.profileId, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
async function started() { const res = await runsRoute.POST(request("/runs", f.request)); expect(res.status).toBe(202); return (await res.json()).result }
async function until(check: () => Promise<boolean>) { await vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 4000, interval: 10 }) }
beforeEach(async () => {
  f = workflowFixture(); f.tool.ref.packageId = `fixture/${randomUUID()}`; f.tool.entrypoint = randomUUID(); f.request.tool = f.tool.ref; f.run.tool = f.tool.ref
  unregister = registerToolManifest(f.tool); release = () => {}
  vi.spyOn(profiles, "getProfileSession").mockResolvedValue({ id: f.ctx.profileId, name: "Fixture", vaultPath: f.ctx.vaultPath })
  vi.spyOn(contexts, "resolveWorkflowContext").mockImplementation(async profile => { if (profile.id !== f.ctx.profileId) throw new Error("owner"); return f.ctx })
  await writeProfileTools(f.ctx, { schemaVersion: 1, enabled: [{ tool: f.tool.ref, enabled: true }], pins: [f.tool.ref], overrides: [], migrated: true })
  await saveSettings(f.ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "private-fixture-key" } })
  registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => { await io.emit({ type: "text", text: "Finished" }) } })
})
afterEach(async () => { release(); await waitForWorkflowIdle(); unregister(); vi.restoreAllMocks() })

describe("authenticated workflow HTTP APIs", () => {
  it("rejects stale profiles, expired sessions and foreign mutations", async () => {
    expect((await runsRoute.GET(request("/runs", undefined, { [PROFILE_HEADER]: "stale" }))).status).toBe(409)
    expect((await runsRoute.POST(request("/runs", f.request, { origin: "https://foreign.test" }))).status).toBe(403)
    vi.mocked(profiles.getProfileSession).mockResolvedValue(null)
    const res = await toolsRoute.GET(request("")); expect(res.status).toBe(401); expect(res.headers.get("x-scispark-session-expired")).toBe("1")
  })
  it("uses real disposable sessions and expires them without bootstrapping missing workflow state", async () => {
    vi.restoreAllMocks()
    const root = await mkdtemp(join(tmpdir(), "workflow-http-session-"))
    vi.stubEnv("SCISPARK_VAULT", join(root, "vault")); vi.stubEnv("SCISPARK_PROFILES_DIR", join(root, "registry"))
    try {
      const [profile] = await profiles.listLocalProfiles(), session = await profiles.createProfileSession(profile.id)
      const headers = { cookie: `${PROFILE_COOKIE}=${session.token}`, [PROFILE_HEADER]: profile.id }
      expect((await runsRoute.GET(request("/runs", undefined, headers))).status).toBe(200)
      expect((await runsRoute.GET(request("/runs", undefined, { ...headers, [PROFILE_HEADER]: "stale" }))).status).toBe(409)
      const runtime = join(root, "registry", "extensions")
      await rm(runtime, { recursive: true })
      expect((await runsRoute.GET(request("/runs", undefined, headers))).status).toBe(409)
      await expect(access(runtime)).rejects.toThrow()
      const storage = new NodeFsVaultStorage(join(root, "registry")), tokenHash = createHash("sha256").update(session.token).digest("hex")
      await storage.write(`sessions/${tokenHash}.json`, JSON.stringify({ profileId: profile.id, expires: 0 }))
      expect((await runsRoute.GET(request("/runs", undefined, headers))).status).toBe(401)
    } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
  })

  it("bounds bytes and strictly validates IDs, cursor and action bodies", async () => {
    expect((await runsRoute.POST(request("/runs", { ...f.request, input: { big: "é".repeat(33000) } }))).status).toBe(413)
    expect((await runsRoute.POST(request("/runs", { ...f.request, vaultPath: "/foreign" }))).status).toBe(400)
    expect((await runRoute.GET(request("/runs/bad"), params("bad"))).status).toBe(400)
    expect((await eventsRoute.GET(request(`/runs/${f.run.id}/events?after=-1`), params(f.run.id))).status).toBe(400)
    await writeRun(f.ctx, f.run)
    expect((await actionsRoute.POST(request("/actions", { operationId: randomUUID(), action: "cancel", delta: { modelCalls: 1 } }), params(f.run.id))).status).toBe(400)
    expect((await actionsRoute.POST(request("/actions", { operationId: randomUUID(), action: "extend", delta: { costUsd: null } }), params(f.run.id))).status).toBe(400)
    expect((await runRoute.GET(request("/runs/missing"), params(randomUUID()))).status).toBe(404)
  })
  it("starts durably once, conflicts on changed operation payload, and redacts DTOs", async () => {
    const a = await started(), b = await started(); expect(a.id).toBe(b.id)
    expect((await f.ctx.storage.list(".scispark/tool-runs/")).filter(p => p.endsWith("/run.json"))).toHaveLength(1)
    expect((await runsRoute.POST(request("/runs", { ...f.request, input: { topic: "changed" } }))).status).toBe(409)
    await waitForWorkflowIdle()
    const res = await runRoute.GET(request(`/runs/${a.id}`), params(a.id)); const dto = (await res.json()).result
    expect(dto.status).toBe("completed"); expect(res.headers.get("cache-control")).toBe("no-store")
    for (const key of ["lease", "journal", "vaultId", "model", "preparedEnvironmentRefs", "connectionConfigurationRefs", "input"]) expect(dto).not.toHaveProperty(key)
    expect(JSON.stringify(dto)).not.toContain("private-fixture-key")
    expect((await (await runsRoute.GET(request("/runs"))).json()).result).toHaveLength(1)
    const tools = (await (await toolsRoute.GET(request(""))).json()).result; expect(tools.some((t: { ref: unknown }) => JSON.stringify(t.ref) === JSON.stringify(f.tool.ref))).toBe(true)
  })
  it("does not expose globally registered tools owned by another profile", async () => {
    const foreign = { ...f.tool, ref: { ...f.tool.ref, packageId: `foreign/${randomUUID()}` }, name: "Foreign private tool" }
    const remove = registerToolManifest(foreign)
    try {
      const tools = (await (await toolsRoute.GET(request(""))).json()).result
      expect(tools.filter((t: { kind: string }) => t.kind === "native").length).toBeGreaterThanOrEqual(1); expect(JSON.stringify(tools)).not.toContain("Foreign private tool")
      expect((await runsRoute.POST(request("/runs", { ...f.request, operationId: randomUUID(), tool: foreign.ref }))).status).toBe(409)
    } finally { remove() }
  })

  it("lists a profile's disabled installed choices without permitting execution", async () => {
    await writeProfileTools(f.ctx, { schemaVersion: 1, enabled: [{ tool: f.tool.ref, enabled: false }], pins: [f.tool.ref], overrides: [], migrated: true })
    const tools = (await (await toolsRoute.GET(request(""))).json()).result
    expect(tools.find((t: { ref: { packageId: string } }) => t.ref.packageId === f.tool.ref.packageId)).toMatchObject({ enabled: false })
    expect((await runsRoute.POST(request("/runs", f.request))).status).toBe(409)
  })

  it("rejects disabled and missing pinned tools", async () => {
    await writeProfileTools(f.ctx, { schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true })
    expect((await runsRoute.POST(request("/runs", f.request))).status).toBe(409)
    unregister(); unregister = () => {}
    await writeProfileTools(f.ctx, { schemaVersion: 1, enabled: [{ tool: f.tool.ref, enabled: true }], pins: [], overrides: [], migrated: true })
    expect((await runsRoute.POST(request("/runs", f.request))).status).toBe(409)
  })
  it("projects authoritative state and committed events without repairing or writing", async () => {
    await writeRun(f.ctx, f.run); const journal = await readWorkflowJournal(f.ctx, f.run.id)
    await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/journal.json`, JSON.stringify({ ...journal, status: "cancelled" }))
    await appendEvent(f.ctx, f.run.id, { type: "text", text: "Saved" })
    const write = vi.spyOn(f.ctx.storage, "write")
    const dto = (await (await runRoute.GET(request("/snapshot"), params(f.run.id))).json()).result
    expect(dto.status).toBe("cancelled")
    const events = await eventsRoute.GET(request("/events?after=1"), params(f.run.id)); const replay = (await events.text()).trim().split("\n").map(s => JSON.parse(s))
    expect(replay).toMatchObject([{ type: "text", text: "Saved", seq: 2 }]); expect(write).not.toHaveBeenCalled()
    expect((await readRun(f.ctx, f.run.id))?.status).toBe("queued")
  })
  it("projects a committed usage journal after a failed mirror write without repair", async () => {
    await writeRun(f.ctx, { ...f.run, status: "paused_limit" })
    const original = f.ctx.storage.write.bind(f.ctx.storage)
    const failure = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => { if (path.endsWith("/run.json")) throw new Error("mirror failed"); await original(path, text) })
    await expect(extendAllowance(f.ctx, f.run.id, randomUUID(), { modelCalls: 7 })).rejects.toThrow("mirror failed")
    failure.mockRestore()
    const write = vi.spyOn(f.ctx.storage, "write")
    const dto = (await (await runRoute.GET(request("/snapshot"), params(f.run.id))).json()).result
    expect(dto.allowance.modelCalls).toBe(37); expect(write).not.toHaveBeenCalled()
    expect((await readRun(f.ctx, f.run.id))?.allowance.modelCalls).toBe(30)
  })

  it("disconnects only observation and replays from a cursor while work continues", async () => {
    let running = false
    const blocked = new Promise<void>(resolve => { release = resolve })
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => { running = true; await io.emit({ type: "text", text: "Working" }); await blocked; await io.emit({ type: "text", text: "Done" }); running = false } })
    const run = await started(); await until(async () => running)
    const response = await eventsRoute.GET(request("/events?after=0"), params(run.id)); await response.body?.cancel(); expect(running).toBe(true)
    release(); await waitForWorkflowIdle()
    const replay = await eventsRoute.GET(request("/events?after=1"), params(run.id)); const events = (await replay.text()).trim().split("\n").map(s => JSON.parse(s))
    expect(events.every(e => e.seq > 1)).toBe(true); expect(events.some(e => e.type === "text" && e.text === "Done")).toBe(true)
  })
  it("coalesces durable text writes with terminal text before terminal status", async () => {
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => { for (let i = 0; i < 30; i++) await io.emit({ type: "text", text: `Snapshot ${i}` }) } })
    const times: number[] = [], write = f.ctx.storage.write.bind(f.ctx.storage)
    vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => { if (path.includes("/events/") && JSON.parse(text).type === "text") times.push(Date.now()); await write(path, text) })
    const run = await started(); await waitForWorkflowIdle(); const events = await listRunEvents(f.ctx, run.id, 0)
    expect(times.length).toBeLessThanOrEqual(2); for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(250)
    expect(events.at(-2)).toMatchObject({ type: "text", text: "Snapshot 29" }); expect(events.at(-1)).toMatchObject({ type: "status", status: "completed" })
  })
  it("preserves durable text spacing across immediate resumptions", async () => {
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => {
      await io.emit({ type: "text", text: "Waiting" }); await io.emit({ type: "status", status: "waiting_for_setup" })
    } })
    const times: number[] = [], write = f.ctx.storage.write.bind(f.ctx.storage)
    vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => { if (path.includes("/events/") && JSON.parse(text).type === "text") times.push(Date.now()); await write(path, text) })
    const run = await started(); await waitForWorkflowIdle()
    for (let i = 0; i < 2; i++) {
      expect((await actionsRoute.POST(request("/actions", { operationId: randomUUID(), action: "resume" }), params(run.id))).status).toBe(200)
      await waitForWorkflowIdle()
    }
    expect(times).toHaveLength(3); for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(250)
  })

  it("flushes pending text before a cancelled terminal event", async () => {
    let emitted = false
    const blocked = new Promise<void>(resolve => { release = resolve })
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => {
      await io.emit({ type: "text", text: "First" }); await io.emit({ type: "text", text: "Pending" }); emitted = true
      await blocked
    } })
    const run = await started(); await until(async () => emitted)
    expect((await actionsRoute.POST(request("/actions", { operationId: randomUUID(), action: "cancel" }), params(run.id))).status).toBe(200)
    release(); await waitForWorkflowIdle()
    const events = await listRunEvents(f.ctx, run.id, 0)
    const text = events.findIndex(e => e.type === "text" && e.text === "Pending"), cancelled = events.findIndex(e => e.type === "status" && e.status === "cancelled")
    expect(text).toBeGreaterThan(0); expect(cancelled).toBeGreaterThan(text)
  })

  it("applies idempotent actions and rejects reusing action IDs with changed payload", async () => {
    await writeRun(f.ctx, { ...f.run, status: "paused_limit" })
    const operationId = randomUUID(), delta = { modelCalls: 5 }
    for (let i = 0; i < 2; i++) expect((await actionsRoute.POST(request("/actions", { operationId, action: "extend", delta }), params(f.run.id))).status).toBe(200)
    expect((await readRun(f.ctx, f.run.id))?.allowance.modelCalls).toBe(35)
    expect((await actionsRoute.POST(request("/actions", { operationId, action: "extend", delta: { modelCalls: 6 } }), params(f.run.id))).status).toBe(409)
    expect((await actionsRoute.POST(request("/actions", { operationId, action: "cancel" }), params(f.run.id))).status).toBe(409)
    expect((await actionsRoute.POST(request("/actions", { operationId: randomUUID(), action: "cancel" }), params(f.run.id))).status).toBe(200)
  })
  it("projects only a safe pending-cancellation boolean until owner acknowledgement", async () => {
    await writeRun(f.ctx, { ...f.run, status: "running" })
    const lease = (await claimRunLease(f.ctx, f.run.id))!, operationId = randomUUID()
    const result = (await (await actionsRoute.POST(request("/actions", { operationId, action: "cancel" }), params(f.run.id))).json()).result
    expect(result).toMatchObject({ status: "running", cancelRequested: true })
    expect(JSON.stringify(result)).not.toContain(lease.id); expect(JSON.stringify(result)).not.toContain(operationId)
    const write = vi.spyOn(f.ctx.storage, "write")
    expect((await (await runRoute.GET(request("/snapshot"), params(f.run.id))).json()).result.cancelRequested).toBe(true)
    expect(write).not.toHaveBeenCalled(); write.mockRestore()
    await acknowledgeRunCancellation(f.ctx, f.run.id, lease)
    const repeated = (await (await actionsRoute.POST(request("/actions", { operationId: randomUUID(), action: "cancel" }), params(f.run.id))).json()).result
    expect(repeated).toMatchObject({ status: "cancelled", cancelRequested: false })
    await releaseRunLease(f.ctx, f.run.id, lease); await recoverWorkflowRuns([f.ctx]); await waitForWorkflowIdle()
    expect((await (await runRoute.GET(request("/snapshot"), params(f.run.id))).json()).result).toMatchObject({ status: "cancelled", cancelRequested: false })
  })

  it("resumes via an idempotent HTTP action while preserving cumulative usage", async () => {
    await writeRun(f.ctx, { ...f.run, status: "paused_limit", usage: { ...f.run.usage, modelCalls: 2 } })
    const execute = vi.fn<import("../../workflows/adapters").WorkflowAdapter["execute"]>(async (_ctx, _run, io) => { await io.emit({ type: "text", text: "Resumed" }) })
    registerWorkflowAdapter(f.tool.entrypoint, { execute })
    const operationId = randomUUID()
    expect((await actionsRoute.POST(request("/actions", { operationId, action: "resume" }), params(f.run.id))).status).toBe(200)
    await waitForWorkflowIdle()
    expect((await actionsRoute.POST(request("/actions", { operationId, action: "resume" }), params(f.run.id))).status).toBe(200)
    await waitForWorkflowIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    expect((await readRun(f.ctx, f.run.id))?.usage.modelCalls).toBe(2)
  })

  it("rejects conflicting cancellation without aborting the active adapter", async () => {
    let signal: AbortSignal | undefined
    const blocked = new Promise<void>(resolve => { release = resolve })
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => { signal = io.signal; await io.emit({ type: "text", text: "Working" }); await blocked; await io.emit({ type: "text", text: "Finished" }) } })
    const run = await started(); await until(async () => signal !== undefined)
    const operationId = randomUUID()
    expect((await actionsRoute.POST(request("/actions", { operationId, action: "extend", delta: { modelCalls: 1 } }), params(run.id))).status).toBe(200)
    expect((await actionsRoute.POST(request("/actions", { operationId, action: "cancel" }), params(run.id))).status).toBe(409)
    expect(signal?.aborted).toBe(false)
    release(); await waitForWorkflowIdle()
    expect((await readRun(f.ctx, run.id))?.status).toBe("completed")
  })

  it.each(["fetch", "stream", "partial-eof"] as const)("reconnects after %s interruption without duplicate delivery or actions", async kind => {
    const events = [{ runId: f.run.id, seq: 1, type: "text", text: "Saved" }, { runId: f.run.id, seq: 2, type: "status", status: "completed" }]
    const snapshot = { ...f.run, status: "completed", eventCursor: 2 }
    const { ToolRunDtoSchema } = await import("../../workflows/contracts")
    let batches = 0
    const urls: string[] = []
    const transport: typeof fetch = vi.fn(async url => {
      urls.push(String(url))
      if (!String(url).includes("/events")) return Response.json({ result: ToolRunDtoSchema.strip().parse(snapshot) })
      batches++
      if (batches === 1 && kind === "fetch") throw new TypeError("network interrupted")
      if (batches === 1) {
        const partial = JSON.stringify(events[0]) + "\n" + JSON.stringify(events[1]).slice(0, 20)
        if (kind === "partial-eof") return new Response(partial)
        let sent = false
        return new Response(new ReadableStream({ pull(controller) {
          if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(partial)) }
          else return new Promise<void>(resolve => setTimeout(() => { controller.error(new TypeError("socket lost")); resolve() }, 0))
        } }))
      }
      const after = Number(new URL(String(url), "http://localhost").searchParams.get("after"))
      return new Response(events.filter(e => e.seq > after).map(e => JSON.stringify(e) + "\n").join(""))
    })
    const seen: number[] = []
    await watchToolRunRemote(f.run.id, e => { seen.push(e.seq) }, new AbortController().signal, 0, transport)
    expect(seen).toEqual([1, 2]); expect(batches).toBe(2)
    expect(urls.filter(url => url.includes("/events"))[1]).toContain(`after=${kind === "fetch" ? 0 : 1}`)
    expect(urls.every(url => !url.includes("actions"))).toBe(true)
  })

  it("fails closed on authentication, event owner and schema errors and aborts retry waiting", async () => {
    for (const response of [Response.json({ error: "expired" }, { status: 401 }), new Response(JSON.stringify({ runId: randomUUID(), seq: 1, type: "text", text: "Foreign" }) + "\n"), new Response(JSON.stringify({ runId: f.run.id, seq: 1, type: "text", text: 42 }) + "\n")]) {
      const transport: typeof fetch = vi.fn(async () => response)
      await expect(watchToolRunRemote(f.run.id, () => {}, new AbortController().signal, 0, transport)).rejects.toThrow()
      expect(transport).toHaveBeenCalledTimes(1)
    }
    const abort = new AbortController(), transport: typeof fetch = vi.fn(async () => { throw new TypeError("offline") })
    const observing = watchToolRunRemote(f.run.id, () => {}, abort.signal, 0, transport)
    await until(async () => vi.mocked(transport).mock.calls.length === 1)
    abort.abort(); await observing
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it("client validates schema and aborts observation without a cancellation request", async () => {
    const transport: typeof fetch = vi.fn(async (url, init) => {
      const req = request(String(url).replace("/api/tools", ""), init?.body ? JSON.parse(String(init.body)) : undefined)
      const id = String(url).match(/runs\/([^/]+)/)?.[1]
      if (String(url).endsWith("/runs")) return runsRoute.POST(req)
      if (String(url).includes("/events")) return eventsRoute.GET(req, params(id!))
      return runRoute.GET(req, params(id!))
    })
    const run = await startToolRemote(f.request, transport); await waitForWorkflowIdle()
    const abort = new AbortController(), seen: number[] = []
    await watchToolRunRemote(run.id, e => { seen.push(e.seq); abort.abort() }, abort.signal, 0, transport)
    expect(seen).toHaveLength(1); expect(vi.mocked(transport).mock.calls.every(([url]) => !String(url).includes("actions"))).toBe(true)
    const resumed: number[] = [], cursors: string[] = []; let disconnect = true
    const reconnectTransport: typeof fetch = async (url, init) => {
      const response = await transport(url, init)
      if (String(url).includes("/events")) {
        cursors.push(String(url))
        if (disconnect) { disconnect = false; return new Response((await response.text()).split("\n")[0] + "\n", { headers: response.headers }) }
      }
      return response
    }
    await watchToolRunRemote(run.id, e => { resumed.push(e.seq) }, new AbortController().signal, 0, reconnectTransport)
    expect(cursors).toHaveLength(2); expect(cursors[1]).toContain(`after=${resumed[0]}`)
    expect(new Set(resumed).size).toBe(resumed.length)
    expect(resumed.at(-1)).toBe((await readRun(f.ctx, run.id))?.eventCursor)
  })
})


it("returns actionable recovery conflicts without discarding the owning run or affected paths", async () => {
  const changesetId = randomUUID()
  vi.mocked(contexts.resolveWorkflowContext).mockRejectedValue(new ChangesetRecoveryConflictError(f.run.id, changesetId, ["wiki/notes/edited.md"]))
  const response = await runsRoute.GET(request("/runs"))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: "changeset_recovery_conflict", runId: f.run.id, changesetId, conflicts: ["wiki/notes/edited.md"] })
})

it("selects exactly one saved top-level choice through authenticated HTTP and replays its winner", async () => {
  const { saveToolChoice } = await import("../../extensions/choice-store"), choices = await import("@/app/api/tools/choices/[id]/route")
  const second = { ...f.tool, ref: { ...f.tool.ref, skillId: "alternative" }, name: "Alternative" }, remove = registerToolManifest(second)
  try {
    await writeProfileTools(f.ctx, { schemaVersion:1, enabled:[f.tool,second].map(t => ({tool:t.ref,enabled:true})), pins:[], overrides:[], migrated:true })
    const id = randomUUID(), input = { question:"Review hearing research", sessionId:"chat_choice", operationId:randomUUID(), contextRefs:[] }
    await saveToolChoice(f.ctx,{id,prompt:"Choose one",candidates:[f.tool,second].map(t => ({tool:t.ref,name:t.name,source:t.ref.packageId,distinction:t.description}))},input)
    const selections = [f.tool,second].map(t => ({tool:t.ref,operationId:randomUUID()}))
    expect((await choices.POST(request(`/choices/${id}`, { ...selections[0], tools:[f.tool.ref,second.ref] }),params(id))).status).toBe(400)
    const responses = await Promise.all(selections.map(selection => choices.POST(request(`/choices/${id}`,selection),params(id))))
    expect(responses.map(r => r.status).sort()).toEqual([200,409])
    const winner = responses.findIndex(r => r.status === 200), run = (await responses[winner].json()).result
    const replay = await choices.POST(request(`/choices/${id}`,selections[winner]),params(id))
    expect(replay.status).toBe(200); expect((await replay.json()).result.id).toBe(run.id)
    expect((await f.ctx.storage.list(".scispark/tool-runs/")).filter(p => p.endsWith("/run.json"))).toHaveLength(1)
    expect((await choices.POST(request(`/choices/${id}`,selections[winner],{origin:"https://foreign.test"}),params(id))).status).toBe(403)
  } finally { await waitForWorkflowIdle(); remove() }
})

it("projects saved text, exact recovery metadata and typed stop without private checkpoints", async () => {
  const { journalStep, transitionRun } = await import("../../workflows/journal")
  const { reserveAttempt, claimAttemptDispatch } = await import("../../workflows/usage")
  await writeRun(f.ctx, f.run)
  const lease = (await claimRunLease(f.ctx, f.run.id))!, step = { id: randomUUID(), kind: "model" as const, replay: "reconcile" as const, inputHash: "e".repeat(64) }
  await expect(journalStep(f.ctx, f.run.id, lease, step, async () => {
    const ticket = await reserveAttempt(f.ctx, f.run.id, step, { modelCalls: 1, commandCalls: 0, activeSeconds: 5, costUsd: .1, accountingOwner: "workflow" })
    await claimAttemptDispatch(f.ctx, ticket); throw new Error("lost response")
  })).rejects.toThrow()
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  await appendEvent(f.ctx, f.run.id, { type: "text", text: JSON.stringify({ type: "text", text: "Public answer" }) })
  await appendEvent(f.ctx, f.run.id, { type: "text", text: JSON.stringify({ type: "progress", stage: "ranking" }) })
  const res = await runRoute.GET(request(`/runs/${f.run.id}`), params(f.run.id)), data = (await res.json()).result
  expect(data.observation.text).toBe("Public answer")
  expect(data.observation.phase).toBe("Ranking papers")
  expect(data.observation.usage.heldAttempts).toBe(1)
  expect(data.observation.uncertainSteps).toEqual([{ id: step.id, kind: "model", retryable: true }])
  expect(JSON.stringify(data)).not.toContain(step.inputHash)
  const action = { action: "resolve-uncertain", operationId: randomUUID(), stepId: step.id, resolution: "stop" }
  const stopped = await actionsRoute.POST(request("/actions", action), params(f.run.id)); expect(stopped.status).toBe(200)
  expect((await stopped.json()).result.status).toBe("cancelled")
  expect((await actionsRoute.POST(request("/actions", action), params(f.run.id))).status).toBe(200)
  expect((await actionsRoute.POST(request("/actions", { ...action, resolution: "retry" }), params(f.run.id))).status).toBe(409)
})
it("labels supporting choices with retained manifest names and preserves unavailable-history fallback", async () => {
  await writeRun(f.ctx, { ...f.run, status: "waiting_for_choice" })
  const missing = { ...f.tool.ref, skillId: "unavailable-helper" }, choiceId = randomUUID()
  await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/host-continuation.json`, JSON.stringify({ schemaVersion: 1, runId: f.run.id, completed: false, frames: [{ id: f.run.id, tool: f.run.tool, input: {}, turn: 0, observations: [], publicText: "" }], choices: [], waitingChoice: { id: choiceId, parentFrameId: f.run.id, slotId: "helpers", candidates: [f.tool.ref, missing] } }))
  const response = await runRoute.GET(request(`/runs/${f.run.id}`), params(f.run.id)), data = (await response.json()).result
  expect(data.observation.choice.candidates.map((candidate: { label: string }) => candidate.label)).toEqual(["Review", "unavailable-helper"])
})

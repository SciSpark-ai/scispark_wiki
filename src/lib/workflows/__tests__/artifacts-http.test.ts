import { afterEach, expect, it, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { once } from "node:events"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NextRequest } from "next/server"
import * as runsRoute from "@/app/api/tools/runs/route"
import * as runRoute from "@/app/api/tools/runs/[id]/route"
import * as eventsRoute from "@/app/api/tools/runs/[id]/events/route"
import * as actionsRoute from "@/app/api/tools/runs/[id]/actions/route"
import * as artifactRoute from "@/app/api/tools/runs/[id]/artifacts/[artifactId]/route"
import * as saveRoute from "@/app/api/tools/runs/[id]/save/route"
import { createProfileSession, listLocalProfiles } from "../../server/local-profiles"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../../local-profile-contract"
import { resolveWorkflowContext } from "../context"
import { registerToolManifest } from "../../extensions/registry"
import { writeProfileTools } from "../../extensions/store"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { registerWorkflowAdapter } from "../adapters"
import { waitForWorkflowIdle } from "../coordinator"
import { withWorkflowAttempt } from "../attempt-scope"
import { revertPersistedChangeset } from "../../vault/changesets"
import { workflowFixture } from "./fixtures"

let unblock: (() => void) | undefined
const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => { unblock?.(); unblock = undefined; await waitForWorkflowIdle(); for (const work of cleanup.splice(0).reverse()) await work(); vi.unstubAllEnvs() })
/** Test-only TCP adapter for the real route exports. No production registration,
 * authentication mocks, framework server claims, or provider calls. */
async function listen(): Promise<{ server: Server; base: string }> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const url = `http://${incoming.headers.host}${incoming.url}`, headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
      const request = new NextRequest(url, { method: incoming.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
      const parts = new URL(url).pathname.split("/").slice(4), id = parts[0], params = { params: Promise.resolve({ id }) }
      let response: Response
      if (new URL(url).pathname === "/api/tools/runs") response = request.method === "POST" ? await runsRoute.POST(request) : await runsRoute.GET(request)
      else if (parts[1] === "events") response = await eventsRoute.GET(request, params)
      else if (parts[1] === "actions") response = await actionsRoute.POST(request, params)
      else if (parts[1] === "save") response = await saveRoute.POST(request, params)
      else if (parts[1] === "artifacts") response = await artifactRoute.GET(request, { params: Promise.resolve({ id, artifactId: parts[2] }) })
      else response = await runRoute.GET(request, params)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(500); outgoing.end("Test dispatcher failure") }
  })
  server.listen(0, "127.0.0.1"); await once(server, "listening")
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No loopback port")
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  return { server, base: `http://127.0.0.1:${address.port}` }
}
it("phase 6: authenticated HTTP start, detached completion, allowance, safe retrieval and reversible save", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-phase6-")); cleanup.push(() => rm(root, { recursive: true, force: true }))
  vi.stubEnv("SCISPARK_VAULT", join(root, "vault")); vi.stubEnv("SCISPARK_PROFILES_DIR", join(root, "profiles")); vi.stubEnv("SCISPARK_SCHEDULER", "off")
  const [profile] = await listLocalProfiles(), session = await createProfileSession(profile.id), ctx = await resolveWorkflowContext(profile)
  const { tool, request: input } = workflowFixture(); tool.ref.packageId = `fixture/${randomUUID()}`; tool.entrypoint = randomUUID()
  cleanup.push(registerToolManifest(tool))
  await writeProfileTools(ctx, { schemaVersion: 1, enabled: [{ tool: tool.ref, enabled: true }], pins: [tool.ref], overrides: [], migrated: true })
  await saveSettings(ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "unused-offline-fixture" } })
  await ctx.storage.write("wiki/papers/original.md", "Original paper")
  let release!: () => void, dispatches = 0
  const detached = new Promise<void>(resolve => { release = resolve })
  unblock = release
  registerWorkflowAdapter(tool.entrypoint, { execute: async (owner, run, io) => {
    if (run.input.mode === "allowance") await withWorkflowAttempt(owner, run.id, { id: randomUUID(), kind: "model", replay: "reconcile", inputHash: "a".repeat(64) },
      { modelCalls: 1, commandCalls: 0, activeSeconds: 1, costUsd: 0, accountingOwner: "workflow" }, async () => {
        dispatches++; return { value: null, result: { modelCalls: 1, commandCalls: 0, activeSeconds: 0, costUsd: 0, outcome: "known" } }
      })
    else {
      await io.emit({ type: "text", text: "Working independently of observation" }); await detached
      await io.publishArtifact({ kind: "markdown", title: "HTTP evidence", mediaType: "text/markdown", sourceRefs: ["https://example.org/source"], bytes: new TextEncoder().encode("# Evidence\nSource-linked report") })
      await io.publishArtifact({ kind: "file", title: 'untrusted"\r\nheader', mediaType: "text/html", sourceRefs: [], bytes: new TextEncoder().encode("<script>alert(1)</script>") })
    }
  } })
  const { base } = await listen(), headers = { cookie: `${PROFILE_COOKIE}=${session.token}`, [PROFILE_HEADER]: profile.id }
  const call = (path: string, body?: unknown, extra?: Record<string, string>) => fetch(`${base}/api/tools${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...headers, "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  expect((await fetch(`${base}/api/tools/runs`)).status).toBe(401)
  const start = await call("/runs", { ...input, tool: tool.ref }); expect(start.status).toBe(202)
  const run = (await start.json()).result
  const observer = await call(`/runs/${run.id}/events?after=0`); await observer.body?.cancel()
  release(); await waitForWorkflowIdle()
  const complete = (await (await call(`/runs/${run.id}`)).json()).result
  expect(complete.status).toBe("completed"); expect(await ctx.storage.list("wiki/notes/")).toEqual([])
  const report = complete.artifacts.find((a: { kind: string }) => a.kind === "markdown")
  const html = complete.artifacts.find((a: { kind: string }) => a.kind === "file")
  const download = await call(`/runs/${run.id}/artifacts/${report.id}`)
  expect(download.status).toBe(200); expect(await download.text()).toContain("Source-linked report")
  const hostile = await call(`/runs/${run.id}/artifacts/${html.id}`)
  expect(hostile.headers.get("content-disposition")).toMatch(/^attachment; filename="artifact-/)
  expect(hostile.headers.get("x-content-type-options")).toBe("nosniff")
  expect(hostile.headers.get("content-security-policy")).toContain("sandbox")
  expect((await call(`/runs/${run.id}/artifacts/${report.id}`, undefined, { [PROFILE_HEADER]: randomUUID() })).status).toBe(409)
  expect((await call(`/runs/${run.id}/save`, { artifactIds: [html.id], operationId: randomUUID() })).status).toBe(409)
  const saveBody = { artifactIds: [report.id], operationId: randomUUID() }
  const saved = await call(`/runs/${run.id}/save`, saveBody); expect(saved.status).toBe(200)
  const result = (await saved.json()).result
  expect((await (await call(`/runs/${run.id}/save`, saveBody)).json()).result).toEqual(result)
  await revertPersistedChangeset(ctx.storage, result.changesetId)
  expect(await ctx.storage.list("wiki/notes/")).toEqual([]); expect(await ctx.storage.read("wiki/papers/original.md")).toBe("Original paper")
  const limited = (await (await call("/runs", { ...input, tool: tool.ref, operationId: randomUUID(), input: { mode: "allowance" }, allowance: { modelCalls: 0 } })).json()).result
  await waitForWorkflowIdle(); expect(dispatches).toBe(0)
  expect((await (await call(`/runs/${limited.id}`)).json()).result.status).toBe("paused_limit")
  expect((await call(`/runs/${limited.id}/actions`, { action: "extend", operationId: randomUUID(), delta: { modelCalls: 1 } })).status).toBe(200)
  expect((await call(`/runs/${limited.id}/actions`, { action: "resume", operationId: randomUUID() })).status).toBe(200)
  await waitForWorkflowIdle(); expect(dispatches).toBe(1)
  expect((await (await call(`/runs/${limited.id}`)).json()).result.usage.modelCalls).toBe(1)
}, 15000)

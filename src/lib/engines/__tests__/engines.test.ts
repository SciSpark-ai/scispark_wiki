import { afterEach, describe, expect, it, vi } from "vitest"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"
import { DEFAULT_ENGINES, EngineSettingsSchema } from "../contracts"
import { engineEnvironment, runEngineProcess } from "../process"
import { localEngineStatus, supportedVersion } from "../status"
import { CompletionEvents, completionArguments, LocalEngineProvider } from "../local-provider"
import { DEFAULT_SETTINGS, loadSettings, saveSettings, resolveTier, buildProvider, isAiReady } from "../../llm/settings"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { runSkill } from "../../skills/runner"
import { Meter } from "../../llm/metering"
import { summarizeUsage } from "../../llm/usage-summary"
import { completeStructured } from "../../llm/structured"
import { codexNativeSchema } from "../schema"
import { AssessmentsSchema } from "../../recommendation/contract"
import { setServerVaultForTests } from "../../server/vault"
import * as settingsRoute from "../../../app/api/settings/route"
import * as statusRoute from "../../../app/api/settings/engines/route"

function fixtures() {
  vi.stubEnv("SCISPARK_CODEX_PATH", resolve("e2e/fixtures/engines/codex.mjs"))
  vi.stubEnv("SCISPARK_CLAUDE_PATH", resolve("e2e/fixtures/engines/claude.mjs"))
}
afterEach(() => { vi.unstubAllEnvs(); setServerVaultForTests(null) })
const request = { messages: [{ role: "user" as const, content: "Please return ready" }], maxTokens: 256 }
const schema = z.object({ message: z.literal("ready") }).strict()

describe("engine boundary", () => {
  it("preserves optional evidence contracts through prompt JSON, using native schemas only when compatible", () => {
    expect(codexNativeSchema(z.toJSONSchema(schema))).toBe(true)
    const jsonSchema = z.toJSONSchema(AssessmentsSchema)
    expect(codexNativeSchema(jsonSchema)).toBe(false)
    expect(completionArguments("codex", "model", { ...request, jsonSchema }, "/tmp/schema")).not.toContain("--output-schema")
    expect(codexNativeSchema(z.toJSONSchema(z.object({ arbitrary: z.record(z.string(), z.string()) })))).toBe(false)
  })
  it("accepts Codex diagnostic items while preserving completion and usage", () => {
    const events = new CompletionEvents("codex")
    events.accept(JSON.stringify({ type: "item.completed", item: { type: "error", message: "Metadata warning" } }))
    events.accept(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"message":"ready"}' } }))
    events.accept(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }))
    expect(events.failed).toBe(false)
    expect(events.done).toBe(true)
    expect(events.usage.reported).toBe(true)
  })
  it("classifies model rejection without exposing raw CLI diagnostics", () => {
    const events = new CompletionEvents("codex")
    events.accept(JSON.stringify({ type: "error", message: "The model is not supported with ChatGPT. secret-token" }))
    expect(events.failed).toBe(true)
    expect(events.failureMessage).toContain("selected model")
    expect(events.failureMessage).not.toContain("secret-token")
  })
  it("does not inherit credentials, endpoints or agent customizations", () => {
    const env = engineEnvironment({ NODE_ENV: "test", HOME: "/tmp", PATH: "/usr/bin", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", CLAUDECODE: "1", CODEX_HOME: "/private", NODE_OPTIONS: "--require malicious", ANTHROPIC_BASE_URL: "evil" })
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDECODE", "CODEX_HOME", "NODE_OPTIONS", "ANTHROPIC_BASE_URL"]) expect(env[key]).toBeUndefined()
  })
  it("rejects unvalidated command configuration and unsupported versions", () => {
    expect(EngineSettingsSchema.safeParse({ ...DEFAULT_ENGINES, executable: "evil" }).success).toBe(false)
    expect(supportedVersion("codex", "0.100.0")).toBe(false)
    expect(supportedVersion("claude-code", "2.1.209")).toBe(false)
  })
  it("ignores reasoning and rejects unexpected tool execution", () => {
    const onText = vi.fn(); const events = new CompletionEvents("codex", onText)
    events.accept(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "private" } }))
    expect(onText).not.toHaveBeenCalled()
    expect(() => events.accept(JSON.stringify({ type: "item.started", item: { type: "command_execution" } }))).toThrow()
    expect(events.usage.reported).toBe(false)
  })
  it("protects process-launch endpoints from cross-origin requests", async () => {
    const response = await statusRoute.POST(new Request("http://localhost:3000/api/settings/engines", { method: "POST", headers: { host: "localhost:3000", origin: "https://evil.test" }, body: JSON.stringify({ engine: "codex" }) }))
    expect(response.status).toBe(403)
  })
  it("stops a real child process on cancellation", async () => {
    const abort = new AbortController()
    const result = runEngineProcess({ executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: tmpdir(), timeoutMs: 10_000, signal: abort.signal })
    abort.abort()
    await expect(result).rejects.toThrow("cancelled")
  })
  it("stops a real child process at its deadline", async () => {
    await expect(runEngineProcess({ executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: tmpdir(), timeoutMs: 40 })).rejects.toThrow("timed out")
  })
})

for (const engine of ["codex", "claude-code"] as const) describe(engine, () => {
  it("validates schemas containing optional fields through the subprocess", async () => {
    fixtures()
    const provider = new LocalEngineProvider(engine, DEFAULT_ENGINES)
    const optional = z.object({ message: z.literal("ready"), evidence: z.string().optional() })
    const result = await completeStructured(provider, "model", request, optional)
    expect(result.value).toEqual({ message: "ready" })
    expect(result.usage.reported).toBe(true)
  })
  it("checks status and completes a structured skill without any API key or dollar budget", async () => {
    fixtures()
    const storage = new MemoryVaultStorage()
    const settings = { ...DEFAULT_SETTINGS, keys: {}, dailyBudgetUsd: 0, engines: { ...DEFAULT_ENGINES, kind: engine } }
    await saveSettings(storage, settings)
    expect(await isAiReady(settings)).toBe(true)
    expect((await localEngineStatus(engine)).state).toBe("ready")
    expect(resolveTier(settings, "strong").model).toBe(DEFAULT_ENGINES.models[engine].strong)
    const onText = vi.fn()
    const result = await runSkill({ storage, skill: { name: "fixture", version: "1", run: (ctx) => ctx.llmStructured("strong", request, schema, { streamField: "message" }) }, input: {}, onText })
    expect(result.status).toBe("ok"); expect(result.output).toEqual({ message: "ready" })
    expect(onText).toHaveBeenCalledWith("ready")
    expect(result.costUsd).toBeNull()
    expect(result.usage).toMatchObject({ engine, billingMode: "subscription", inputTokens: 100, outputTokens: 20 })
    const meter = new Meter(storage)
    expect(await meter.spendingToday()).toEqual({ totalUsd: 0, knownUsd: 0, unpricedCount: 0 })
    const summary = summarizeUsage(await meter.recordsForDay(new Date().toISOString().slice(0, 10)), new Date())
    expect(summary.subscription?.calls).toBe(1)
    expect(summary.unpricedCount).toBe(0)
  })
  it("never returns raw runtime stderr", async () => {
    fixtures()
    const provider = new LocalEngineProvider(engine, DEFAULT_ENGINES)
    await expect(provider.complete("model", { messages: [{ role: "user", content: "FIXTURE_ERROR" }] })).rejects.toThrow("no automatic retry")
    try { await provider.complete("model", { messages: [{ role: "user", content: "FIXTURE_ERROR" }] }) } catch (e) { expect(String(e)).not.toContain("DO-NOT-LEAK") }
  })
  it("records unknown subscription usage after a failed dispatch", async () => {
    fixtures()
    const storage = new MemoryVaultStorage()
    await saveSettings(storage, { ...DEFAULT_SETTINGS, engines: { ...DEFAULT_ENGINES, kind: engine } })
    const result = await runSkill({ storage, skill: { name: "failed-engine", version: "1", run: (ctx) => ctx.llm("fast", { messages: [{ role: "user", content: "FIXTURE_ERROR" }] }) }, input: {} })
    expect(result.status).toBe("error")
    expect(result.costUsd).toBeNull()
    expect(result.usage).toMatchObject({ engine, reported: false, billingMode: "subscription" })
    expect(result.error).not.toContain("DO-NOT-LEAK")
    const records = await new Meter(storage).recordsForDay(new Date().toISOString().slice(0, 10))
    expect(records).toHaveLength(1)
    expect(records[0].model).toBe(DEFAULT_ENGINES.models[engine].fast)
  })
  it("does not retry schema-invalid subscription responses", async () => {
    fixtures()
    const provider = buildProvider({ ...DEFAULT_SETTINGS, engines: { ...DEFAULT_ENGINES, kind: engine } }, "strong")
    const spy = vi.spyOn(provider, "complete")
    await expect(completeStructured(provider, "model", { messages: [{ role: "user", content: "FIXTURE_INVALID" }] }, schema)).rejects.toThrow("validation failed")
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it("preserves both configurations, API keys and sibling settings during saves", async () => {
    const storage = new MemoryVaultStorage(); setServerVaultForTests(storage)
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: { ...DEFAULT_SETTINGS, keys: { anthropic: "secret" } }, untouched: { data: true } }))
    const engines = { ...DEFAULT_ENGINES, kind: engine }
    const result = await settingsRoute.PUT(new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify({ patch: { engines } }) }))
    expect(result.status).toBe(200)
    expect(await result.text()).not.toContain("secret")
    await settingsRoute.PUT(new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify({ patch: { dailyBudgetUsd: 7 } }) }))
    expect((await loadSettings(storage)).engines).toEqual(engines)
    expect(JSON.parse((await storage.read(".scispark/settings.json"))!).untouched).toEqual({ data: true })
  })
  it("selects tools-off and isolated configuration flags", () => {
    const args = completionArguments(engine, "model", request, "/tmp/schema")
    expect(args).not.toContain("--dangerously-skip-permissions")
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(args).toContain(engine === "codex" ? "--ignore-user-config" : "--safe-mode")
    expect(args).toContain(engine === "codex" ? "features.shell_tool=false" : "--tools")
  })
})

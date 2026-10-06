import { expect, type APIRequestContext } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ToolRef } from "../../src/lib/extensions/contracts"
import { NodeFsVaultStorage } from "../../src/lib/vault/node-fs-storage"

export const runDir = () => process.env.SCISPARK_E2E_RUN_DIR!
export const vaultDir = () => process.env.SCISPARK_E2E_VAULT_PATH!
export const skill = (name: string, extra = "") => `---\nname: ${name}\ndescription: Compare supplied synthetic evidence and preserve limitations.\nscispark:\n  engines: [api]\n  inputSchema: {type: object, additionalProperties: true}\n---\nMODULAR-FIXTURE: Compare the supplied synthetic evidence. ${extra}`
export async function resetTools() {
  const storage = new NodeFsVaultStorage(vaultDir())
  await storage.write(".scispark/tools/state.json", JSON.stringify({ schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true, sidebarPins: [] }))
}
export async function importTool(request: APIRequestContext, name: string) {
  const source = join(runDir(), `skill-${randomUUID()}`)
  await mkdir(source); await writeFile(join(source, "SKILL.md"), skill(name))
  const previewResponse = await request.post("/api/tools/imports", { data: { source: { kind: "local-folder", path: source } } })
  expect(previewResponse.ok(), await previewResponse.text()).toBe(true)
  const preview = (await previewResponse.json()).result
  const ref: ToolRef = preview.tools[0].manifest.ref
  const confirmed = await request.post(`/api/tools/imports/${preview.id}`, { data: { action: "confirm", selected: [ref], proposals: [preview.tools[0].proposal] } })
  expect(confirmed.ok(), await confirmed.text()).toBe(true)
  return { ref: (await confirmed.json()).result.preview.tools[0].manifest.ref as ToolRef, source }
}
export async function startTool(request: APIRequestContext, tool: ToolRef, question: string, modelCalls?: number) {
  const response = await request.post("/api/tools/runs", { data: { operationId: randomUUID(), tool, input: { question }, contextRefs: [], writeIntent: "outputs_only", ...(modelCalls === undefined ? {} : { allowance: { modelCalls } }) } })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).result
}
export async function snapshot(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/tools/runs/${id}`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).result
}
export async function providerRows(scenario: string) {
  const raw = await readFile(join(runDir(), "evidence", "provider.jsonl"), "utf8").catch(() => "")
  return raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(row => row.scenario === scenario) as { id: string; phase: string; inputHash: string; workflowInputHash: string; scenario: string }[]
}
export async function readRunFile(id: string, file: string, vault = vaultDir()) {
  return JSON.parse(await readFile(join(vault, ".scispark/tool-runs", id, file), "utf8"))
}

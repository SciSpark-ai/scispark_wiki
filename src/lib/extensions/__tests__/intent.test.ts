// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import * as library from "../library"
import * as classification from "../classification-attempt"
import * as runStore from "../../workflows/store"
import * as coordinator from "../../workflows/coordinator"
import { resolveToolIntent, deriveWriteIntent } from "../intent"
import { chooseTool } from "../choice-store"
import { NATIVE_TOOL_MANIFESTS } from "../native-catalog"
import type { LibraryTool } from "../ui-contract"
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "intent-")); roots.push(root)
  const vaultPath = join(root, "vault"); await mkdir(vaultPath)
  const ctx = { profileId: randomUUID(), vaultId: "a".repeat(64), vaultPath, runtimeRoot: join(root, "runtime"), storage: new NodeFsVaultStorage(vaultPath) }
  const base = NATIVE_TOOL_MANIFESTS.find(t => t.ref.skillId === "deep-review")!
  const candidate = (name: string, packageId: string): LibraryTool => ({ ...base, ref: { ...base.ref, packageId }, name, enabled: true, installed: true, pinned: false, readiness: { status: "ready", reasons: [] }, connectionRequirements: [] })
  const tools = [candidate("Deep literature review", "scispark.builtin"), candidate("Evidence Atlas", "fixture.import")]
  vi.spyOn(library, "listToolLibrary").mockImplementation(async () => ({ tools, catalog: [], discoveryDismissed: false }))
  const classify = vi.spyOn(classification, "classifyToolIntent").mockResolvedValue({ kind: "tools", toolIds: [0, 1] })
  const runs = new Map()
  vi.spyOn(runStore, "readRun").mockImplementation(async (_ctx, id) => runs.get(id))
  const starts = vi.spyOn(coordinator, "startRun").mockImplementation(async (_ctx, input) => { const run = { id: input.operationId, tool: input.tool }; runs.set(run.id, run); return run as never })
  const input = { sessionId: "chat_fixture", operationId: randomUUID(), question: "Conduct a literature review of speech development", contextRefs: [] }
  return { ctx, tools, classify, starts, input }
}
it("resolves explicit current names without classification and leaves explanation as core chat", async () => {
  const { ctx, tools, classify, starts, input } = await fixture()
  expect(await resolveToolIntent(ctx, { ...input, question: "Use Evidence Atlas to review speech" })).toMatchObject({ kind: "run", tool: tools[1].ref })
  expect(await resolveToolIntent(ctx, { ...input, operationId: randomUUID(), question: "Explain the methods of this paper", paperContext: "Current paper" })).toEqual({ kind: "chat" })
  expect(classify).not.toHaveBeenCalled(); expect(starts).not.toHaveBeenCalled()
})
it("persists overlap before execution and replay does not classify twice", async () => {
  const { ctx, input, classify, starts } = await fixture()
  const choice = await resolveToolIntent(ctx, input)
  expect(choice).toMatchObject({ kind: "choose", choice: { candidates: expect.any(Array) } })
  expect(await resolveToolIntent(ctx, input)).toEqual(choice)
  expect(classify).toHaveBeenCalledTimes(1); expect(starts).not.toHaveBeenCalled()
})
it("runs one semantic match, clarifies uncertainty, and offers Tools when nothing is enabled", async () => {
  const { ctx, input, classify, tools } = await fixture()
  classify.mockResolvedValueOnce({ kind: "tools", toolIds: [1] })
  expect(await resolveToolIntent(ctx, input)).toMatchObject({ kind: "run", tool: tools[1].ref })
  classify.mockResolvedValueOnce({ kind: "clarify", toolIds: [] })
  expect(await resolveToolIntent(ctx, { ...input, operationId: randomUUID(), question: "Do something with the literature" })).toMatchObject({ kind: "clarify" })
  tools.splice(0)
  expect(await resolveToolIntent(ctx, { ...input, operationId: randomUUID() })).toMatchObject({ kind: "add-tool" })
  expect(await resolveToolIntent(ctx, { ...input, operationId: randomUUID(), question: "What does a p value mean?" })).toEqual({ kind: "chat" })
})
it("consumes a choice once across racing selections and replays the winning selection", async () => {
  const { ctx, input, tools, starts } = await fixture()
  const result = await resolveToolIntent(ctx, input); if (result.kind !== "choose") throw Error("Expected choice")
  const operations = [randomUUID(), randomUUID()]
  const outcomes = await Promise.allSettled(tools.map((t, i) => chooseTool(ctx, result.choice.id, t.ref, operations[i])))
  expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1)
  expect(outcomes.filter(o => o.status === "rejected")).toHaveLength(1)
  const winner = outcomes.findIndex(o => o.status === "fulfilled")
  expect(await chooseTool(ctx, result.choice.id, tools[winner].ref, operations[winner])).toEqual((outcomes[winner] as PromiseFulfilledResult<unknown>).value)
  expect(starts).toHaveBeenCalledTimes(1)
})
it("rejects stale/disabled choices and never selects their remaining alternative", async () => {
  const { ctx, input, tools, starts } = await fixture()
  const result = await resolveToolIntent(ctx, input); if (result.kind !== "choose") throw Error("Expected choice")
  tools[0].enabled = false
  await expect(chooseTool(ctx, result.choice.id, tools[0].ref, randomUUID())).rejects.toMatchObject({ status: 409 })
  expect(starts).not.toHaveBeenCalled()
})
it("rejects unoffered IDs and derives write authority only from a human save request", async () => {
  const { ctx, input, classify } = await fixture()
  classify.mockResolvedValue({ kind: "tools", toolIds: [900] })
  await expect(resolveToolIntent(ctx, input)).rejects.toThrow()
  expect(deriveWriteIntent("Review the literature")).toBe("outputs_only")
  expect(deriveWriteIntent("Review the literature and save it to my wiki")).toBe("update_wiki")
  expect(deriveWriteIntent("Do not save this to my wiki")).toBe("outputs_only")
})

it("retains an existing conversation run without classification and validates real chat references", async () => {
  const { ctx,input,classify,tools }=await fixture(),runId=randomUUID()
  vi.mocked(runStore.readRun).mockResolvedValue({id:runId,tool:tools[0].ref,sessionId:input.sessionId} as never)
  expect(await resolveToolIntent(ctx,{...input,existingRunId:runId,question:"Continue"})).toMatchObject({kind:"run",existingRunId:runId})
  expect(classify).not.toHaveBeenCalled()
  const {StartRunInputSchema,ToolRunSchema}=await import("../../workflows/contracts"),{workflowFixture}=await import("../../workflows/__tests__/fixtures")
  const f=workflowFixture()
  for(const sessionId of ["chat_1234-2","chat_"+randomUUID(),randomUUID()]) {
    expect(StartRunInputSchema.parse({...f.request,sessionId}).sessionId).toBe(sessionId)
    expect(ToolRunSchema.parse({...f.run,sessionId}).sessionId).toBe(sessionId)
  }
  for(const sessionId of ["","../secrets","a/b","a\\b","%2e%2e","a".repeat(101)]) expect(StartRunInputSchema.safeParse({...f.request,sessionId}).success).toBe(false)
})

it.each([
  "Review the literature but do not automatically save it to my wiki",
  "Never ever write this to the knowledge base",
  'Explain the instruction "save this to my wiki"',
  "If I asked you to save this to my wiki, what would happen?",
  "Imagine saving a review; then save it to my wiki",
  "Should we save this to my wiki?",
])("does not infer write authority from qualified wording: %s", question => {
  expect(deriveWriteIntent(question)).toBe("outputs_only")
})
it.each(["Please save this to my wiki", "Review the literature and save it to my wiki", "Add the findings to my knowledge base"])("recognizes affirmative human save requests: %s", question => {
  expect(deriveWriteIntent(question)).toBe("update_wiki")
})
it("keeps empty-profile contextual discussion in core chat", async () => {
  const {ctx,input,tools,classify}=await fixture()
  tools.splice(0)
  for (const question of ["Can you summarize the review above?", "Could you explain how searching works?", "Tell me what running that review means", "The paper discusses search methods; what does that mean?"]) {
    expect(await resolveToolIntent(ctx,{...input,operationId:randomUUID(),question})).toEqual({kind:"chat"})
  }
  for (const question of ["Please find papers about language", "Can you conduct a literature review on speech?"]) {
    expect(await resolveToolIntent(ctx,{...input,operationId:randomUUID(),question})).toMatchObject({kind:"add-tool"})
  }
  expect(classify).not.toHaveBeenCalled()
})

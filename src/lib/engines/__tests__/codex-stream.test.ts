import { describe, expect, it, vi } from "vitest"
import { streamCodex, codexStreamArguments } from "../codex-stream"
import { runEngineProcess, type ProcessRequest } from "../process"
import { CompletionEvents } from "../local-provider"

vi.mock("../process", () => ({ runEngineProcess: vi.fn() }))
const request = { messages: [{ role: "user" as const, content: "Explain this paper" }] }
const scope = { threadId: "thread", turnId: "turn" }
const config = { chatgpt_base_url: "https://chatgpt.com/backend-api/", mcp_servers: { "private.server": { url: "DO-NOT-COPY", headers: { authorization: "DO-NOT-COPY" } } } }

async function simulate(events: object[], settings = config) {
  const written: unknown[] = []
  const text: string[] = []
  const completion = new CompletionEvents("codex", value => text.push(value))
  vi.mocked(runEngineProcess).mockImplementationOnce(async (req: ProcessRequest) => {
    expect(req.collectStdout).toBe(false)
    const reply = (s: string | null) => { if (s) written.push(JSON.parse(s)) }
    for (const event of [
      { id: 1, result: {} }, { id: 2, result: { config: settings } },
      { id: 3, result: { thread: { id: "thread" }, model: "model", modelProvider: "openai", approvalPolicy: "never", sandbox: { type: "readOnly" } } },
      { id: 4, result: { turn: { id: "turn" } } }, ...events,
    ]) req.onLine!(JSON.stringify(event), reply)
    return { code: 0, stdout: "", stderr: "" }
  })
  await streamCodex({ executable: "fixture", cwd: "/tmp", model: "model", prompt: "question", request, timeoutMs: 1000, accept: line => completion.accept(line) })
  return { written, text, completion }
}
const event = (method: string, params: object) => ({ method, params: { ...scope, ...params } })

describe("Codex streaming protocol", () => {
  it("streams only the public answer and retains usage at completion", async () => {
    const result = await simulate([
      event("item/started", { item: { id: "comment", type: "agentMessage", phase: "commentary" } }),
      event("item/agentMessage/delta", { itemId: "comment", delta: "private commentary" }),
      event("item/reasoning/textDelta", { delta: "private reasoning" }),
      event("item/started", { item: { id: "answer", type: "agentMessage", phase: "final_answer" } }),
      event("item/agentMessage/delta", { itemId: "answer", delta: "Hello" }),
      event("item/agentMessage/delta", { itemId: "answer", delta: " world" }),
      event("item/completed", { item: { id: "answer", type: "agentMessage", text: "Hello world" } }),
      event("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 30, outputTokens: 10, cachedInputTokens: 5 } } }),
      event("turn/completed", { turn: { id: "turn", status: "completed" } }),
    ])
    expect(result.text).toEqual(["", "Hello", "Hello world", "Hello world"])
    expect(result.completion).toMatchObject({ done: true, failed: false, usage: { reported: true, inputTokens: 30, outputTokens: 10 } })
    expect(result.written).toContainEqual(expect.objectContaining({ method: "thread/start", params: expect.objectContaining({ ephemeral: true, config: { mcp_servers: { "private.server": { enabled: false } } } }) }))
    expect(JSON.stringify(result.written)).not.toContain("DO-NOT-COPY")
    expect(codexStreamArguments()).toEqual(expect.arrayContaining(["features.hooks=false", "features.shell_tool=false", "features.plugins=false", "notify=[]"]))
  })
  it("rejects tool requests and custom provider routing before sending a question", async () => {
    await expect(simulate([event("item/started", { item: { type: "commandExecution" } })])).rejects.toThrow("tool call")
    await expect(simulate([], { ...config, chatgpt_base_url: "https://elsewhere.invalid" })).rejects.toThrow("provider configuration")
  })
  it("ignores another turn's deltas and reports failed turns without retrying", async () => {
    const result = await simulate([
      event("item/started", { item: { id: "answer", type: "agentMessage" } }),
      event("item/agentMessage/delta", { turnId: "other", itemId: "answer", delta: "unrelated" }),
      event("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 30, outputTokens: 10 } } }),
      event("turn/completed", { turn: { id: "turn", status: "failed", error: { message: "stream disconnected DO-NOT-LEAK" } } }),
    ])
    expect(result.text.join("")).not.toContain("unrelated")
    expect(result.completion).toMatchObject({ failed: true, usage: { reported: true, inputTokens: 30 } })
    expect(result.completion.failureMessage).toContain("connection failed")
    expect(result.completion.failureMessage).not.toContain("DO-NOT-LEAK")
    expect(result.written.filter(m => (m as { method: string }).method === "turn/start")).toHaveLength(1)
  })
})

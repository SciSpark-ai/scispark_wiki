import { describe, it, expect, vi } from "vitest"
import { askChat } from "../orchestrator"
import { listSessions, loadSession, saveSession } from "../session"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"

const paper: PaperRecord = { ids: { doi: "10.1/saved" }, title: "Saved auditory study", abstract: "Adult listeners performed better in quiet.", authors: [{ name: "Author" }], fields: ["Hearing"], source: "openalex" }
const structured = (value: unknown): LLMResult => ({ text: JSON.stringify(value), json: value, usage: { inputTokens: 10, outputTokens: 10 }, model: "fixture", provider: "openai", stopReason: "stop" })
const plan = { interpretation: "Auditory studies", sort: "relevance", fromDate: null, queries: [{ source: "openalex", query: "auditory studies", rationale: "Find auditory studies" }] }
function deps() {
  const provider = new MockProvider([structured(plan), structured({ items: [{ key: "doi:10.1/saved", score: 90, whyMatch: "Examines listening conditions." }] })])
  return { settings: { ...DEFAULT_SETTINGS, keys: { openai: "fixture" } }, providerOverride: { fast: provider }, searchFn: vi.fn(async () => [paper]) }
}
const input = { sessionId: "chat_saved", question: "Find auditory studies", readSourcesOnly: false, mode: "search", operationId: "first", sources: ["openalex"] } as const

describe("automatic search conversation History", () => {
  it("persists the question before retrieval and restores paper snapshots without new calls", async () => {
    const vault = new MemoryVaultStorage()
    const d = deps()
    d.searchFn.mockImplementation(async () => {
      expect((await loadSession(vault, input.sessionId))?.messages[0].content).toBe(input.question)
      return [paper]
    })
    const result = await askChat(vault, { ...d, input: { ...input, sources: [...input.sources] } })
    expect(result.message.error).toBeUndefined()
    expect((await listSessions(vault))[0].messages[1].blocks?.[0]).toMatchObject({ type: "paper-results", result: { items: [{ paper }] } })
    await vault.delete(".scispark/feed.json")
    expect((await loadSession(vault, input.sessionId))?.messages[1].blocks).toEqual(result.message.blocks)
    expect(d.searchFn).toHaveBeenCalledTimes(1)
  })
  it("deduplicates repeated concurrent operation IDs without new searches or lost turns", async () => {
    const vault = new MemoryVaultStorage()
    const d = deps()
    const opts = { ...d, input: { ...input, sources: [...input.sources] } }
    const [a, b] = await Promise.all([askChat(vault, opts), askChat(vault, opts)])
    expect(a).toEqual(b)
    expect(d.searchFn).toHaveBeenCalledTimes(1)
    expect((await loadSession(vault, input.sessionId))?.messages).toHaveLength(2)
    await expect(askChat(vault, { ...opts, input: { ...opts.input, mode: "chat" } })).rejects.toThrow("different search options")
  })
  it("keeps a failed search in History, rather than leaving an empty page", async () => {
    const vault = new MemoryVaultStorage()
    const d = deps()
    d.searchFn.mockRejectedValue(new Error("source unavailable"))
    const result = await askChat(vault, { ...d, input: { ...input, sources: [...input.sources] } })
    expect(result.message.error).toContain("does not mean no literature exists")
    expect((await listSessions(vault))[0].messages).toHaveLength(2)
  })
  it("answers a follow-up from persisted abstracts, not a new search or invented citation", async () => {
    const vault = new MemoryVaultStorage()
    const d = deps()
    await askChat(vault, { ...d, input: { ...input, sources: [...input.sources] } })
    const strong = new MockProvider([structured({ answer: "Listeners performed better in quiet (search-paper-1).", citedPageIds: ["search-paper-1", "invented"] })])
    const answer = await askChat(vault, { ...d, providerOverride: { strong }, input: { sessionId: input.sessionId, question: "What did the paper find?", readSourcesOnly: false } })
    expect(answer.message.blocks).toEqual([{ type: "paper-citations", papers: [paper] }])
    expect(strong.calls[0].req.messages.some((m) => m.content.includes(paper.abstract!))).toBe(true)
    expect(d.searchFn).toHaveBeenCalledTimes(1)
  })
  it("fails closed on malformed rich history and preserves legacy text sessions", async () => {
    const vault = new MemoryVaultStorage()
    const session = { id: "legacy", title: "Legacy", createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z", messages: [{ role: "user" as const, content: "Question" }] }
    await saveSession(vault, session)
    expect(await loadSession(vault, "legacy")).toEqual(session)
    await vault.write(".scispark/chats/broken.json", JSON.stringify({ ...session, id: "broken", messages: [{ role: "assistant", content: "Papers", blocks: [{ type: "paper-results", result: { items: "wrong shape" } }] }] }))
    expect(await loadSession(vault, "broken")).toBeNull()
  })
  it("will not silently rerun an interrupted operation or widen a deleted project's scope", async () => {
    const vault = new MemoryVaultStorage()
    const stamp = "2026-09-07T00:00:00Z"
    await saveSession(vault, { id: input.sessionId, title: "Pending", createdAt: stamp, updatedAt: stamp, messages: [{ role: "user", content: input.question, operationId: "first" }] })
    const d = deps()
    await expect(askChat(vault, { ...d, input: { ...input, sources: [...input.sources] } })).rejects.toThrow("interrupted")
    await saveSession(vault, { id: "scoped", title: "Scoped", createdAt: stamp, updatedAt: stamp, messages: [], projectId: "deleted", projectTitle: "Deleted" })
    await expect(askChat(vault, { ...d, input: { ...input, sessionId: "scoped", sources: [...input.sources] } })).rejects.toThrow("unavailable")
    expect(d.searchFn).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import { FEED_CACHE_PATH } from "../../skills/feed-cache"
import { buildPaperPage } from "../../wiki/authoring"
import { serializeDocument } from "../../vault/frontmatter"
import { askChat, parseAskChatInput } from "../orchestrator"
import { loadSession } from "../session"
import { saveAnswerAsQuery } from "../save-query"
import { loadBundle } from "../../vault/bundle"

const settings = { keys: { openai: "fixture" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://fixture.invalid/v1" } } as const
const paper = { ids: { arxiv: "context-paper" }, title: "State-guided attention decoding", abstract: "SOURCE: A causal state detector adjusts temporal smoothing.", authors: [{ name: "A. Researcher" }], fields: [], source: "arxiv" as const, year: 2026 }
const digest = { summary: "DIGEST: Adaptive smoothing follows attention changes.", laySummary: "Tracks the listener's attention.", keyPoints: ["State-guided smoothing"], methods: "The detector algorithm is not described in the abstract.", limitations: "Only the abstract was available.", fieldContext: "Auditory decoding." }
const input = { sessionId: "chat_paper", question: "How does the causal state detector work?", readSourcesOnly: false, paperSlug: "context-paper" }
function result(): LLMResult {
  const output = { answer: "This paper names the detector but does not describe its algorithm. Would you like general background, or can you provide the full text?", citedPageIds: ["current-paper", "invented"] }
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
async function seed(storage: MemoryVaultStorage, abstract = paper.abstract) {
  await storage.write(FEED_CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), costUsd: 0, strategy: { queries: [{ source: "arxiv", query: "attention", rationale: "fixture" }] }, stats: { retrieved: 1, ranked: 1 }, items: [{ paper: { ...paper, abstract }, score: 1, whyThis: "", whyYou: "", whyNow: "" }] }))
  await storage.write(".scispark/digests/context-paper.json", JSON.stringify(digest))
  await storage.write("wiki/concepts/unrelated.md", serializeDocument({ type: "concept", title: "Unrelated private note", created: "2026-10-04", updated: "2026-10-04", tags: [], related: [], sources: [] }, "UNRELATED-PRIVATE-MARKER"))
}
function options(provider: MockProvider) { return { settings, providerOverride: { fast: provider, strong: provider }, paperTextDeps: { fetchFn: (async () => new Response("", { status: 404 })) as typeof fetch } } }
function prompt(provider: MockProvider) { return provider.calls[0].req.messages.map(m => m.content).join("\n") }

describe("chat from a paper page", () => {
  it("upgrades an existing abstract-only conversation with cached full text before answering", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    await askChat(storage, { input, ...options(new MockProvider([result()])) })
    const text = `${paper.title}\nMethods\nThe detector uses causal attention and a key-value cache. ${"Method details. ".repeat(40)}\nResults\nThe method improved stability.`
    await storage.write("sources/arxiv-context-paper.html", `<article>${text}</article>`)
    const provider = new MockProvider([result()])
    const reply = await askChat(storage, { input: { ...input, readSourcesOnly: true }, ...options(provider) })
    expect(prompt(provider)).toContain("The detector uses causal attention and a key-value cache")
    expect(prompt(provider)).not.toContain("Full text is not supplied")
    expect(prompt(provider)).not.toContain(digest.summary)
    expect(reply.paperSource?.access).toBe("full-text")
    expect((await loadSession(storage, input.sessionId))?.paperContext?.source?.text).toContain("key-value cache")
  })
  it("preserves paper references when explicitly saving an answer to the wiki", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    const reply = await askChat(storage, { input, ...options(new MockProvider([result()])) })
    const saved = await saveAnswerAsQuery(storage, { question: input.question, answer: reply.message.content, sessionId: reply.sessionId, citedPageIds: [] })
    const page = (await loadBundle(storage)).pages.get(saved.pageId)!
    expect(page.frontmatter.sources).toContain("paper:arxiv:context-paper")
    expect(page.frontmatter.sources).toContain(`chat:${reply.sessionId}`)
    expect(page.body).toContain(paper.title)
  })
  it("answers from the unsaved paper and cached digest without selecting unrelated wiki pages", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    const provider = new MockProvider([result()])
    const answer = await askChat(storage, { input, ...options(provider) })
    expect(provider.calls).toHaveLength(1)
    expect(prompt(provider)).toContain(paper.title)
    expect(prompt(provider)).toContain(paper.abstract)
    expect(prompt(provider)).toContain(digest.summary)
    expect(prompt(provider)).not.toContain("UNRELATED-PRIVATE-MARKER")
    expect(prompt(provider)).toContain("CURRENT PAPER")
    expect(prompt(provider)).toContain("ask a short clarifying question")
    expect(prompt(provider)).toContain("explicitly asks for general background")
    expect(prompt(provider)).toContain("AI-generated digest")
    expect(prompt(provider)).toContain("Full text is not supplied")
    expect(answer.message.blocks).toEqual([{ type: "paper-citations", papers: [paper] }])
    expect((await loadSession(storage, answer.sessionId))?.paperContext?.slug).toBe(input.paperSlug)
  })
  it("keeps context for a History follow-up even after feed and digest caches disappear", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    await askChat(storage, { input, ...options(new MockProvider([result()])) })
    await storage.delete(FEED_CACHE_PATH); await storage.delete(".scispark/digests/context-paper.json")
    const provider = new MockProvider([result()])
    await askChat(storage, { input: { sessionId: input.sessionId, question: "What does it smooth?", readSourcesOnly: false }, ...options(provider) })
    expect(provider.calls).toHaveLength(1)
    expect(prompt(provider)).toContain(paper.abstract)
    expect(prompt(provider)).toContain(digest.summary)
    expect(prompt(provider)).toContain(input.question)
    expect((await loadSession(storage, input.sessionId))?.messages).toHaveLength(4)
  })
  it("read-sources-only excludes the generated digest", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    const provider = new MockProvider([result()])
    await askChat(storage, { input: { ...input, readSourcesOnly: true }, ...options(provider) })
    expect(prompt(provider)).toContain(paper.abstract)
    expect(prompt(provider)).not.toContain(digest.summary)
    expect(prompt(provider)).not.toContain("explicitly asks for general background")
  })
  it("backfills the abstract from a saved paper in a custom wiki directory", async () => {
    const storage = new MemoryVaultStorage()
    const saved = buildPaperPage(paper, { fullText: false, today: "2026-10-04", dir: "wiki/sources" })
    await storage.write(saved.path, serializeDocument(saved.frontmatter, saved.body))
    const provider = new MockProvider([result()])
    await askChat(storage, { input, ...options(provider) })
    expect(prompt(provider)).toContain(paper.abstract)
  })
  it("fails explicitly for an unavailable paper without calling the model or falling back to the wiki", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    const provider = new MockProvider([])
    await expect(askChat(storage, { input: { ...input, paperSlug: "missing-paper" }, ...options(provider) })).rejects.toThrow(/paper.*unavailable/i)
    expect(provider.calls).toHaveLength(0)
  })
  it("rejects scope changes before additional model calls", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage)
    const provider = new MockProvider([result()])
    await askChat(storage, { input, ...options(provider) })
    await expect(askChat(storage, { input: { ...input, paperSlug: "other-paper" }, ...options(provider) })).rejects.toThrow(/scope cannot be changed/)
    await expect(askChat(storage, { input: { sessionId: input.sessionId, question: "Hi", projectId: "project", readSourcesOnly: false }, ...options(provider) })).rejects.toThrow(/scope cannot be changed/)
    expect(provider.calls).toHaveLength(1)
  })
  it("bounds source excerpts and reports truncation", async () => {
    const storage = new MemoryVaultStorage(); await seed(storage, `START ${"a ".repeat(20_000)} UNSUPPLIED-END`)
    const provider = new MockProvider([result()])
    await askChat(storage, { input, ...options(provider) })
    expect(prompt(provider)).toContain("Excerpt shortened")
    expect(prompt(provider)).not.toContain("UNSUPPLIED-END")
    expect(prompt(provider).length).toBeLessThan(24_000)
  })
  it("validates scope input and rejects client-supplied source text", () => {
    for (const paperSlug of ["../settings", "", 1, "a/b", "A-Paper"]) expect(() => parseAskChatInput({ ...input, paperSlug })).toThrow()
    expect(() => parseAskChatInput({ ...input, projectId: "another-scope" })).toThrow()
    expect(() => parseAskChatInput({ ...input, paperContext: { paper } })).toThrow()
    expect(parseAskChatInput({ ...input, paperSlug: "研究-注意" }).paperSlug).toBe("研究-注意")
  })
})

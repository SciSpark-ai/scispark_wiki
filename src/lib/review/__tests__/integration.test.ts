import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { openVault } from "@/lib/vault/scaffold"
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/llm/settings"
import { createReview, loadReview, updateReview, reviewCheckpoint, reviewPath } from "../store"
import { actOnReview, reviewSnapshot, waitForReview, recoverReviewJobs } from "../coordinator"
import { exportReview } from "../report"
import { reviewSpend, reviewComplete } from "../budget"
import { loadSession } from "@/lib/chat/session"
import type { LLMProvider, LLMRequest } from "@/lib/llm/types"
import type { PaperRecord } from "@/lib/papers/types"
import { reviewContext } from "../context"
import { askChat } from "@/lib/chat/orchestrator"
import { Meter } from "@/lib/llm/metering"
import { readRecentEvents } from "@/lib/events/log"

// Deliberately fictional evidence. No network/provider or scientific acceptance claim.
const papers: PaperRecord[] = [
  { ids: { doi: "10.1000/positive" }, title: "Adult decoding positive fixture", abstract: "Among 30 adults, decoding improved with the tested method. Pediatric outcomes were not studied.", authors: [{ name: "A Fixture" }], fields: [], source: "openalex" },
  { ids: { doi: "10.1000/null" }, title: "Adult decoding null fixture", abstract: "Among 20 adults, decoding did not improve with the tested method.", authors: [{ name: "B Fixture" }], fields: [], source: "openalex" },
]
function output(req: LLMRequest): unknown {
  const prompt = req.messages[0].content
  const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1))
  if (prompt.startsWith("Define the essential")) return { requirements: [{ id: "R1", question: "What findings are reported?" }] }
  if (prompt.startsWith("Assess coverage of EVERY")) return { facets: data.requirements.map((r: { id: string }) => ({ requirementId: r.id, status: data.report !== undefined && !data.report.includes(data.evidence[0].text) ? "missing" : "addressed", explanation: "Coverage depends on whether the requested finding is in the evidence and answer.", evidence: [{ paperId: data.evidence[0].id, quote: data.evidence[0].text }], answerQuote: data.report === undefined || !data.report.includes(data.evidence[0].text) ? null : data.evidence[0].text })) }
  if (prompt.startsWith("Plan a bounded")) return { queries: [{ source: "openalex", query: "adult decoding" }] }
  if (prompt.startsWith("Assess whether")) return { gaps: ["Conflicting findings need more evidence"], queries: [{ source: "openalex", query: "null adult decoding", gap: "Conflicting findings" }] }
  if (prompt.startsWith("Select one verbatim")) return { quote: data.text }
  if (prompt.startsWith("Extract a study")) return { population: { value: null, quotes: [] }, methods: { value: null, quotes: [] }, findings: { value: data.paper.text, quotes: [data.paper.text] }, limitations: { value: null, quotes: [] } }
  if (prompt.startsWith("Organize the provided")) return { report_title: "Contrasting fixture findings", dimensions: [{ name: "Adult evidence", format: "synthesis", quotes: data.quotes.map((_: unknown, i: number) => i) }] }
  if (prompt.startsWith("Write one evidence")) return { paragraphs: data.evidence.map((e: { id: string; sourceText: string }) => ({ text: e.sourceText, citations: [e.id] })) }
  if (prompt.startsWith("Correct this draft")) return { claims: [{ text: data.original.text, evidence: [{ paperId: data.original.citations[0], quote: data.original.text }] }], unresolved: [] }
  if (prompt.startsWith("Independently check")) return { checks: data.claims.map((_: unknown, i: number) => ({ claim: i, supported: true, explanation: "Fixture repeats the supplied evidence faithfully." })), missingSupportedFindings: [] }
  if (prompt.startsWith("Revise wording")) return { markdown: `${data.markdown}\n\nEditorial revision.`, requiresResearch: false }
  if (prompt.startsWith("Connect the checked")) return { markdown: `Consider how these contrasting results relate to ${data.context[0].text}.` }
  throw new Error(`Unexpected test prompt: ${prompt.slice(0, 55)}`)
}
function mockProvider(handler: (req: LLMRequest) => Promise<unknown> | unknown = output) {
  const complete = vi.fn(async (model: string, req: LLMRequest) => {
    const json = await handler(req)
    return { json, text: JSON.stringify(json), usage: { inputTokens: 100, outputTokens: 80 }, model, provider: "openai" as const, stopReason: "stop" }
  })
  return { id: "openai" as const, complete } satisfies LLMProvider
}
async function setup() {
  const storage = new MemoryVaultStorage(); await openVault(storage)
  await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { openai: "fake-key-never-sent" },
    tierModels: { fast: { provider: "openai", model: "gpt-5.4-mini" }, strong: { provider: "openai", model: "gpt-5.4-mini" } }, dailyBudgetUsd: 5 })
  const run = await createReview(storage, { sessionId: "chat_review", operationId: "test", question: "Compare adult decoding methods", sources: ["openalex"] })
  const provider = mockProvider()
  const search = vi.fn(async (_source: unknown, query: string) => query.startsWith("null") ? [papers[1]] : [papers[0]])
  const fetch = vi.fn(async () => new Response("unavailable", { status: 403 }))
  return { storage, run, provider, search, fetch }
}
describe("durable literature-review integration", () => {
  it("uses approved personal memory only for interpretation, keeps conflicting findings, and recovers completion once", async () => {
    const { storage, provider, search, fetch } = await setup()
    await storage.write("interests.md", "# Interests\n\nAdult decoding methods for private-project-sentinel")
    const run = await createReview(storage, { sessionId: "personal_review", operationId: "personal", question: "Compare adult decoding methods", sources: ["openalex"] })
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision }, { provider, search, fetch }); await waitForReview(storage, run.id)
    const done = await loadReview(storage, run.id)
    expect(done.status).toBe("completed")
    expect(done.versions[0].personalRelevance).toContain("private-project-sentinel")
    expect(exportReview(done, done.versions[0], "markdown")).not.toContain("private-project-sentinel")
    expect(done.versions[0].markdown).toContain("did not improve")
    const prompts = provider.complete.mock.calls.map(([, req]) => req.messages[0].content)
    expect(prompts.filter((p) => p.includes("private-project-sentinel"))).toHaveLength(1)
    expect(prompts.find((p) => p.includes("private-project-sentinel"))).toMatch(/^Connect the checked/)
    expect(JSON.stringify(search.mock.calls)).not.toContain("private-project-sentinel")
    await Promise.all([reviewSnapshot(storage, run.id), reviewSnapshot(storage, run.id)])
    expect((await readRecentEvents(storage)).filter((e) => e.type === "literature_review_ready")).toHaveLength(1)
  })
  it.each([
    ["Compare learning interventions", "Among 30 learners, the intervention improved recall. No transfer benefit was observed."],
    ["Compare battery charging methods", "Among 30 cells, charging time decreased. Capacity retention did not improve."],
  ])("retries partial source checks for %s through the coordinator without repeating research", async (question, abstract) => {
    const { storage, fetch } = await setup()
    const run = await createReview(storage, { sessionId: "retry-session", operationId: "retry", question, sources: ["openalex"] })
    const search = vi.fn(async () => [{ ...papers[0], abstract, title: question }])
    let reject = true
    const provider = mockProvider((req) => {
      const value = output(req)
      if (reject && req.messages[0].content.startsWith("Independently check")) return {
        checks: [{ claim: 0, supported: false, explanation: "The proposed interpretation needs correction." }], missingSupportedFindings: [],
      }
      return value
    })
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision }, { provider, search, fetch })
    await waitForReview(storage, run.id)
    const partial = await loadReview(storage, run.id)
    expect(partial.status).toBe("partial")
    const original = structuredClone(partial.versions[0])
    const calls = provider.complete.mock.calls.length
    const searchCalls = search.mock.calls.length
    const fetchCalls = fetch.mock.calls.length
    await reviewSnapshot(storage, run.id)
    expect(provider.complete).toHaveBeenCalledTimes(calls)
    await expect(actOnReview(storage, run.id, { action: "resume", revision: run.revision }, { provider })).rejects.toThrow("changed")
    reject = false
    await actOnReview(storage, run.id, { action: "resume", revision: partial.revision }, { provider, search, fetch })
    await waitForReview(storage, run.id)
    const done = await loadReview(storage, run.id)
    expect(done.status).toBe("completed")
    expect(done.groundingAttempt).toBe(1)
    expect(done.versions).toHaveLength(2)
    expect(done.versions[0]).toEqual(original)
    expect(done.versions[1].parent).toBe(original.id)
    expect(done.versions[1].verification).toBe("checked-draft")
    expect(done.versions[1].markdown).toContain(abstract)
    expect(search).toHaveBeenCalledTimes(searchCalls)
    expect(fetch).toHaveBeenCalledTimes(fetchCalls)
    expect(provider.complete.mock.calls.slice(calls).every(([, req]) => /^(Correct this draft|Independently check|Assess coverage of EVERY)/.test(req.messages[0].content))).toBe(true)
    const messages = (await loadSession(storage, run.sessionId))!.messages
    expect(messages.some((m) => m.blocks?.some((b) => b.type === "review-citations" && b.versionId === done.versions[1].id))).toBe(true)
    const after = provider.complete.mock.calls.length
    await reviewSnapshot(storage, run.id)
    expect(provider.complete).toHaveBeenCalledTimes(after)
  })
  it.each(["Compare learning interventions", "Compare battery charging methods"])("keeps grounded but incomplete answers limited: %s", async (question) => {
    const { storage, search, fetch } = await setup()
    const run = await createReview(storage, { sessionId: "coverage-session", operationId: "coverage", question, sources: ["openalex"] })
    const provider = mockProvider((req) => {
      const prompt = req.messages[0].content
      const data = JSON.parse(prompt.split("\n").at(-1)!)
      if (prompt.startsWith("Define the essential")) return { requirements: [{ id: "R1", question: "What findings are reported?" }, { id: "R2", question: "What direct comparative evidence answers the question?" }] }
      if (prompt.startsWith("Assess coverage of EVERY")) return { facets: [
        { requirementId: "R1", status: "addressed", explanation: "Finding present.", evidence: [{ paperId: data.evidence[0].id, quote: data.evidence[0].text }], answerQuote: data.report === undefined ? null : data.evidence[0].text },
        { requirementId: "R2", status: "missing", explanation: "Direct comparative evidence is missing.", evidence: [], answerQuote: null },
      ] }
      if (prompt.startsWith("Assess whether")) expect(data.missingRequirements.map((r: { id: string }) => r.id)).toEqual(["R2"])
      return output(req)
    })
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision }, { provider, search, fetch })
    await waitForReview(storage, run.id)
    const result = await loadReview(storage, run.id)
    expect(result.status).toBe("partial")
    expect(result.versions[0].verification).toBe("checked-draft")
    expect(result.versions[0].answerCoverage?.status).toBe("limited")
    expect(result.versions[0].markdown).toContain("Limited answer")
    expect(result.versions[0].markdown).toContain("Direct comparative evidence is missing")
    const beforeRetry = provider.complete.mock.calls.length
    await expect(actOnReview(storage, run.id, { action: "resume", revision: result.revision }, { provider, search, fetch })).rejects.toThrow("additional evidence")
    expect(provider.complete).toHaveBeenCalledTimes(beforeRetry)
    const history = await loadSession(storage, run.sessionId)
    expect(history?.messages.at(-1)?.content).toContain("essential parts")
    await actOnReview(storage, run.id, { action: "edit", parent: result.versions[0].id, markdown: result.versions[0].markdown + "\nAn edited answer without a fresh coverage check." })
    expect((await loadReview(storage, run.id)).versions.at(-1)?.answerCoverage).toBeUndefined()
    expect((await loadReview(storage, run.id)).versions.at(-1)?.markdown).toContain("Not assessed for this edited version.")
    expect((await loadReview(storage, run.id)).versions.at(-1)?.markdown).not.toContain("Limited answer: essential parts")
  })
  it("answers follow-ups from a pinned review version and records both turns in History", async () => {
    const { storage, run, provider, search, fetch } = await setup()
    await actOnReview(storage, run.id, { action: "approve", revision: 0 }, { provider, search, fetch }); await waitForReview(storage, run.id)
    const answering = mockProvider(() => ({ answer: "The null finding is limited to the tested adults [P2].", citedPageIds: ["P2"] }))
    const result = await askChat(storage, { input: { sessionId: run.sessionId, question: "What was the null result?", readSourcesOnly: false }, providerOverride: { strong: answering } })
    expect(result.message.error).toBeUndefined()
    expect(result.message.blocks?.[0]).toMatchObject({ type: "review-citations", runId: run.id, sourceIds: ["P2"] })
    expect((await loadSession(storage, run.sessionId))?.messages).toHaveLength(5)
    const request = answering.complete.mock.calls[0][1]
    expect(JSON.stringify(request)).toContain("Among 20 adults")
    expect(search).toHaveBeenCalledTimes(2)
  })
  it("repairs an interrupted History link without starting research", async () => {
    const { storage, run, provider } = await setup()
    await storage.delete(`.scispark/chats/${run.sessionId}.json`)
    await createReview(storage, { sessionId: run.sessionId, operationId: "test", question: run.brief.question, sources: ["openalex"] })
    expect((await loadSession(storage, run.sessionId))?.messages).toHaveLength(2)
    expect(provider.complete).not.toHaveBeenCalled()
  })
  it("reserves every validation attempt and repairs metering before cached-response reuse", async () => {
    const { storage, run } = await setup()
    let calls = 0
    const provider = mockProvider(() => ++calls === 1 ? { wrong: "schema" } : { value: "supported" })
    const schema = z.object({ value: z.string() })
    await reviewComplete(storage, run.id, run.brief, "retry", "fixture", schema, 20, async () => {}, provider)
    const path = ".scispark/usage/review-attempts.json"
    const rows = JSON.parse((await storage.read(path))!)
    expect(rows).toHaveLength(2)
    rows.forEach((r: { metered: boolean }) => { r.metered = false })
    await storage.write(path, JSON.stringify(rows))
    const meter = new Meter(storage)
    const before = (await meter.recordsForDay(rows[0].day)).length
    await reviewComplete(storage, run.id, run.brief, "retry", "fixture", schema, 20, async () => {}, provider)
    expect(provider.complete).toHaveBeenCalledTimes(2)
    expect((await meter.recordsForDay(rows[0].day)).length).toBe(before)
    expect(await meter.reviewReservationsToday()).toBe(0)
  })
  it("does not execute on prepare/read, records the brief in History and rejects stale approvals", async () => {
    const { storage, run, provider } = await setup()
    expect((await reviewSnapshot(storage, run.id)).run.status).toBe("awaiting-approval")
    expect(provider.complete).not.toHaveBeenCalled()
    const history = await loadSession(storage, run.sessionId)
    expect(history?.messages[0].content).toBe(run.brief.question)
    expect(history?.messages[1].blocks).toEqual([{ type: "review", runId: run.id }])
    await expect(actOnReview(storage, run.id, { action: "approve", revision: 99 })).rejects.toThrow("changed")
    const replay = await createReview(storage, { sessionId: "chat_review", operationId: "test", question: run.brief.question, sources: ["openalex"] })
    expect(replay.id).toBe(run.id)
    expect((await loadSession(storage, run.sessionId))?.messages).toHaveLength(2)
  })
  it("freezes each approved brief and pauses if approved personal context changes mid-run", async () => {
    const { storage, run, search } = await setup()
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const provider = mockProvider(async (req) => { entered(); await new Promise<void>((resolve) => { release = resolve }); return output(req) })
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision }, { provider, search })
    await waiting
    await storage.write("interests.md", "# Interests\n\nPrivate changed interest in adult decoding methods")
    release(); await waitForReview(storage, run.id)
    const paused = await loadReview(storage, run.id)
    expect(paused.status).toBe("paused")
    expect(paused.error).toContain("context changed")
    expect(paused.approvals).toHaveLength(1)
    expect(paused.approvals[0].brief).toEqual(run.brief)
    expect(provider.complete).toHaveBeenCalledTimes(1)
    expect(search).not.toHaveBeenCalled()
  })
  it("runs academic extraction, follow-up retrieval and claim checks independently of a browser; reopens without calls", async () => {
    const { storage, run, provider, search, fetch } = await setup()
    await Promise.all([1, 2].map(() => actOnReview(storage, run.id, { action: "approve", revision: 0 }, { provider, search, fetch })))
    await waitForReview(storage, run.id)
    const done = await loadReview(storage, run.id)
    expect(done.error).toBeNull()
    expect(done.status).toBe("completed")
    expect(search.mock.calls.map((c) => c[1])).toEqual(["adult decoding", "null adult decoding"])
    expect(done.evidence).toHaveLength(2)
    expect(done.versions[0].markdown).toContain("did not improve")
    expect(done.versions[0].markdown).toContain("[P1]")
    expect(done.versions[0].markdown).toContain("[P2]")
    expect(done.versions[0].markdown).toContain("abstract-only")
    expect((await loadSession(storage, run.sessionId))?.messages).toHaveLength(3)
    expect((await reviewSpend(storage, run.id)).spentUsd).toBeGreaterThan(0)
    const count = provider.complete.mock.calls.length
    await recoverReviewJobs(storage); await reviewSnapshot(storage, run.id)
    expect(provider.complete).toHaveBeenCalledTimes(count)
    expect(exportReview(done, done.versions[0], "bibtex")).toContain("10.1000/null")
    expect(exportReview(done, done.versions[0], "markdown")).not.toContain("fake-key")
  })
  it("stops before a call exceeding an allowance and never prices missing usage as free", async () => {
    const { storage, run, provider, search } = await setup()
    await updateReview(storage, run.id, (r) => { r.brief.allowanceUsd = 0.01 })
    await actOnReview(storage, run.id, { action: "approve", revision: 1 }, { provider, search })
    await waitForReview(storage, run.id)
    expect((await loadReview(storage, run.id)).status).toBe("paused")
    expect((await loadReview(storage, run.id)).error).toContain("Budget")
    expect(provider.complete).not.toHaveBeenCalled()
  })
  it("preserves partial data on cancellation and schedules no later model/search calls", async () => {
    const { storage, run, search } = await setup()
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const provider = mockProvider(async (req) => { entered(); await new Promise<void>((resolve) => { release = resolve }); return output(req) })
    await actOnReview(storage, run.id, { action: "approve", revision: 0 }, { provider, search })
    await waiting
    await actOnReview(storage, run.id, { action: "cancel" })
    release(); await waitForReview(storage, run.id)
    expect((await loadReview(storage, run.id)).status).toBe("cancelled")
    expect(provider.complete).toHaveBeenCalledTimes(1); expect(search).not.toHaveBeenCalled()
    expect((await reviewSpend(storage, run.id)).spentUsd).toBeGreaterThan(0)
  })
  it("marks stale jobs interrupted, refuses uncertain automatic replay, and protects checkpoint hashes", async () => {
    const { storage, run, provider } = await setup()
    await updateReview(storage, run.id, (r) => { r.status = "running"; r.ownerPid = null })
    await recoverReviewJobs(storage)
    expect((await loadReview(storage, run.id)).status).toBe("interrupted")
    expect(provider.complete).not.toHaveBeenCalled()
    const work = vi.fn(async () => ({ value: "saved" }))
    const schema = z.object({ value: z.string() })
    await reviewCheckpoint(storage, run.id, "fixture", {}, schema, work)
    await reviewCheckpoint(storage, run.id, "fixture", {}, schema, work)
    expect(work).toHaveBeenCalledTimes(1)
    const current = await loadReview(storage, run.id)
    const hash = Object.values(current.checkpoints)[0]
    await storage.write(`.scispark/reviews/${run.id}/objects/${hash}.json`, '{"value":"changed"}')
    await expect(reviewCheckpoint(storage, run.id, "fixture", {}, schema, work)).rejects.toThrow("changed")
    const broken = mockProvider(async () => { throw new Error("Lost provider response") })
    await expect(reviewComplete(storage, run.id, run.brief, "uncertain", "test", schema, 10, async () => {}, broken)).rejects.toThrow("Lost")
    await expect(reviewComplete(storage, run.id, run.brief, "uncertain", "test", schema, 10, async () => {}, provider)).rejects.toThrow("may have been billed")
    expect(provider.complete).not.toHaveBeenCalled()
  })
  it("retains manual report versions, rejects stale edits, and exports no private context", async () => {
    const { storage, run, provider, search, fetch } = await setup()
    await actOnReview(storage, run.id, { action: "approve", revision: 0 }, { provider, search, fetch }); await waitForReview(storage, run.id)
    const first = await loadReview(storage, run.id)
    const parent = first.versions[0].id
    await actOnReview(storage, run.id, { action: "edit", parent, markdown: "# Edited review\n\nUser-authored statement." })
    await expect(actOnReview(storage, run.id, { action: "edit", parent, markdown: "Stale" })).rejects.toThrow("newer version")
    const edited = await loadReview(storage, run.id)
    expect(edited.versions).toHaveLength(2)
    expect(edited.versions[1].verification).toBe("edited")
    expect(edited.versions[0].markdown).toBe(first.versions[0].markdown)
    await updateReview(storage, run.id, (r) => { r.evidence = [] })
    expect(exportReview(await loadReview(storage, run.id), edited.versions[0], "bibtex")).toContain("10.1000/null")
    const result = await actOnReview(storage, run.id, { action: "knowledge-base", versionId: edited.versions[1].id })
    expect(result).toHaveProperty("changesetId")
    expect((await loadReview(storage, run.id)).versions).toHaveLength(2)
  })
  it("rejects disabled sources and missing project scope, and never mines old transcripts for memory", async () => {
    const { storage, run } = await setup()
    await storage.write(".scispark/chats/secret.json", JSON.stringify({ secret: "Do not send this old conversation" }))
    expect(JSON.stringify(await reviewContext(storage, "secret conversation"))).not.toContain("Do not send")
    await expect(reviewContext(storage, "decoding", "missing")).rejects.toThrow()
    const config = JSON.parse((await storage.read(".scispark/settings.json"))!)
    config.paperSources = { enabledSources: ["pubmed"] }
    await storage.write(".scispark/settings.json", JSON.stringify(config))
    await expect(actOnReview(storage, run.id, { action: "approve", revision: 0 })).rejects.toThrow("disabled")
    expect((await loadReview(storage, run.id)).status).toBe("awaiting-approval")
    await storage.write(reviewPath(run.id), "corrupt")
    await expect(loadReview(storage, run.id)).rejects.toThrow()
  })
})

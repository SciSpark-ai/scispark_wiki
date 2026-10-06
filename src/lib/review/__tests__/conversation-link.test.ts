import { describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { openVault } from "../../vault/scaffold"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { loadSession, saveSession } from "../../chat/session"
import { appendReviewMessage, createReview, loadReview, reviewPath } from "../store"
import { reviewConversationContext } from "../context"
import type { ReviewRun } from "../contracts"

const conversationId = "chat_link"
const path = `.scispark/chats/${conversationId}.json`
const input = { sessionId: "provenance", operationId: "link-operation", question: "Compare methods", sources: ["openalex"] }
const message = { role: "assistant" as const, content: "Retained report", operationId: "report-result" }
async function setup() {
  const storage = new MemoryVaultStorage()
  await openVault(storage)
  await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { openai: "fixture-never-sent" }, tierModels: {
    fast: { provider: "openai", model: "gpt-5.4-mini" }, strong: { provider: "openai", model: "gpt-5.4-mini" },
  } })
  await saveSession(storage, { id: conversationId, title: "Methods", createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z",
    messages: [{ role: "user", content: "Compare methods from this conversation" }] })
  return storage
}
const badPayloads = ["{broken-json", JSON.stringify({ id: conversationId, messages: "invalid" })]
describe("retained review conversation boundaries", () => {
  for (const boundary of ["create", "replay", "append", "context"] as const) {
    it.each([...badPayloads, "read-failure"])(`${boundary} propagates invalid linked storage: %s`, async (payload) => {
      const storage = await setup()
      const run = boundary === "replay" ? await createReview(storage, input, { conversationId }) : { sessionId: input.sessionId, conversationId } as ReviewRun
      if (payload === "read-failure") {
        const read = storage.read.bind(storage)
        vi.spyOn(storage, "read").mockImplementation(async (key) => { if (key === path) throw new Error("fixture storage read failed"); return read(key) })
      } else await storage.write(path, payload)
      const before = storage.snapshot()
      const action = boundary === "create" || boundary === "replay" ? createReview(storage, input, { conversationId })
        : boundary === "append" ? appendReviewMessage(storage, run, message) : reviewConversationContext(storage, conversationId, input.question)
      await expect(action).rejects.toThrow()
      expect(storage.snapshot()).toEqual(before) // Never persist a false-null link or replace corrupt contents.
    })
  }
  it("skips true absence without resurrecting a conversation on create, replay, append or context read", async () => {
    const storage = await setup(); await storage.delete(path)
    const run = await createReview(storage, input, { conversationId })
    expect(run.conversationId).toBeNull()
    await createReview(storage, input, { conversationId })
    await appendReviewMessage(storage, { ...run, conversationId }, message)
    expect(await reviewConversationContext(storage, conversationId, input.question)).toEqual([])
    expect(await storage.read(path)).toBeNull()
    expect((await loadReview(storage, run.id)).conversationId).toBeNull()
  })
  it("retains a valid authorized link and appends each message once", async () => {
    const storage = await setup(), run = await createReview(storage, input, { conversationId })
    expect(run.conversationId).toBe(conversationId)
    expect(run.brief.context.some(context => context.kind === "conversation")).toBe(true)
    await createReview(storage, input, { conversationId })
    await appendReviewMessage(storage, run, message); await appendReviewMessage(storage, run, message)
    expect((await loadSession(storage, conversationId))!.messages).toHaveLength(4)
  })
  it.each(["retained", "current"])("recognizes the %s brief receipt on replay", async (format) => {
    const storage = await setup(), run = await createReview(storage, input, { conversationId })
    const session = (await loadSession(storage, conversationId))!
    session.messages.find(entry => entry.role === "assistant")!.operationId = format === "retained" ? `${run.id}-brief` : `${input.operationId}-brief`
    await saveSession(storage, session)
    const before = session.messages
    await createReview(storage, input, { conversationId })
    expect((await loadSession(storage, conversationId))!.messages).toEqual(before)
    expect(await storage.read(reviewPath(run.id))).not.toBeNull()
  })
  it.each(badPayloads)("preserves the tolerant legacy chat reader for %s", async (payload) => {
    const storage = await setup(); await storage.write(path, payload)
    expect(await loadSession(storage, conversationId)).toBeNull()
  })
})

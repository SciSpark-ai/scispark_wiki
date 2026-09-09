import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import { advanceOnboarding, getOnboardingState } from "../service"
import { draftAnswers, initialRecord, ONBOARDING_PATH } from "../contract"
import { undoChangeset } from "../../vault/mutations"
import { USER_MODEL_PATHS } from "../../usermodel/pages"

const draft = { name: "Ada", role: "Postdoc", fields: "Auditory neuroscience", topics: "Speech in noise", feedPrefs: "Methods, mostly nearby fields", diversity: "balanced" as const, diversityNote: "A mix of your core topics and nearby ideas, not a fixed quota.", learnFromFeedback: false }
function response(message: string, question = "review", value = draft): LLMResult {
  const json = { message, draft: value, question }
  return { model: "gpt-4o", provider: "openai", text: JSON.stringify(json), json, stopReason: "stop", usage: { inputTokens: 50, outputTokens: 50 } }
}
describe("adaptive onboarding service", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { openai: "test-key-not-for-prompts" }, tierModels: { fast: { provider: "openai", model: "gpt-4o" }, strong: { provider: "openai", model: "gpt-4o" } } })
  })
  it("starts with name; retains original answers and proposed interpretation without creating a profile", async () => {
    const first = await getOnboardingState(storage)
    expect(first.messages).toEqual(initialRecord().messages)
    expect(first.draft.learnFromFeedback).toBeNull()
    const provider = new MockProvider([response("Check your profile below.")])
    const answer = "Ada, postdoc in auditory neuroscience; speech in noise, methods, some nearby ideas. Don’t remember votes."
    const result = await advanceOnboarding(storage, { action: "message", revision: null, message: answer }, { providerOverride: { strong: provider } })
    expect(result.state.messages[1].content).toBe(answer)
    expect(result.state.draft).toEqual(draft)
    expect(await storage.read("profile.md")).toBeNull()
    expect(JSON.stringify(provider.calls)).not.toContain("test-key-not-for-prompts")
    expect(provider.calls[0].req.messages.at(-1)?.content).toBe(answer)
  })
  it("atomically confirms editable answers plus original transcript; Undo restores unconfirmed state", async () => {
    const provider = new MockProvider([response("Check your profile below.")])
    const original = "Please call me Ada; I’m a postdoc."
    const { state } = await advanceOnboarding(storage, { action: "message", revision: null, message: original }, { providerOverride: { strong: provider } })
    const input = { action: "confirm" as const, revision: state.revision, answers: { ...draftAnswers(draft), name: "Ada Lovelace" } }
    const confirmed = await advanceOnboarding(storage, input)
    expect(confirmed.profile?.name).toBe("Ada Lovelace")
    expect(await storage.read("profile.md")).toContain("Ada Lovelace")
    expect(JSON.parse((await storage.read(ONBOARDING_PATH))!).messages[1].content).toBe(original)
    const count = (await storage.list(".scispark/changesets")).length
    await advanceOnboarding(storage, input)
    expect((await storage.list(".scispark/changesets")).length).toBe(count)
    const records = await Promise.all((await storage.list(".scispark/changesets")).map(async (path) => JSON.parse((await storage.read(path))!)))
    const confirmation = records.find((record) => record.skill === "profile-create")
    expect(confirmation.changes).toHaveLength(4)
    await undoChangeset(storage, confirmation.id)
    expect(await storage.read("profile.md")).toBeNull()
    expect((await getOnboardingState(storage)).confirmedAnswers).toBeNull()
  })
  it("preserves the answer on provider failure and retries without appending it twice", async () => {
    const provider = new MockProvider([new Error("provider failed"), response("Which research do you follow?", "research")])
    await expect(advanceOnboarding(storage, { action: "message", revision: null, message: "Ada" }, { providerOverride: { strong: provider } })).rejects.toThrow("Your answer is saved")
    const pending = await getOnboardingState(storage)
    expect(pending.pending).toBe(true)
    expect(pending.messages.filter((item) => item.role === "user")).toHaveLength(1)
    const result = await advanceOnboarding(storage, { action: "retry", revision: pending.revision }, { providerOverride: { strong: provider } })
    expect(result.state.pending).toBe(false)
    expect(result.state.messages.filter((item) => item.role === "user")).toHaveLength(1)
  })
  it("rolls back every profile file and confirmation if a primary write fails", async () => {
    const { state } = await advanceOnboarding(storage, { action: "message", revision: null, message: "Ada" },
      { providerOverride: { strong: new MockProvider([response("Check your profile below.")]) } })
    const before = storage.snapshot()
    const write = storage.write.bind(storage)
    let failOnce = true
    const spy = vi.spyOn(storage, "write").mockImplementation(async (path, value) => {
      if (path === USER_MODEL_PATHS.interests && failOnce) { failOnce = false; throw new Error("Disk write failed") }
      return write(path, value)
    })
    const input = { action: "confirm" as const, revision: state.revision, answers: draftAnswers(draft) }
    await expect(advanceOnboarding(storage, input)).rejects.toThrow("Disk write failed")
    expect(storage.snapshot()).toEqual(before)
    spy.mockRestore()
    expect((await advanceOnboarding(storage, input)).profile?.name).toBe("Ada")
  })
  it("returns derived-refresh warnings after a successful confirmation without inviting duplicate creation", async () => {
    const { state } = await advanceOnboarding(storage, { action: "message", revision: null, message: "Ada" },
      { providerOverride: { strong: new MockProvider([response("Check your profile below.")]) } })
    const write = storage.write.bind(storage)
    const spy = vi.spyOn(storage, "write").mockImplementation(async (path, value) => {
      if (path === "index.md") throw new Error("Index is temporarily unavailable")
      return write(path, value)
    })
    const input = { action: "confirm" as const, revision: state.revision, answers: draftAnswers(draft) }
    const result = await advanceOnboarding(storage, input)
    expect(result.profile?.name).toBe("Ada")
    expect(result.state.onboarded).toBe(true)
    expect(result.warnings).toEqual([expect.objectContaining({ code: "index-refresh-failed" })])
    const count = (await storage.list(".scispark/changesets")).length
    expect((await advanceOnboarding(storage, input)).profile?.name).toBe("Ada")
    expect((await storage.list(".scispark/changesets")).length).toBe(count)
    spy.mockRestore()
  })
  it("rejects stale turns before another paid call and blocks confirmation of unresolved preferences", async () => {
    const provider = new MockProvider([response("Do you mean nearby methods or different fields?", "clarification", { ...draft, diversity: null } as unknown as typeof draft)])
    const first = await advanceOnboarding(storage, { action: "message", revision: null, message: "Surprise me but not too much" }, { providerOverride: { strong: provider } })
    await expect(advanceOnboarding(storage, { action: "message", revision: null, message: "Another tab" }, { providerOverride: { strong: provider } })).rejects.toThrow("another tab")
    expect(provider.calls).toHaveLength(1)
    await expect(advanceOnboarding(storage, { action: "confirm", revision: first.state.revision, answers: draftAnswers(draft) })).rejects.toThrow("Finish the conversation")
  })
  it("does not overwrite corrupt records or call AI without BYOK", async () => {
    const fresh = new MemoryVaultStorage()
    await expect(advanceOnboarding(fresh, { action: "message", revision: null, message: "Ada" })).rejects.toThrow("Connect your AI")
    expect(await fresh.read(ONBOARDING_PATH)).toBeNull()
    await fresh.write(ONBOARDING_PATH, "broken")
    await expect(getOnboardingState(fresh)).rejects.toThrow("has not been overwritten")
    expect(await fresh.read(ONBOARDING_PATH)).toBe("broken")
  })
  it("repairs a premature review instead of showing a missing confirmation form", async () => {
    const incomplete = { ...draft, learnFromFeedback: null } as unknown as typeof draft
    const provider = new MockProvider([
      response("Check the profile below.", "review", incomplete),
      response("Should I remember your feedback?", "learning", incomplete),
    ])
    const { state } = await advanceOnboarding(storage, { action: "message", revision: null, message: "Mostly nearby ideas." }, { providerOverride: { strong: provider } })
    expect(provider.calls).toHaveLength(2)
    expect(state.question).toBe("learning")
    expect(state.draft.learnFromFeedback).toBeNull()
    expect(state.messages.at(-1)?.content).toBe("Should I remember your feedback?")
    expect(await storage.read("profile.md")).toBeNull()
  })
  it("streams the message field before the final validated result", async () => {
    const seen: string[] = []
    const provider = new MockProvider([])
    provider.complete = async (_model, req) => {
      req.onText?.('{"message":"Which research')
      expect(seen).toEqual(["Which research"])
      expect((await getOnboardingState(storage)).pending).toBe(true)
      return response("Which research do you follow?", "research")
    }
    await advanceOnboarding(storage, { action: "message", revision: null, message: "Ada" }, { providerOverride: { strong: provider }, onText: (text) => seen.push(text) })
    expect(seen).toContain("Which research")
  })
})
